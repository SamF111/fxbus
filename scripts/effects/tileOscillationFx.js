// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tileOscillationFx.js

/**
 * FX Bus - Tile Oscillation FX
 *
 * Purpose:
 * - Apply visual-only oscillation to scene tiles identified by tileIds.
 * - Designed for environmental movement: trees swaying, hanging signs, loose cables,
 *   steam vents, flags, cloth, machinery, foliage, banners, suspended debris.
 *
 * Actions:
 * - fx.tileOscillation.start
 * - fx.tileOscillation.stop
 * - fx.tileOscillation.update
 *
 * Payload fields:
 * - tileIds: string[]
 * - rotationDeg: number
 * - swayPx: number
 * - bobPx: number
 * - scalePct: number
 * - freqHz: number
 * - randomPhase: boolean
 *
 * Behaviour:
 * - Runs entirely client-side.
 * - Does not update Tile documents.
 * - Does not call tile.control(), tile.release(), or inspect tile.controlled.
 * - Does not create clones.
 * - Does not reparent tile render objects.
 * - Does not hide managed tile meshes.
 * - Animates only the local tile render object transform.
 * - Rebases when the TileDocument position, size, or rotation changes.
 * - Restores the original transform exactly on stop/reset.
 *
 * Reason:
 * - Cloning tiles outside Foundry's tile render environment breaks lighting,
 *   darkness, and scene environmental rendering.
 * - Cloning tiles inside Foundry's managed tile render tree can collide with
 *   tile refresh/control state during multi-tile selection.
 * - Direct local transform mutation preserves Foundry's normal tile rendering
 *   while remaining visual-only because no TileDocument data is changed.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";

const EFFECT_NAME = "tileOscillation";

const ACTION_START = "fx.tileOscillation.start";
const ACTION_STOP = "fx.tileOscillation.stop";
const ACTION_UPDATE = "fx.tileOscillation.update";

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
   * FX Bus mutates this object locally only and restores the original transform
   * on stop/reset. TileDocument data is never changed.
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

function buildParams(payload) {
  return {
    rotationRad: degToRad(clamp(Number(payload?.rotationDeg ?? 2), -30, 30)),
    swayPx: clamp(Number(payload?.swayPx ?? 4), -200, 200),
    bobPx: clamp(Number(payload?.bobPx ?? 0), -200, 200),
    scaleAmp: clamp(Number(payload?.scalePct ?? 0), -50, 50) / 100,
    freqHz: clamp(Number(payload?.freqHz ?? 0.35), 0.01, 10),
    randomPhase: payload?.randomPhase !== false
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

function snapshotTileTransform(obj) {
  /**
   * Large comment:
   * Snapshot the render object's local transform exactly enough for restoration.
   *
   * This snapshot is local-only render state. It is not TileDocument data.
   */
  if (!obj) return null;

  return {
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    scaleX: obj.scale?.x ?? 1,
    scaleY: obj.scale?.y ?? 1,
    pivotX: obj.pivot?.x ?? 0,
    pivotY: obj.pivot?.y ?? 0,
    skewX: obj.skew?.x ?? 0,
    skewY: obj.skew?.y ?? 0
  };
}

function restoreTileTransform(obj, snapshot) {
  /**
   * Large comment:
   * Restore the tile render object's transform exactly.
   *
   * This is called by Stop and Reset through the stop handler. It does not call
   * tile.refresh(), document.update(), control(), or release().
   */
  if (!obj || !snapshot) return;

  obj.x = snapshot.x;
  obj.y = snapshot.y;
  obj.rotation = snapshot.rotation;

  if (obj.scale) {
    obj.scale.set(snapshot.scaleX, snapshot.scaleY);
  }

  if (obj.pivot) {
    obj.pivot.set(snapshot.pivotX, snapshot.pivotY);
  }

  if (obj.skew) {
    obj.skew.set(snapshot.skewX ?? 0, snapshot.skewY ?? 0);
  }
}

function snapshotTileDocumentState(tile) {
  /**
   * Large comment:
   * Snapshot the TileDocument placement fields used to detect external tile
   * movement, resizing, or rotation while FX Bus is animating the render object.
   *
   * This is read-only. It does not mutate the document.
   */
  const doc = tile?.document;
  if (!doc) return null;

  const x = Number(doc.x);
  const y = Number(doc.y);
  const width = Number(doc.width);
  const height = Number(doc.height);
  const rotation = Number(doc.rotation ?? 0);

  if (![x, y, width, height, rotation].every(Number.isFinite)) return null;

  return {
    x,
    y,
    width,
    height,
    rotation
  };
}

function sameTileDocumentState(a, b) {
  if (!a || !b) return false;

  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation
  );
}

function applyDocumentDeltaToSnapshot(snapshot, previousDocumentState, currentDocumentState) {
  /**
   * Large comment:
   * Derive a new transform baseline from TileDocument movement.
   *
   * The render object cannot be trusted as the new baseline while FX Bus is
   * actively animating it, because the ticker has been writing base + offset
   * every frame. Therefore document movement must be applied as a delta to the
   * previous original snapshot.
   */
  if (!snapshot || !previousDocumentState || !currentDocumentState) return null;

  const dx = currentDocumentState.x - previousDocumentState.x;
  const dy = currentDocumentState.y - previousDocumentState.y;
  const dRotationRad = degToRad(currentDocumentState.rotation - previousDocumentState.rotation);

  const previousWidth = previousDocumentState.width;
  const previousHeight = previousDocumentState.height;
  const currentWidth = currentDocumentState.width;
  const currentHeight = currentDocumentState.height;

  const scaleXMul =
    Number.isFinite(previousWidth) && previousWidth !== 0 && Number.isFinite(currentWidth)
      ? currentWidth / previousWidth
      : 1;

  const scaleYMul =
    Number.isFinite(previousHeight) && previousHeight !== 0 && Number.isFinite(currentHeight)
      ? currentHeight / previousHeight
      : 1;

  return {
    ...snapshot,
    x: snapshot.x + dx,
    y: snapshot.y + dy,
    rotation: snapshot.rotation + dRotationRad,
    scaleX: snapshot.scaleX * scaleXMul,
    scaleY: snapshot.scaleY * scaleYMul
  };
}

function rebaseTileOscillationState(state) {
  /**
   * Large comment:
   * Rebase oscillation after Foundry moves, resizes, rotates, or redraws the tile.
   *
   * For a normal document movement, derive the new baseline from the document
   * delta rather than reading from the render object. The render object is the
   * thing being animated, so it may still be pinned to the previous FX baseline.
   *
   * If Foundry has replaced the render object entirely, restore the old object
   * if possible and snapshot the new one.
   */
  const tile = getTileById(state.tileId);
  const object = getTileRenderObject(tile);

  if (!tile || !object) return false;

  const currentDocumentState = snapshotTileDocumentState(tile);
  if (!currentDocumentState) return false;

  const objectChanged = state.object !== object || object.destroyed;

  if (objectChanged) {
    restoreTileTransform(state.object, state.original);

    const nextSnapshot = snapshotTileTransform(object);
    if (!nextSnapshot) return false;

    state.tile = tile;
    state.object = object;
    state.original = nextSnapshot;
    state.base = { ...nextSnapshot };
    state.documentState = currentDocumentState;

    return true;
  }

  const nextOriginal = applyDocumentDeltaToSnapshot(
    state.original,
    state.documentState,
    currentDocumentState
  );

  if (!nextOriginal) return false;

  restoreTileTransform(object, nextOriginal);

  state.tile = tile;
  state.object = object;
  state.original = nextOriginal;
  state.base = { ...nextOriginal };
  state.documentState = currentDocumentState;

  return true;
}

function buildAppliedOffset(state, now) {
  /**
   * Large comment:
   * Compute the current oscillation offset for the managed tile render object.
   */
  const t = (now - state.startedAt) / 1000;

  const wave = Math.sin((Math.PI * 2 * state.freqHz * t) + state.phase);
  const wave2 = Math.sin((Math.PI * 2 * state.freqHz * t * 0.5) + state.phase);

  return {
    x: state.swayPx * wave,
    y: state.bobPx * wave2,
    rotation: state.rotationRad * wave,
    scaleMul: Math.max(0.01, 1 + (state.scaleAmp * wave2))
  };
}

function applyTileTransform(state, applied) {
  /**
   * Large comment:
   * Apply visual-only oscillation directly to the local tile render object.
   *
   * This does not mutate the TileDocument. It only changes the current client's
   * render object until Stop/Reset restores the snapshot.
   */
  const obj = state?.object;
  const base = state?.base;

  if (!obj || !base) return;

  obj.x = base.x + applied.x;
  obj.y = base.y + applied.y;
  obj.rotation = base.rotation + applied.rotation;

  if (obj.scale) {
    obj.scale.set(
      base.scaleX * applied.scaleMul,
      base.scaleY * applied.scaleMul
    );
  }

  if (obj.pivot) {
    obj.pivot.set(base.pivotX, base.pivotY);
  }

  if (obj.skew) {
    obj.skew.set(base.skewX ?? 0, base.skewY ?? 0);
  }
}

function ensureStateStillValid(tileId, state) {
  /**
   * Large comment:
   * Confirm the stored tile render object still matches the current tile and
   * rebase when the TileDocument position, size, or rotation changes.
   *
   * Movement must be detected from TileDocument state, not render-object state,
   * because the render object is actively being animated by this ticker.
   */
  const tile = getTileById(tileId);
  const currentObject = getTileRenderObject(tile);

  if (!tile || !currentObject) return false;

  const currentDocumentState = snapshotTileDocumentState(tile);
  if (!currentDocumentState) return false;

  const objectChanged = state.object !== currentObject || currentObject.destroyed;
  const documentChanged = !sameTileDocumentState(state.documentState, currentDocumentState);

  if (!objectChanged && !documentChanged) return true;

  return rebaseTileOscillationState(state);
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
        restoreTileTransform(state.object, state.original);
        map.delete(tileId);
        continue;
      }

      const applied = buildAppliedOffset(state, now);
      applyTileTransform(state, applied);
      state.applied = applied;
    }

    if (map.size === 0) {
      cleanupTicker(runtime, EFFECT_NAME);
    }
  });
}

function updateExistingState(state, params) {
  /**
   * Large comment:
   * Update live oscillation parameters without replacing the snapshot.
   *
   * Existing phase and start time are preserved unless randomPhase is explicitly
   * disabled.
   */
  state.rotationRad = params.rotationRad;
  state.swayPx = params.swayPx;
  state.bobPx = params.bobPx;
  state.scaleAmp = params.scaleAmp;
  state.freqHz = params.freqHz;

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
      console.warn("[FX Bus] Tile Osc: tile not found or has no render object.", { tileId });
      continue;
    }

    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(existing, params);
      continue;
    }

    const snapshot = snapshotTileTransform(object);

    if (!snapshot) {
      console.warn("[FX Bus] Tile Osc: could not snapshot tile transform.", { tileId });
      continue;
    }

    const documentState = snapshotTileDocumentState(tile);

    if (!documentState) {
      console.warn("[FX Bus] Tile Osc: could not snapshot tile document state.", { tileId });
      continue;
    }

    map.set(tileId, {
      tileId,
      tile,
      object,
      original: snapshot,
      base: { ...snapshot },
      documentState,
      applied: {
        x: 0,
        y: 0,
        rotation: 0,
        scaleMul: 1
      },
      startedAt: performance.now(),
      phase: params.randomPhase ? phaseFromId(tileId) : 0,
      rotationRad: params.rotationRad,
      swayPx: params.swayPx,
      bobPx: params.bobPx,
      scaleAmp: params.scaleAmp,
      freqHz: params.freqHz
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

    restoreTileTransform(state.object, state.original);
    map.delete(tileId);
  }

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

export function registerTileOscillationFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTileOscillationFx: invalid runtime.");
  }

  if (!runtime.tileFx) runtime.tileFx = new Map();

  runtime.handlers.set(ACTION_START, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stop(runtime, payload));
}