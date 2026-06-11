// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tileRotationFx.js

/**
 * FX Bus - Tile Rotation FX
 *
 * Purpose:
 * - Apply visual-only indefinite rotation to scene tiles identified by tileIds.
 * - Designed for environmental movement: planets, gears, fans, magic circles,
 *   portals, radar sweeps, machinery, clockwork, solar systems, rotating hazards.
 *
 * Actions:
 * - fx.tileRotation.start
 * - fx.tileRotation.stop
 * - fx.tileRotation.update
 *
 * Payload fields:
 * - tileIds: string[]
 * - tileId: string
 * - speedDegPerSec: number
 * - startOffsetDeg: number
 * - randomStartOffset: boolean
 * - restoreOnStop: boolean
 *
 * Behaviour:
 * - Runs entirely client-side.
 * - Does not update Tile documents.
 * - Does not call tile.control(), tile.release(), or inspect tile.controlled.
 * - Does not create clones.
 * - Does not reparent tile render objects.
 * - Does not hide managed tile meshes.
 * - Animates only the local visible tile render object rotation.
 * - Rebases when the TileDocument position, size, or rotation changes.
 * - Restores the original transform on stop/reset by default.
 *
 * Composition:
 * - If Tile Flow owns the visible representation, rotate the Tile Flow container.
 * - Otherwise rotate the managed tile render object.
 *
 * Lifecycle safety:
 * - Tile Flow may destroy its overlay while Tile Rotation still has a reference
 *   to it, especially during manual testing or poorly ordered reset.
 * - This file must never write transforms to destroyed display objects.
 * - If the visible object changes, Rotation rebases onto the new live object.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";
import { getTileFlowVisualObject } from "./tileFlowFx.js";

const EFFECT_NAME = "tileRotation";

const ACTION_START = "fx.tileRotation.start";
const ACTION_STOP = "fx.tileRotation.stop";
const ACTION_UPDATE = "fx.tileRotation.update";

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

function isLiveDisplayObject(obj) {
  /**
   * Large comment:
   * Determine whether a PIXI display object is still safe to mutate.
   *
   * A destroyed object may still be referenced by FX state, but PIXI can null
   * internal transform fields. Writing rotation to that object can then throw.
   */
  if (!obj) return false;
  if (obj.destroyed) return false;
  if (!obj.transform) return false;

  return true;
}

function getVisibleTileObject(runtime, tileId, tile) {
  /**
   * Large comment:
   * Resolve the object that is currently visible for this tile.
   *
   * If Tile Flow is running or retained, the visible representation is Tile Flow's
   * container. In that case, rotation must target the container.
   */
  const flowObject = getTileFlowVisualObject(runtime, tileId);
  if (isLiveDisplayObject(flowObject)) return flowObject;

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

function buildParams(payload) {
  return {
    speedRadPerSec: degToRad(clamp(Number(payload?.speedDegPerSec ?? 15), -1440, 1440)),
    startOffsetRad: degToRad(clamp(Number(payload?.startOffsetDeg ?? 0), -3600, 3600)),
    randomStartOffset: payload?.randomStartOffset === true,
    restoreOnStop: payload?.restoreOnStop !== false
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
  if (!isLiveDisplayObject(obj)) return null;

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
   * This is deliberately defensive. If Tile Flow has already destroyed its
   * overlay, old Rotation state may still point at that destroyed container.
   * In that case, do nothing instead of writing into a dead PIXI transform.
   */
  if (!isLiveDisplayObject(obj) || !snapshot) return false;

  try {
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

    return true;
  } catch (err) {
    console.warn("[FX Bus] Tile Rotation: skipped transform restore for invalid display object.", err);
    return false;
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
   * actively rotating it, because the ticker has been writing base + offset
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

function rebaseTileRotationState(runtime, state) {
  /**
   * Large comment:
   * Rebase rotation after Foundry moves, resizes, rotates, redraws the tile,
   * or Tile Flow takes over/releases the visible representation.
   *
   * Important:
   * - If the old object is destroyed, do not restore it.
   * - If the new visible object is live, snapshot that new object and continue.
   * - Preserve the current applied rotation offset across the rebase.
   */
  const tile = getTileById(state.tileId);
  const object = getVisibleTileObject(runtime, state.tileId, tile);

  if (!tile || !object) return false;

  const currentDocumentState = snapshotTileDocumentState(tile);
  if (!currentDocumentState) return false;

  const previousObject = state.object;
  const objectChanged = previousObject !== object || !isLiveDisplayObject(previousObject);

  if (objectChanged) {
    restoreTileTransform(previousObject, state.original);

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

function normaliseAngleRad(angleRad) {
  /**
   * Large comment:
   * Keep the accumulated rotation offset bounded.
   *
   * This prevents long-running infinite rotations from accumulating very large
   * floating-point values after hours of uptime.
   */
  const full = Math.PI * 2;
  return ((angleRad % full) + full) % full;
}

function applyTileRotation(state) {
  /**
   * Large comment:
   * Apply visual-only rotation directly to the local visible tile object.
   *
   * This does not mutate the TileDocument. It only changes the current client's
   * render object until Stop/Reset restores the snapshot.
   */
  const obj = state?.object;
  const base = state?.base;

  if (!isLiveDisplayObject(obj) || !base) return false;

  try {
    obj.x = base.x;
    obj.y = base.y;
    obj.rotation = base.rotation + state.appliedRotationRad;

    if (obj.scale) {
      obj.scale.set(base.scaleX, base.scaleY);
    }

    if (obj.pivot) {
      obj.pivot.set(base.pivotX, base.pivotY);
    }

    if (obj.skew) {
      obj.skew.set(base.skewX ?? 0, base.skewY ?? 0);
    }

    return true;
  } catch (err) {
    console.warn("[FX Bus] Tile Rotation: failed to apply transform to display object.", err);
    return false;
  }
}

function ensureStateStillValid(runtime, tileId, state) {
  /**
   * Large comment:
   * Confirm the stored visible render object still matches the current tile and
   * rebase when the TileDocument position, size, rotation, or visible owner changes.
   */
  const tile = getTileById(tileId);
  const currentObject = getVisibleTileObject(runtime, tileId, tile);

  if (!tile || !currentObject) return false;

  const currentDocumentState = snapshotTileDocumentState(tile);
  if (!currentDocumentState) return false;

  const objectChanged = state.object !== currentObject || !isLiveDisplayObject(state.object);
  const documentChanged = !sameTileDocumentState(state.documentState, currentDocumentState);

  if (!objectChanged && !documentChanged) return true;

  return rebaseTileRotationState(runtime, state);
}

function removeState(runtime, tileId, state, restore = true) {
  /**
   * Large comment:
   * Remove one rotation state safely.
   *
   * restore=true is used for ordinary stop/reset. Restore is skipped automatically
   * if the target display object has already been destroyed by another effect.
   */
  if (restore && state?.restoreOnStop !== false) {
    restoreTileTransform(state?.object, state?.original);
  }

  getTileMap(runtime).delete(tileId);
}

function ensureTileTicker(runtime) {
  const map = getTileMap(runtime);

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => {
    const dt = Math.max(0, Number(deltaMS) || 0) / 1000;

    for (const [tileId, state] of Array.from(map.entries())) {
      if (!ensureStateStillValid(runtime, tileId, state)) {
        removeState(runtime, tileId, state, true);
        continue;
      }

      state.appliedRotationRad = normaliseAngleRad(
        state.appliedRotationRad + (state.speedRadPerSec * dt)
      );

      const appliedOk = applyTileRotation(state);

      if (!appliedOk) {
        removeState(runtime, tileId, state, true);
        continue;
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
   * Update live rotation parameters without visual snapping.
   *
   * The accumulated appliedRotationRad is preserved, so changing speed or
   * restore behaviour does not reset the visible angle.
   */
  ensureStateStillValid(runtime, tileId, state);

  state.speedRadPerSec = params.speedRadPerSec;
  state.restoreOnStop = params.restoreOnStop;
}

function startOrUpdate(runtime, payload) {
  const map = getTileMap(runtime);
  const tileIds = normaliseTileIds(payload);
  const params = buildParams(payload);

  for (const tileId of tileIds) {
    const tile = getTileById(tileId);
    const object = getVisibleTileObject(runtime, tileId, tile);

    if (!tile || !object) {
      console.warn("[FX Bus] Tile Rotation: tile not found or has no visible render object.", { tileId });
      continue;
    }

    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(runtime, tileId, existing, params);
      continue;
    }

    const snapshot = snapshotTileTransform(object);

    if (!snapshot) {
      console.warn("[FX Bus] Tile Rotation: could not snapshot tile transform.", { tileId });
      continue;
    }

    const documentState = snapshotTileDocumentState(tile);

    if (!documentState) {
      console.warn("[FX Bus] Tile Rotation: could not snapshot tile document state.", { tileId });
      continue;
    }

    const startOffsetRad = params.randomStartOffset
      ? phaseFromId(tileId)
      : params.startOffsetRad;

    map.set(tileId, {
      tileId,
      tile,
      object,
      original: snapshot,
      base: { ...snapshot },
      documentState,
      appliedRotationRad: normaliseAngleRad(startOffsetRad),
      speedRadPerSec: params.speedRadPerSec,
      restoreOnStop: params.restoreOnStop
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

export function registerTileRotationFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTileRotationFx: invalid runtime.");
  }

  if (!runtime.tileFx) runtime.tileFx = new Map();

  runtime.handlers.set(ACTION_START, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stop(runtime, payload));
}