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
 * - anchorMode: "centre" | "top-left" | "top" | "top-right" | "left" | "right" |
 *   "bottom-left" | "bottom" | "bottom-right" | "local" | "scene"
 * - anchorLocalX: number, normalised 0..1, used when anchorMode is "local"
 * - anchorLocalY: number, normalised 0..1, used when anchorMode is "local"
 * - anchorSceneX: number, used when anchorMode is "scene"
 * - anchorSceneY: number, used when anchorMode is "scene"
 * - rotationMode: "continuous" | "oscillating"
 * - oscillationMinDeg: number, used when rotationMode is "oscillating"
 * - oscillationMaxDeg: number, used when rotationMode is "oscillating"
 * - oscillationCyclesPerSecond: number, used when rotationMode is "oscillating"
 * - oscillationCurve: "linear" | "smooth", used when rotationMode is "oscillating"
 *
 * Behaviour:
 * - Runs entirely client-side.
 * - Does not update Tile documents.
 * - Does not call tile.control(), tile.release(), or inspect tile.controlled.
 * - Does not create clones.
 * - Does not reparent tile render objects.
 * - Does not hide managed tile meshes.
 * - Animates only the local visible tile render object rotation.
 * - Old macros without anchor fields remain valid and default to centre anchor.
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
import {
  clearTileFlowVisualTransformOverride,
  getTileFlowVisualObject,
  setTileFlowVisualTransformOverride
} from "./tileFlowFx.js";

const EFFECT_NAME = "tileRotation";

const ACTION_START = "fx.tileRotation.start";
const ACTION_STOP = "fx.tileRotation.stop";
const ACTION_UPDATE = "fx.tileRotation.update";

const ANCHOR_MODE_CENTRE = "centre";

const ANCHOR_LOCAL_PRESETS = Object.freeze({
  centre: { x: 0.5, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
  "top-left": { x: 0, y: 0 },
  top: { x: 0.5, y: 0 },
  "top-right": { x: 1, y: 0 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 },
  bottom: { x: 0.5, y: 1 },
  "bottom-right": { x: 1, y: 1 }
});

const ANCHOR_MODES = new Set([
  "centre",
  "center",
  "top-left",
  "top",
  "top-right",
  "left",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
  "local",
  "scene"
]);

const ROTATION_MODE_CONTINUOUS = "continuous";
const ROTATION_MODE_OSCILLATING = "oscillating";

const ROTATION_MODES = new Set([
  ROTATION_MODE_CONTINUOUS,
  ROTATION_MODE_OSCILLATING
]);

const OSCILLATION_CURVE_LINEAR = "linear";
const OSCILLATION_CURVE_SMOOTH = "smooth";

const OSCILLATION_CURVES = new Set([
  OSCILLATION_CURVE_LINEAR,
  OSCILLATION_CURVE_SMOOTH
]);

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

function normaliseAnchorMode(value) {
  const mode = String(value ?? ANCHOR_MODE_CENTRE)
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");

  if (!ANCHOR_MODES.has(mode)) return ANCHOR_MODE_CENTRE;
  if (mode === "center") return ANCHOR_MODE_CENTRE;

  return mode;
}

function normaliseRotationMode(value) {
  const mode = String(value ?? ROTATION_MODE_CONTINUOUS)
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");

  if (!ROTATION_MODES.has(mode)) return ROTATION_MODE_CONTINUOUS;

  return mode;
}

function normaliseOscillationCurve(value) {
  const curve = String(value ?? OSCILLATION_CURVE_SMOOTH)
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");

  if (!OSCILLATION_CURVES.has(curve)) return OSCILLATION_CURVE_SMOOTH;

  return curve;
}

function normaliseCycleFrequency(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  return clamp(Math.abs(n), 0.01, 60);
}

function normaliseAngleDeg(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  return clamp(n, -3600, 3600);
}

function normalisePhase01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  return ((n % 1) + 1) % 1;
}

function normaliseUnitInterval(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;

  return clamp(n, 0, 1);
}

function finiteNumberOrNull(value) {
  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function buildParams(payload) {
  const anchorMode = normaliseAnchorMode(
    payload?.anchorMode ?? payload?.tileRotationAnchorMode
  );
  const anchorLocalX = normaliseUnitInterval(
    payload?.anchorLocalX ?? payload?.tileRotationAnchorLocalX,
    0.5
  );
  const anchorLocalY = normaliseUnitInterval(
    payload?.anchorLocalY ?? payload?.tileRotationAnchorLocalY,
    0.5
  );
  const anchorSceneX = finiteNumberOrNull(
    payload?.anchorSceneX ?? payload?.tileRotationAnchorSceneX
  );
  const anchorSceneY = finiteNumberOrNull(
    payload?.anchorSceneY ?? payload?.tileRotationAnchorSceneY
  );

  const rotationMode = normaliseRotationMode(
    payload?.rotationMode ?? payload?.tileRotationMode ?? payload?.motionMode
  );

  const minDeg = normaliseAngleDeg(
    payload?.oscillationMinDeg ?? payload?.minAngleDeg ?? payload?.tileRotationOscillationMinDeg,
    -15
  );
  const maxDeg = normaliseAngleDeg(
    payload?.oscillationMaxDeg ?? payload?.maxAngleDeg ?? payload?.tileRotationOscillationMaxDeg,
    15
  );

  const oscillationMinDeg = Math.min(minDeg, maxDeg);
  const oscillationMaxDeg = Math.max(minDeg, maxDeg);
  const startOffsetDeg = normaliseAngleDeg(payload?.startOffsetDeg ?? 0, 0);
  const oscillationPhaseDeg = normaliseAngleDeg(
    payload?.oscillationPhaseDeg ?? payload?.phaseDeg ?? startOffsetDeg,
    startOffsetDeg
  );

  return {
    speedRadPerSec: degToRad(clamp(Number(payload?.speedDegPerSec ?? 15), -1440, 1440)),
    startOffsetRad: degToRad(startOffsetDeg),
    randomStartOffset: payload?.randomStartOffset === true,
    restoreOnStop: payload?.restoreOnStop !== false,
    anchorMode: anchorMode === "scene" && (anchorSceneX === null || anchorSceneY === null)
      ? ANCHOR_MODE_CENTRE
      : anchorMode,
    anchorLocalX,
    anchorLocalY,
    anchorSceneX,
    anchorSceneY,
    rotationMode,
    oscillationMinRad: degToRad(oscillationMinDeg),
    oscillationMaxRad: degToRad(oscillationMaxDeg),
    oscillationCyclesPerSecond: normaliseCycleFrequency(
      payload?.oscillationCyclesPerSecond
        ?? payload?.cyclesPerSecond
        ?? payload?.oscillationHz
        ?? payload?.tileRotationOscillationCyclesPerSecond,
      1
    ),
    oscillationCurve: normaliseOscillationCurve(
      payload?.oscillationCurve ?? payload?.rotationCurve ?? payload?.curve ?? payload?.tileRotationOscillationCurve
    ),
    oscillationPhaseOffset01: normalisePhase01(oscillationPhaseDeg / 360)
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

function resolveAnchorLocalPoint(state) {
  /**
   * Large comment:
   * Resolve the requested anchor to a normalised tile-local point.
   *
   * Normalised coordinates are used because they survive tile resizing:
   * - 0, 0 is the top-left of the TileDocument rectangle.
   * - 0.5, 0.5 is the centre.
   * - 1, 1 is the bottom-right.
   */
  const mode = normaliseAnchorMode(state?.anchorMode);

  if (mode === "local") {
    return {
      x: normaliseUnitInterval(state?.anchorLocalX, 0.5),
      y: normaliseUnitInterval(state?.anchorLocalY, 0.5)
    };
  }

  return ANCHOR_LOCAL_PRESETS[mode] ?? ANCHOR_LOCAL_PRESETS.centre;
}

function rotateVector(x, y, rotationRad) {
  const c = Math.cos(rotationRad);
  const s = Math.sin(rotationRad);

  return {
    x: (x * c) - (y * s),
    y: (x * s) + (y * c)
  };
}

function resolveAnchorPoint(state) {
  /**
   * Large comment:
   * Resolve the anchor in the same local coordinate space as the visible tile
   * render object's x/y values.
   *
   * Centre remains exactly the existing behaviour: the object rotates in place
   * around its current render position, so old macros without anchor fields are
   * fully compatible.
   */
  const base = state?.base;
  const documentState = state?.documentState;

  if (!base) return null;

  const mode = normaliseAnchorMode(state?.anchorMode);

  if (mode === "scene") {
    const x = finiteNumberOrNull(state?.anchorSceneX);
    const y = finiteNumberOrNull(state?.anchorSceneY);

    if (x !== null && y !== null) return { x, y };
  }

  if (mode === ANCHOR_MODE_CENTRE) {
    return {
      x: base.x,
      y: base.y
    };
  }

  const width = Number(documentState?.width);
  const height = Number(documentState?.height);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return {
      x: base.x,
      y: base.y
    };
  }

  const local = resolveAnchorLocalPoint(state);
  const offsetX = (local.x - 0.5) * width;
  const offsetY = (local.y - 0.5) * height;
  const rotated = rotateVector(offsetX, offsetY, Number(base.rotation) || 0);

  return {
    x: base.x + rotated.x,
    y: base.y + rotated.y
  };
}

function refreshAnchorGeometry(state) {
  /**
   * Large comment:
   * Recalculate the fixed anchor point and the base vector from that anchor to
   * the tile object's baseline render position.
   *
   * This is called on start, update, and every rebase caused by external tile
   * movement, resizing, rotation, redraw, or Tile Flow ownership changes.
   */
  const base = state?.base;
  const anchor = resolveAnchorPoint(state);

  if (!base || !anchor) return false;

  state.anchorX = anchor.x;
  state.anchorY = anchor.y;
  state.baseVectorX = base.x - anchor.x;
  state.baseVectorY = base.y - anchor.y;

  return true;
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
    clearTileFlowVisualTransformOverride(runtime, state.tileId);

    const nextSnapshot = snapshotTileTransform(object);
    if (!nextSnapshot) return false;

    state.tile = tile;
    state.object = object;
    state.original = nextSnapshot;
    state.base = { ...nextSnapshot };
    state.documentState = currentDocumentState;

    return refreshAnchorGeometry(state);
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

  return refreshAnchorGeometry(state);
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

function applyOscillationCurve(t, curve) {
  const clamped = clamp(Number(t) || 0, 0, 1);

  if (curve === OSCILLATION_CURVE_LINEAR) return clamped;

  // Smoothstep. Gives gentler reversal at each end of the oscillation.
  return clamped * clamped * (3 - (2 * clamped));
}

function computeOscillatingRotationRad(state) {
  /**
   * Large comment:
   * Compute a bounded back-and-forth rotation angle.
   *
   * This is intentionally named generically. It covers wings, signs, doors,
   * mechanical arms, sweepers, shutters, and any tile that should reverse after
   * reaching a configured angular limit.
   */
  const minRad = Number(state?.oscillationMinRad);
  const maxRad = Number(state?.oscillationMaxRad);
  const cyclesPerSecond = Number(state?.oscillationCyclesPerSecond);

  if (![minRad, maxRad, cyclesPerSecond].every(Number.isFinite)) return 0;

  const phase = normalisePhase01(
    (Number(state.oscillationElapsedSec) || 0) * cyclesPerSecond
      + (Number(state.oscillationPhaseOffset01) || 0)
  );
  const triangle = phase < 0.5
    ? phase * 2
    : 2 - (phase * 2);
  const t = applyOscillationCurve(triangle, state.oscillationCurve);

  return minRad + ((maxRad - minRad) * t);
}

function applyTileRotation(runtime, state) {
  /**
   * Large comment:
   * Apply visual-only rotation directly to the local visible tile object.
   *
   * This does not mutate the TileDocument. It only changes the current client's
   * render object until Stop/Reset restores the snapshot.
   *
   * For centre anchors, this is equivalent to the original implementation: x/y
   * stay at the baseline and only local rotation changes. For off-centre anchors,
   * x/y orbit around the resolved anchor point while local rotation changes by
   * the same angle.
   */
  const obj = state?.object;
  const base = state?.base;

  if (!isLiveDisplayObject(obj) || !base) return false;
  if (!Number.isFinite(Number(state.anchorX)) || !Number.isFinite(Number(state.anchorY))) {
    if (!refreshAnchorGeometry(state)) return false;
  }

  try {
    const angle = Number(state.appliedRotationRad) || 0;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const baseVectorX = Number(state.baseVectorX) || 0;
    const baseVectorY = Number(state.baseVectorY) || 0;

    obj.x = state.anchorX + (baseVectorX * c) - (baseVectorY * s);
    obj.y = state.anchorY + (baseVectorX * s) + (baseVectorY * c);
    obj.rotation = base.rotation + angle;

    if (obj.scale) {
      obj.scale.set(base.scaleX, base.scaleY);
    }

    if (obj.pivot) {
      obj.pivot.set(base.pivotX, base.pivotY);
    }

    if (obj.skew) {
      obj.skew.set(base.skewX ?? 0, base.skewY ?? 0);
    }

    if (getTileFlowVisualObject(runtime, state.tileId) === obj) {
      setTileFlowVisualTransformOverride(runtime, state.tileId, {
        x: obj.x,
        y: obj.y,
        rotation: obj.rotation
      });
    } else {
      clearTileFlowVisualTransformOverride(runtime, state.tileId);
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
    clearTileFlowVisualTransformOverride(runtime, tileId);
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

      if (state.rotationMode === ROTATION_MODE_OSCILLATING) {
        state.oscillationElapsedSec = (Number(state.oscillationElapsedSec) || 0) + dt;
        state.appliedRotationRad = computeOscillatingRotationRad(state);
      } else {
        state.appliedRotationRad = normaliseAngleRad(
          state.appliedRotationRad + (state.speedRadPerSec * dt)
        );
      }

      const appliedOk = applyTileRotation(runtime, state);

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
   * Continuous rotation preserves accumulated appliedRotationRad, so changing
   * speed or restore behaviour does not reset the visible angle. Oscillating
   * rotation preserves elapsed phase unless the state is newly created.
   */
  ensureStateStillValid(runtime, tileId, state);

  state.speedRadPerSec = params.speedRadPerSec;
  state.restoreOnStop = params.restoreOnStop;
  state.anchorMode = params.anchorMode;
  state.anchorLocalX = params.anchorLocalX;
  state.anchorLocalY = params.anchorLocalY;
  state.anchorSceneX = params.anchorSceneX;
  state.anchorSceneY = params.anchorSceneY;
  state.rotationMode = params.rotationMode;
  state.oscillationMinRad = params.oscillationMinRad;
  state.oscillationMaxRad = params.oscillationMaxRad;
  state.oscillationCyclesPerSecond = params.oscillationCyclesPerSecond;
  state.oscillationCurve = params.oscillationCurve;
  state.oscillationPhaseOffset01 = params.randomStartOffset
    ? normalisePhase01(phaseFromId(tileId) / (Math.PI * 2))
    : params.oscillationPhaseOffset01;
  state.oscillationElapsedSec = Number(state.oscillationElapsedSec) || 0;

  refreshAnchorGeometry(state);
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

    const state = {
      tileId,
      tile,
      object,
      original: snapshot,
      base: { ...snapshot },
      documentState,
      appliedRotationRad: normaliseAngleRad(startOffsetRad),
      speedRadPerSec: params.speedRadPerSec,
      restoreOnStop: params.restoreOnStop,
      anchorMode: params.anchorMode,
      anchorLocalX: params.anchorLocalX,
      anchorLocalY: params.anchorLocalY,
      anchorSceneX: params.anchorSceneX,
      anchorSceneY: params.anchorSceneY,
      rotationMode: params.rotationMode,
      oscillationMinRad: params.oscillationMinRad,
      oscillationMaxRad: params.oscillationMaxRad,
      oscillationCyclesPerSecond: params.oscillationCyclesPerSecond,
      oscillationCurve: params.oscillationCurve,
      oscillationPhaseOffset01: params.randomStartOffset
        ? normalisePhase01(startOffsetRad / (Math.PI * 2))
        : params.oscillationPhaseOffset01,
      oscillationElapsedSec: 0,
      anchorX: snapshot.x,
      anchorY: snapshot.y,
      baseVectorX: 0,
      baseVectorY: 0
    };

    if (!refreshAnchorGeometry(state)) {
      console.warn("[FX Bus] Tile Rotation: could not resolve tile anchor.", { tileId });
      continue;
    }

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

export function registerTileRotationFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTileRotationFx: invalid runtime.");
  }

  if (!runtime.tileFx) runtime.tileFx = new Map();

  runtime.handlers.set(ACTION_START, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stop(runtime, payload));
}