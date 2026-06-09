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
 * - Mutates only local visible render-object alpha, tint, and blendMode.
 * - Restores the original visual state exactly on stop/reset where the target
 *   object still exists.
 *
 * Composition:
 * - If Tile Flow owns the visible representation, flicker the Tile Flow sprite.
 * - Otherwise flicker the managed tile render object.
 * - If Tile Flow starts or stops while Flicker is running, Flicker rebases onto
 *   the new live visible object.
 *
 * Lifecycle safety:
 * - Tile Flow may destroy its overlay while Tile Flicker still has a reference
 *   to the Flow sprite.
 * - This file must never write visual state to destroyed display objects.
 * - If the visible object changes, Flicker restores the old live object where
 *   possible, snapshots the new live object, and continues.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp } from "../utils.js";
import { getTileFlowState } from "./tileFlowFx.js";

const EFFECT_NAME = "tileFlicker";

const ACTION_START = "fx.tileFlicker.start";
const ACTION_STOP = "fx.tileFlicker.stop";
const ACTION_UPDATE = "fx.tileFlicker.update";

const NEUTRAL_TINT = 0xffffff;

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

function isLiveDisplayObject(obj) {
  /**
   * Large comment:
   * Determine whether a PIXI display object is still safe to mutate.
   *
   * A destroyed object may still be referenced by FX state, but PIXI can null
   * internal transform or render fields. Writing visual state to that object can
   * then throw.
   */
  if (!obj) return false;
  if (obj.destroyed) return false;
  if (!obj.transform) return false;

  return true;
}

function getTileFlowFlickerObject(runtime, tileId) {
  /**
   * Large comment:
   * Resolve the best Tile Flow object for Flicker composition.
   *
   * Tile Flow exposes a container and a sprite. For Flicker, the sprite is the
   * better target because:
   * - alpha changes affect the visible flowing texture directly
   * - tint works on sprites
   * - transform effects such as Tile Oscillation can still move the container
   */
  const flowState = getTileFlowState(runtime, tileId);

  if (isLiveDisplayObject(flowState?.sprite)) return flowState.sprite;
  if (isLiveDisplayObject(flowState?.container)) return flowState.container;

  return null;
}

function getVisibleFlickerObject(runtime, tileId, tile) {
  /**
   * Large comment:
   * Resolve the object that Flicker should modify right now.
   *
   * Priority:
   * - Tile Flow sprite if Flow owns the visible representation.
   * - Managed tile render object otherwise.
   */
  const flowObject = getTileFlowFlickerObject(runtime, tileId);
  if (flowObject) return flowObject;

  const tileObject = getTileRenderObject(tile);
  if (isLiveDisplayObject(tileObject)) return tileObject;

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

function hexToPixiTint(value, fallback = NEUTRAL_TINT) {
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
    tint: hexToPixiTint(payload?.tint ?? "#ffffff", NEUTRAL_TINT),
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
   * Some display objects do not expose tint as a number until after tint has
   * been assigned. Since Tile Flicker may write tint, always store a safe
   * restoration tint. White is the neutral PIXI tint.
   *
   * This is not document data. It is the current local render object state only.
   */
  if (!isLiveDisplayObject(obj)) return null;

  return {
    alpha: Number.isFinite(obj.alpha) ? obj.alpha : 1,
    tint: typeof obj.tint === "number" ? obj.tint : NEUTRAL_TINT,
    blendMode: obj.blendMode
  };
}

function restoreTileVisualState(obj, snapshot) {
  /**
   * Large comment:
   * Restore local render visual state exactly.
   *
   * This is deliberately defensive. If Tile Flow has already destroyed its
   * sprite, old Flicker state may still point at that destroyed object. In that
   * case, do nothing instead of writing into a dead PIXI object.
   *
   * This does not call tile.refresh(), document.update(), control(), or release().
   */
  if (!isLiveDisplayObject(obj) || !snapshot) return false;

  try {
    obj.alpha = Number.isFinite(snapshot.alpha) ? snapshot.alpha : 1;

    try {
      obj.tint = typeof snapshot.tint === "number" ? snapshot.tint : NEUTRAL_TINT;
    } catch {
      // ignore
    }

    if (snapshot.blendMode !== undefined) {
      obj.blendMode = snapshot.blendMode;
    }

    return true;
  } catch (err) {
    console.warn("[FX Bus] Tile Flicker: skipped visual restore for invalid display object.", err);
    return false;
  }
}

function suppressUnderlyingTileForFlow(runtime, tileId, flickerObject) {
  /**
   * Large comment:
   * When Flicker targets the Tile Flow sprite, the original tile mesh remains
   * visible underneath the Flow overlay.
   *
   * If the Flow sprite alpha is reduced while the base mesh remains visible,
   * the user sees the static original tile shining through, which makes the
   * flicker appear stationary rather than flowing.
   *
   * Suppress the underlying tile mesh locally while Flicker owns the Flow sprite.
   * This is visual-only and restored on stop or rebase.
   */
  const flowState = getTileFlowState(runtime, tileId);
  const flowSprite = flowState?.sprite;
  const baseObject = flowState?.object;

  if (!flowState || flickerObject !== flowSprite) return null;
  if (!isLiveDisplayObject(baseObject)) return null;

  const original = snapshotTileVisualState(baseObject);
  if (!original) return null;

  try {
    baseObject.alpha = 0;
  } catch {
    return null;
  }

  return {
    object: baseObject,
    original
  };
}

function restoreSuppressedUnderlyingTile(suppressed) {
  /**
   * Large comment:
   * Restore a base tile mesh suppressed during Flow + Flicker composition.
   */
  if (!suppressed) return false;

  return restoreTileVisualState(suppressed.object, suppressed.original);
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
   * Apply visual-only flicker to the current visible object.
   *
   * This may be:
   * - the managed tile render object
   * - the Tile Flow sprite, when Tile Flow is active
   */
  const obj = state?.object;
  const original = state?.original;

  if (!isLiveDisplayObject(obj) || !original) return false;

  try {
    const flickerAlpha = computeFlickerAlpha(state, now);

    obj.alpha = clamp(original.alpha * flickerAlpha, 0, 1);

    if (state.useTint) {
      try {
        obj.tint = state.tint;
      } catch {
        // ignore
      }
    } else {
      try {
        obj.tint = typeof original.tint === "number" ? original.tint : NEUTRAL_TINT;
      } catch {
        // ignore
      }
    }

    if (state.blendMode !== undefined) {
      obj.blendMode = state.blendMode;
    }

    return true;
  } catch (err) {
    console.warn("[FX Bus] Tile Flicker: failed to apply visual state.", err);
    return false;
  }
}

function rebaseTileFlickerState(runtime, tileId, state) {
  /**
   * Large comment:
   * Rebase Flicker after Tile Flow starts, Tile Flow stops, Foundry redraws the
   * tile, or the visible render object otherwise changes.
   *
   * Important:
   * - If the old object is destroyed, do not restore it.
   * - If the new visible object is live, snapshot that new object and continue.
   * - If Flicker moves onto the Tile Flow sprite, suppress the original tile mesh
   *   so a static base image does not show through during low-alpha flicker.
   */
  const tile = getTileById(tileId);
  const object = getVisibleFlickerObject(runtime, tileId, tile);

  if (!tile || !object) return false;

  const previousObject = state.object;
  const objectChanged = previousObject !== object || !isLiveDisplayObject(previousObject);

  if (!objectChanged) return true;

  restoreTileVisualState(previousObject, state.original);
  restoreSuppressedUnderlyingTile(state.suppressedUnderlying);

  const nextSnapshot = snapshotTileVisualState(object);
  if (!nextSnapshot) return false;

  state.tile = tile;
  state.object = object;
  state.original = nextSnapshot;
  state.suppressedUnderlying = suppressUnderlyingTileForFlow(runtime, tileId, object);

  return true;
}

function ensureStateStillValid(runtime, tileId, state) {
  /**
   * Large comment:
   * Confirm the stored render object still matches the current visible tile
   * representation.
   *
   * Tile Flow is no longer a blocker. If Flow appears or disappears, Flicker
   * rebases onto the current visible object.
   */
  const tile = getTileById(tileId);
  const currentObject = getVisibleFlickerObject(runtime, tileId, tile);

  if (!tile || !currentObject) return false;

  const objectChanged = state.object !== currentObject || !isLiveDisplayObject(state.object);

  if (!objectChanged) return true;

  return rebaseTileFlickerState(runtime, tileId, state);
}

function removeState(runtime, tileId, state, restore = true) {
  /**
   * Large comment:
   * Remove one flicker state safely.
   *
   * restore=true is used for ordinary stop/reset. Restore is skipped automatically
   * if the target display object has already been destroyed by another effect.
   */
  if (restore) {
    restoreTileVisualState(state?.object, state?.original);
    restoreSuppressedUnderlyingTile(state?.suppressedUnderlying);
  }

  getTileMap(runtime).delete(tileId);
}

function ensureTileTicker(runtime) {
  const map = getTileMap(runtime);

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  ensureTicker(runtime, EFFECT_NAME, (_deltaMS) => {
    const now = performance.now();

    for (const [tileId, state] of Array.from(map.entries())) {
      if (!ensureStateStillValid(runtime, tileId, state)) {
        removeState(runtime, tileId, state, true);
        continue;
      }

      const appliedOk = applyFlickerVisuals(state, now);

      if (!appliedOk) {
        removeState(runtime, tileId, state, true);
      }
    }

    if (map.size === 0) {
      cleanupTicker(runtime, EFFECT_NAME);
    }
  });
}

function updateExistingState(runtime, tileId, state, params) {
  /**
   * Large comment:
   * Update live flicker parameters without replacing the visual snapshot.
   *
   * If the visible target has changed since the previous tick, rebase before
   * accepting the update so new parameters apply to the current visual object.
   */
  ensureStateStillValid(runtime, tileId, state);

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
    const object = getVisibleFlickerObject(runtime, tileId, tile);

    if (!tile || !object) {
      console.warn("[FX Bus] Tile Flicker: tile not found or has no visible render object.", { tileId });
      continue;
    }

    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(runtime, tileId, existing, params);
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
      suppressedUnderlying: suppressUnderlyingTileForFlow(runtime, tileId, object),
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

    removeState(runtime, tileId, state, true);
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