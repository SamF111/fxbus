// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tileFlickerFx.js

/**
 * FX Bus - Tile Flicker FX
 *
 * Purpose:
 * - Apply visual-only flicker to scene tiles identified by tileIds.
 * - Designed for faulty lights, warning panels, unstable holograms, sparking signs,
 *   damaged machinery, neon strips, failing forcefields, monitors, alarms, and fires.
 *
 * Actions:
 * - fx.tileFlicker.start
 * - fx.tileFlicker.stop
 * - fx.tileFlicker.update
 *
 * Payload fields:
 * - tileIds: string[]
 * - minAlpha: number
 * - maxAlpha: number
 * - freqHz: number
 * - jitter: number
 * - randomPhase: boolean
 * - useTint: boolean
 * - tint: string
 * - blendMode: string
 *
 * Behaviour:
 * - Runs entirely client-side.
 * - Does not update Tile documents.
 * - Does not call tile.control(), tile.release(), or inspect tile.controlled.
 * - Does not create clones.
 * - Does not reparent tile render objects.
 * - Does not hide managed tile meshes.
 * - Mutates only local render-object alpha/tint/blendMode.
 * - Restores the original visual state exactly on stop/reset.
 *
 * Reason:
 * - Flicker does not need a clone because it does not animate transform.
 * - Direct local alpha/tint/blend changes keep the tile inside Foundry's normal
 *   lighting, darkness, and environment rendering pipeline.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp } from "../utils.js";

const EFFECT_NAME = "tileFlicker";

const ACTION_START = "fx.tileFlicker.start";
const ACTION_STOP = "fx.tileFlicker.stop";
const ACTION_UPDATE = "fx.tileFlicker.update";

function getTileMap(runtime) {
  /**
   * Large comment:
   * Resolve the per-effect tile state map.
   *
   * Runtime shape:
   *   runtime.tileFx: Map(effectName -> Map(tileId -> state))
   */
  if (!runtime.tileFx) runtime.tileFx = new Map();

  let map = runtime.tileFx.get(EFFECT_NAME);
  if (!map) {
    map = new Map();
    runtime.tileFx.set(EFFECT_NAME, map);
  }

  return map;
}

function getTileById(tileId) {
  if (!canvas?.tiles?.placeables) return null;

  return canvas.tiles.placeables.find((tile) => tile.id === tileId) ?? null;
}

function getTileRenderObject(tile) {
  /**
   * Large comment:
   * Resolve the Foundry-managed tile render object.
   *
   * Foundry v13+ commonly exposes tile.mesh. Older versions exposed tile.tile.
   * FX Bus mutates this object locally only and restores the original visual
   * state on stop/reset. TileDocument data is never changed.
   */
  if (!tile) return null;
  if (tile.mesh) return tile.mesh;
  if (tile.tile) return tile.tile;

  return null;
}

function normaliseTileIds(payload) {
  if (Array.isArray(payload?.tileIds)) {
    return payload.tileIds
      .map((id) => String(id ?? "").trim())
      .filter((id) => id.length > 0);
  }

  if (typeof payload?.tileId === "string" && payload.tileId.trim().length > 0) {
    return [payload.tileId.trim()];
  }

  return [];
}

function normaliseHex(value, fallback = "#ffffff") {
  if (typeof value !== "string") return fallback;

  const s = value.trim().toLowerCase();

  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;

  return fallback;
}

function hexToPixiTint(value, fallback = 0xffffff) {
  const hex = normaliseHex(value, "#ffffff");
  const n = Number.parseInt(hex.slice(1), 16);

  return Number.isFinite(n) ? n : fallback;
}

function normaliseBlendMode(value) {
  const key = String(value ?? "NORMAL").trim().toUpperCase();
  const blendModes = PIXI?.BLEND_MODES ?? {};

  if (key === "ADD" && blendModes.ADD !== undefined) return blendModes.ADD;
  if (key === "SCREEN" && blendModes.SCREEN !== undefined) return blendModes.SCREEN;
  if (key === "MULTIPLY" && blendModes.MULTIPLY !== undefined) return blendModes.MULTIPLY;
  if (key === "OVERLAY" && blendModes.OVERLAY !== undefined) return blendModes.OVERLAY;
  if (key === "NORMAL" && blendModes.NORMAL !== undefined) return blendModes.NORMAL;

  return blendModes.NORMAL ?? 0;
}

function buildParams(payload) {
  const rawMin = Number(payload?.minAlpha ?? 0.35);
  const rawMax = Number(payload?.maxAlpha ?? 1.0);

  const a = clamp(Number.isFinite(rawMin) ? rawMin : 0.35, 0, 1);
  const b = clamp(Number.isFinite(rawMax) ? rawMax : 1.0, 0, 1);

  return {
    minAlpha: Math.min(a, b),
    maxAlpha: Math.max(a, b),
    freqHz: clamp(Number(payload?.freqHz ?? 8), 0.01, 60),
    jitter: clamp(Number(payload?.jitter ?? 0.25), 0, 1),
    randomPhase: payload?.randomPhase !== false,
    useTint: payload?.useTint === true,
    tint: hexToPixiTint(payload?.tint ?? "#ffffff", 0xffffff),
    blendMode: normaliseBlendMode(payload?.blendMode ?? "NORMAL")
  };
}

function phaseFromId(id) {
  let hash = 0;

  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }

  const normalised = Math.abs(hash % 10000) / 10000;

  return normalised * Math.PI * 2;
}

function stableNoise01(seed) {
  /**
   * Large comment:
   * Produce deterministic pseudo-random noise from a numeric seed.
   *
   * This avoids Math.random() in the ticker. Each client computes the same
   * flicker pattern from the same state, preserving FX Bus deterministic
   * behaviour after initialisation.
   */
  const x = Math.sin(seed * 12.9898) * 43758.5453;

  return x - Math.floor(x);
}

function snapshotTileVisualState(obj) {
  /**
   * Large comment:
   * Snapshot local render visual state for exact restoration.
   *
   * This is not document data. It is the current local render object state only.
   */
  if (!obj) return null;

  return {
    alpha: obj.alpha,
    tint: typeof obj.tint === "number" ? obj.tint : null,
    blendMode: obj.blendMode
  };
}

function restoreTileVisualState(obj, snapshot) {
  /**
   * Large comment:
   * Restore local render visual state exactly.
   *
   * This does not call tile.refresh(), document.update(), control(), or release().
   */
  if (!obj || !snapshot) return;

  obj.alpha = snapshot.alpha;

  if (typeof snapshot.tint === "number") {
    try {
      obj.tint = snapshot.tint;
    } catch {
      // ignore
    }
  }

  if (snapshot.blendMode !== undefined) {
    obj.blendMode = snapshot.blendMode;
  }
}

function computeFlickerAlpha(state, now) {
  /**
   * Large comment:
   * Compute a deterministic flicker alpha.
   *
   * The base wave gives an electrical pulse. The stepped noise creates abrupt
   * unstable flicker without using per-frame RNG.
   */
  const t = (now - state.startedAt) / 1000;
  const phase = state.phase;

  const waveA = Math.sin((Math.PI * 2 * state.freqHz * t) + phase);
  const waveB = Math.sin((Math.PI * 2 * state.freqHz * 2.71 * t) + (phase * 0.37));

  const smooth = (waveA + 1) / 2;
  const interference = (waveB + 1) / 2;

  const step = Math.floor((t * state.freqHz * 8) + (phase * 10));
  const noise = stableNoise01(step + (phase * 1000));

  const unstable = clamp(
    (smooth * (1 - state.jitter)) +
      (interference * state.jitter * 0.45) +
      (noise * state.jitter * 0.55),
    0,
    1
  );

  const alpha = state.minAlpha + ((state.maxAlpha - state.minAlpha) * unstable);

  return clamp(alpha, state.minAlpha, state.maxAlpha);
}

function applyFlickerVisuals(state, now) {
  /**
   * Large comment:
   * Apply visual-only flicker directly to the local tile render object.
   *
   * This keeps the tile in Foundry's normal lighting/environment render path.
   */
  const obj = state?.object;
  const original = state?.original;

  if (!obj || !original) return;

  const flickerAlpha = computeFlickerAlpha(state, now);

  obj.alpha = clamp(original.alpha * flickerAlpha, 0, 1);

  if (state.useTint) {
    try {
      obj.tint = state.tint;
    } catch {
      // ignore
    }
  } else if (typeof original.tint === "number") {
    try {
      obj.tint = original.tint;
    } catch {
      // ignore
    }
  }

  if (state.blendMode !== undefined) {
    obj.blendMode = state.blendMode;
  }
}

function ensureStateStillValid(tileId, state) {
  /**
   * Large comment:
   * Confirm the stored tile render object still matches the current tile.
   *
   * If Foundry has redrawn/rebuilt the tile render object, restore the old object
   * if possible and re-snapshot the current render object.
   */
  const tile = getTileById(tileId);
  const currentObject = getTileRenderObject(tile);

  if (!tile || !currentObject) return false;

  if (state.object === currentObject && !currentObject.destroyed) return true;

  restoreTileVisualState(state.object, state.original);

  const nextSnapshot = snapshotTileVisualState(currentObject);
  if (!nextSnapshot) return false;

  state.tile = tile;
  state.object = currentObject;
  state.original = nextSnapshot;

  return true;
}

function ensureTileTicker(runtime) {
  const map = getTileMap(runtime);

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  ensureTicker(runtime, EFFECT_NAME, (_deltaMS) => {
    const now = performance.now();

    for (const [tileId, state] of map.entries()) {
      if (!ensureStateStillValid(tileId, state)) {
        restoreTileVisualState(state.object, state.original);
        map.delete(tileId);
        continue;
      }

      applyFlickerVisuals(state, now);
    }

    if (map.size === 0) {
      cleanupTicker(runtime, EFFECT_NAME);
    }
  });
}

function updateExistingState(state, params) {
  /**
   * Large comment:
   * Update live flicker parameters without replacing the visual snapshot.
   *
   * Existing phase and start time are preserved unless randomPhase is explicitly
   * disabled.
   */
  state.minAlpha = params.minAlpha;
  state.maxAlpha = params.maxAlpha;
  state.freqHz = params.freqHz;
  state.jitter = params.jitter;
  state.useTint = params.useTint;
  state.tint = params.tint;
  state.blendMode = params.blendMode;

  if (!params.randomPhase) {
    state.phase = 0;
  }
}

function startOrUpdate(runtime, payload) {
  const map = getTileMap(runtime);
  const tileIds = normaliseTileIds(payload);
  const params = buildParams(payload);

  for (const tileId of tileIds) {
    const tile = getTileById(tileId);
    const object = getTileRenderObject(tile);

    if (!tile || !object) {
      console.warn("[FX Bus] Tile Flicker: tile not found or has no render object.", { tileId });
      continue;
    }

    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(existing, params);
      continue;
    }

    const snapshot = snapshotTileVisualState(object);

    if (!snapshot) {
      console.warn("[FX Bus] Tile Flicker: could not snapshot tile visual state.", { tileId });
      continue;
    }

    map.set(tileId, {
      tileId,
      tile,
      object,
      original: snapshot,
      startedAt: performance.now(),
      phase: params.randomPhase ? phaseFromId(tileId) : 0,
      minAlpha: params.minAlpha,
      maxAlpha: params.maxAlpha,
      freqHz: params.freqHz,
      jitter: params.jitter,
      useTint: params.useTint,
      tint: params.tint,
      blendMode: params.blendMode
    });
  }

  ensureTileTicker(runtime);
}

function stop(runtime, payload) {
  const map = getTileMap(runtime);
  const tileIds = normaliseTileIds(payload);

  const idsToStop = tileIds.length > 0
    ? tileIds
    : Array.from(map.keys());

  for (const tileId of idsToStop) {
    const state = map.get(tileId);
    if (!state) continue;

    restoreTileVisualState(state.object, state.original);
    map.delete(tileId);
  }

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

export function registerTileFlickerFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTileFlickerFx: invalid runtime.");
  }

  if (!runtime.tileFx) runtime.tileFx = new Map();

  runtime.handlers.set(ACTION_START, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stop(runtime, payload));
}