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
 * - Animates only the local visible tile render object transform.
 * - Rebases when the TileDocument position, size, or rotation changes.
 * - Restores the original transform exactly on stop/reset where the target object
 *   still exists.
 *
 * Composition:
 * - If Tile Flow owns the visible representation, oscillate the Tile Flow container.
 * - Otherwise oscillate the managed tile render object.
 *
 * Lifecycle safety:
 * - Tile Flow may destroy its overlay while Tile Oscillation still has a reference
 *   to it, especially during manual testing or poorly ordered reset.
 * - This file must never write transforms to destroyed display objects.
 * - If the visible object changes, Oscillation rebases onto the new live object.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";
import { getTileFlowVisualObject } from "./tileFlowFx.js";
import {
  getMotionSyncPhaseRad,
  joinMotionSyncGroup,
  leaveMotionSyncGroup,
  normaliseSyncGroup,
  normaliseSyncPhaseDeg,
  sampleMotionSyncWaves
} from "./shared/motionSync.js";

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

function isLiveDisplayObject(obj) {
  /**
   * Large comment:
   * Determine whether a PIXI display object is still safe to mutate.
   *
   * A destroyed object may still be referenced by FX state, but PIXI can null
   * internal transform fields. Writing x/y/rotation to that object can then throw.
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
   * container. In that case, oscillation must target the container.
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
  const syncGroup = normaliseSyncGroup(payload?.syncGroup);

  return {
    rotationRad: degToRad(clamp(Number(payload?.rotationDeg ?? 2), -30, 30)),
    swayPx: clamp(Number(payload?.swayPx ?? 4), -200, 200),
    bobPx: clamp(Number(payload?.bobPx ?? 0), -200, 200),
    scaleAmp: clamp(Number(payload?.scalePct ?? 0), -50, 50) / 100,
    freqHz: clamp(Number(payload?.freqHz ?? 0.35), 0.01, 10),
    randomPhase: payload?.randomPhase !== false,
    syncGroup,
    syncPhaseDeg: syncGroup ? normaliseSyncPhaseDeg(payload?.syncPhaseDeg) : 0
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

function buildMotionSyncMemberKey(tileId) {
  return `tile:${tileId}`;
}

function buildMotionSyncDetails(params) {
  return {
    effectName: EFFECT_NAME,
    kind: "tile",
    freqHz: params.freqHz,
    rotationRad: params.rotationRad,
    bobPx: params.bobPx,
    swayPx: params.swayPx,
    scaleAmp: params.scaleAmp
  };
}

function leaveMotionSyncState(runtime, state) {
  if (!state) return;

  if (state.syncGroup && state.syncMemberKey) {
    leaveMotionSyncGroup(runtime, state.syncGroup, state.syncMemberKey);
  }

  state.syncGroup = null;
  state.syncPhaseDeg = 0;
}

function configureMotionSyncState(runtime, state, syncGroup, syncPhaseDeg, params) {
  const memberKey = state.syncMemberKey ?? buildMotionSyncMemberKey(state.tileId);
  const previousGroup = state.syncGroup ?? null;
  const previousMemberKey = state.syncMemberKey ?? memberKey;

  if (previousGroup && (previousGroup !== syncGroup || previousMemberKey !== memberKey)) {
    leaveMotionSyncGroup(runtime, previousGroup, previousMemberKey);
  }

  state.syncMemberKey = memberKey;

  if (!syncGroup) {
    state.syncGroup = null;
    state.syncPhaseDeg = 0;
    return;
  }

  state.syncGroup = syncGroup;
  state.syncPhaseDeg = syncPhaseDeg;

  joinMotionSyncGroup(runtime, syncGroup, memberKey, buildMotionSyncDetails(params));
}

function getSyncedPhaseRad(runtime, state) {
  let phaseRad = getMotionSyncPhaseRad(
    runtime,
    state.syncGroup,
    state.freqHz,
    state.syncPhaseDeg
  );

  if (Number.isFinite(phaseRad)) return phaseRad;

  joinMotionSyncGroup(runtime, state.syncGroup, state.syncMemberKey, buildMotionSyncDetails(state));

  phaseRad = getMotionSyncPhaseRad(
    runtime,
    state.syncGroup,
    state.freqHz,
    state.syncPhaseDeg
  );

  return Number.isFinite(phaseRad) ? phaseRad : null;
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
   * overlay, old Oscillation state may still point at that destroyed container.
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
    console.warn("[FX Bus] Tile Osc: skipped transform restore for invalid display object.", err);
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

function rebaseTileOscillationState(runtime, state) {
  /**
   * Large comment:
   * Rebase oscillation after Foundry moves, resizes, rotates, redraws the tile,
   * or Tile Flow takes over/releases the visible representation.
   *
   * Important:
   * - If the old object is destroyed, do not restore it.
   * - If the new visible object is live, snapshot that new object and continue.
   * - This allows bad stop order to recover rather than crashing the ticker.
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

function buildAppliedOffset(runtime, state, now) {
  /**
   * Large comment:
   * Compute the current oscillation offset for the visible tile object.
   */
  if (state.syncGroup) {
    const phaseRad = getSyncedPhaseRad(runtime, state);
    if (phaseRad === null) {
      return {
        x: 0,
        y: 0,
        rotation: 0,
        scaleMul: 1
      };
    }

    const waves = sampleMotionSyncWaves(phaseRad);
    if (!waves) {
      return {
        x: 0,
        y: 0,
        rotation: 0,
        scaleMul: 1
      };
    }

    return {
      x: state.swayPx * waves.swayWave,
      y: state.bobPx * waves.bobWave,
      rotation: state.rotationRad * waves.rollWave,
      scaleMul: Math.max(0.01, 1 + (state.scaleAmp * waves.bobWave))
    };
  }

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
   * Apply visual-only oscillation directly to the local visible tile object.
   *
   * This does not mutate the TileDocument. It only changes the current client's
   * render object until Stop/Reset restores the snapshot.
   */
  const obj = state?.object;
  const base = state?.base;

  if (!isLiveDisplayObject(obj) || !base) return false;

  try {
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

    return true;
  } catch (err) {
    console.warn("[FX Bus] Tile Osc: failed to apply transform to display object.", err);
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

  return rebaseTileOscillationState(runtime, state);
}

function removeState(runtime, tileId, state, restore = true) {
  /**
   * Large comment:
   * Remove one oscillation state safely.
   *
   * restore=true is used for ordinary stop/reset. Restore is skipped automatically
   * if the target display object has already been destroyed by another effect.
   */
  if (restore) {
    restoreTileTransform(state?.object, state?.original);
  }

  leaveMotionSyncState(runtime, state);
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

      const applied = buildAppliedOffset(runtime, state, now);
      const appliedOk = applyTileTransform(state, applied);

      if (!appliedOk) {
        removeState(runtime, tileId, state, true);
        continue;
      }

      state.applied = applied;
    }

    if (map.size === 0) {
      cleanupTicker(runtime, EFFECT_NAME);
    }
  });
}

function updateExistingState(runtime, tileId, state, params) {
  /**
   * Large comment:
   * Update live oscillation parameters.
   *
   * If the visible target has changed since the previous tick, rebase before
   * accepting the update so new parameters apply to the current visual object.
   */
  ensureStateStillValid(runtime, tileId, state);

  const wasSynced = Boolean(state.syncGroup);

  state.rotationRad = params.rotationRad;
  state.swayPx = params.swayPx;
  state.bobPx = params.bobPx;
  state.scaleAmp = params.scaleAmp;
  state.freqHz = params.freqHz;

  configureMotionSyncState(
    runtime,
    state,
    params.syncGroup,
    params.syncPhaseDeg,
    params
  );

  if (state.syncGroup) {
    state.phase = 0;
  } else if (wasSynced && params.randomPhase) {
    state.phase = phaseFromId(tileId);
  } else if (!params.randomPhase) {
    state.phase = 0;
  }
}

function startOrUpdate(runtime, payload) {
  const map = getTileMap(runtime);
  const tileIds = normaliseTileIds(payload);
  const params = buildParams(payload);

  for (const tileId of tileIds) {
    const tile = getTileById(tileId);
    const object = getVisibleTileObject(runtime, tileId, tile);

    if (!tile || !object) {
      console.warn("[FX Bus] Tile Osc: tile not found or has no visible render object.", { tileId });
      continue;
    }

    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(runtime, tileId, existing, params);
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

    const state = {
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
      phase: params.syncGroup ? 0 : (params.randomPhase ? phaseFromId(tileId) : 0),
      rotationRad: params.rotationRad,
      swayPx: params.swayPx,
      bobPx: params.bobPx,
      scaleAmp: params.scaleAmp,
      freqHz: params.freqHz,
      syncGroup: null,
      syncPhaseDeg: 0,
      syncMemberKey: buildMotionSyncMemberKey(tileId)
    };

    configureMotionSyncState(
      runtime,
      state,
      params.syncGroup,
      params.syncPhaseDeg,
      params
    );

    map.set(tileId, state);
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

export function registerTileOscillationFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTileOscillationFx: invalid runtime.");
  }

  if (!runtime.tileFx) runtime.tileFx = new Map();

  runtime.handlers.set(ACTION_START, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stop(runtime, payload));
}
