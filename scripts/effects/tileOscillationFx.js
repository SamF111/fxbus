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
 * - Does not animate Foundry's managed tile.mesh.
 * - Does not reparent tile.mesh.
 * - Does not wrap tile.mesh.
 * - Creates an FX-owned normal PIXI.Sprite clone from the tile mesh texture.
 * - Adds the clone as a direct child of the same parent as tile.mesh.
 * - Hides the original managed tile mesh while the clone represents it.
 * - Animates only the clone.
 * - Manually approximates foreground/overhead fade for animated clones.
 * - Restores the original tile mesh display state on stop.
 *
 * Reason:
 * - In Foundry v13, Tile meshes are PrimarySpriteMesh instances using the
 *   PrimaryCanvasGroup / batchOcclusion rendering path.
 * - Reparenting PrimaryCanvasObject instances is invalid.
 * - Mutating tile.mesh transforms every ticker can collide with Foundry render
 *   flags and Tile._refreshState.
 * - Shader-uniform and geometry-buffer attempts do not move this render path
 *   reliably.
 * - Clone rendering is the reliable visual-only path. Foreground fade is
 *   approximated manually because clones are not native occlusion meshes.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";

const EFFECT_NAME = "tileOscillation";

const ACTION_START = "fx.tileOscillation.start";
const ACTION_STOP = "fx.tileOscillation.stop";
const ACTION_UPDATE = "fx.tileOscillation.update";

const DEFAULT_FOREGROUND_FADE_ALPHA = 0.25;

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

function getTileMesh(tile) {
  /**
   * Large comment:
   * Resolve Foundry's managed tile mesh.
   *
   * The mesh is used as a source for texture, visual state, and parent only.
   * FX Bus does not animate or reparent it.
   */
  if (!tile?.mesh) return null;

  return tile.mesh;
}

function getTextureFromMesh(mesh) {
  /**
   * Large comment:
   * Resolve the texture used by Foundry's tile mesh.
   *
   * Foundry tile meshes normally expose texture directly. Some PIXI variants may
   * expose it through material.texture.
   */
  return mesh?.texture ?? mesh?.material?.texture ?? null;
}

function getCloneParent(mesh) {
  /**
   * Large comment:
   * Resolve a legal parent for the FX clone.
   *
   * The clone is a normal PIXI.Sprite, not a PrimaryCanvasObject. It may be added
   * as a direct child of the same parent as the tile mesh. Do not create a wrapper
   * around tile.mesh and do not move tile.mesh.
   */
  if (mesh?.parent?.addChild) return mesh.parent;
  if (canvas?.primary?.addChild) return canvas.primary;

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
    randomPhase: payload?.randomPhase !== false,
    foregroundFadeAlpha: clamp(
      Number(payload?.foregroundFadeAlpha ?? DEFAULT_FOREGROUND_FADE_ALPHA),
      0,
      1
    )
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

function getTileDocumentBounds(tile) {
  /**
   * Large comment:
   * Return the current document-space rectangle for a tile.
   *
   * This is the stable source of truth for positioning a plain PIXI.Sprite clone.
   */
  const doc = tile?.document;
  if (!doc) return null;

  const x = Number(doc.x);
  const y = Number(doc.y);
  const width = Number(doc.width);
  const height = Number(doc.height);

  if (![x, y, width, height].every(Number.isFinite)) return null;

  return {
    x,
    y,
    width,
    height,
    centreX: x + (width / 2),
    centreY: y + (height / 2)
  };
}

function snapshotMeshDisplayState(mesh) {
  /**
   * Large comment:
   * Capture the original display state of the managed Foundry tile mesh.
   *
   * This state is restored exactly on stop. The clone should not copy visibility
   * from the mesh after the mesh has been hidden, because that would make the
   * clone invisible too.
   */
  return {
    visible: mesh.visible,
    renderable: mesh.renderable,
    alpha: mesh.alpha,
    zIndex: mesh.zIndex,
    blendMode: mesh.blendMode,
    tint: typeof mesh.tint === "number" ? mesh.tint : null,
    filters: mesh.filters,
    cullable: mesh.cullable
  };
}

function restoreMeshDisplayState(mesh, original) {
  if (!mesh || !original) return;

  mesh.visible = original.visible;
  mesh.renderable = original.renderable;
  mesh.alpha = original.alpha;

  if (original.zIndex !== undefined) {
    mesh.zIndex = original.zIndex;
  }

  if (original.blendMode !== undefined) {
    mesh.blendMode = original.blendMode;
  }

  if (typeof original.tint === "number") {
    try {
      mesh.tint = original.tint;
    } catch {
      // ignore
    }
  }

  if (original.filters !== undefined) {
    try {
      mesh.filters = original.filters;
    } catch {
      // ignore
    }
  }

  if (original.cullable !== undefined) {
    try {
      mesh.cullable = original.cullable;
    } catch {
      // ignore
    }
  }
}

function hideManagedMesh(mesh) {
  /**
   * Large comment:
   * Hide the original Foundry-managed mesh while the FX clone represents it.
   *
   * This is a display-state change only. The mesh is not moved, reparented, or
   * animated.
   */
  if (!mesh) return;

  mesh.visible = false;
}

function copyStableVisualStateToClone(mesh, clone, original) {
  /**
   * Large comment:
   * Copy stable visual appearance to the clone.
   *
   * This is used at clone creation. It deliberately uses the original mesh state
   * captured before FX Bus hid the managed mesh.
   */
  if (!mesh || !clone) return;

  clone.visible = original?.visible !== false;
  clone.renderable = original?.renderable !== false;
  clone.alpha = Number.isFinite(original?.alpha) ? original.alpha : 1;

  if (typeof original?.tint === "number") {
    clone.tint = original.tint;
  } else if (typeof mesh.tint === "number") {
    clone.tint = mesh.tint;
  }

  if (original?.blendMode !== undefined) {
    clone.blendMode = original.blendMode;
  } else if (mesh.blendMode !== undefined) {
    clone.blendMode = mesh.blendMode;
  }

  if (original?.filters !== undefined) {
    clone.filters = Array.isArray(original.filters)
      ? [...original.filters]
      : original.filters;
  }

  if (mesh.zIndex !== undefined) {
    clone.zIndex = mesh.zIndex;
  }

  clone.cullable = mesh.cullable === true;
}

function getTileDocumentRotationRad(tile) {
  const rotationDeg = Number(tile?.document?.rotation ?? 0);

  return degToRad(Number.isFinite(rotationDeg) ? rotationDeg : 0);
}

function copyMeshTransformToClone(tile, mesh, clone) {
  /**
   * Large comment:
   * Copy the tile's document-space visual rectangle to the FX clone.
   *
   * A Foundry Tile mesh is not geometrically equivalent to a plain PIXI.Sprite.
   * Copying mesh.x/y/scale directly causes the clone to appear offset or at the
   * wrong size. The document rectangle is the stable source of truth for where
   * the tile should appear on the canvas.
   */
  if (!tile?.document || !mesh || !clone) return null;

  const bounds = getTileDocumentBounds(tile);
  if (!bounds) return null;

  clone.anchor.set(0.5, 0.5);

  clone.x = bounds.centreX;
  clone.y = bounds.centreY;
  clone.rotation = getTileDocumentRotationRad(tile);

  clone.width = Math.abs(bounds.width);
  clone.height = Math.abs(bounds.height);

  if (clone.pivot) {
    clone.pivot.set(0, 0);
  }

  if (clone.skew) {
    clone.skew.set(0, 0);
  }

  return {
    x: clone.x,
    y: clone.y,
    rotation: clone.rotation,
    scaleX: clone.scale.x,
    scaleY: clone.scale.y,
    pivotX: clone.pivot?.x ?? 0,
    pivotY: clone.pivot?.y ?? 0,
    skewX: clone.skew?.x ?? 0,
    skewY: clone.skew?.y ?? 0
  };
}

function createCloneFromMesh(tile, mesh, texture, parent, original) {
  /**
   * Large comment:
   * Create a normal PIXI.Sprite clone for the tile texture.
   *
   * This intentionally does not clone or move the Foundry PrimarySpriteMesh.
   * The clone is ordinary PIXI and FX-owned.
   */
  const clone = new PIXI.Sprite(texture);

  clone.name = `fxbus-tileOscillation-${tile.id}`;
  clone.eventMode = "none";
  clone.interactive = false;
  clone.interactiveChildren = false;
  clone.sortableChildren = false;

  if (clone.anchor) {
    clone.anchor.set(0);
  }

  copyStableVisualStateToClone(mesh, clone, original);
  const base = copyMeshTransformToClone(tile, mesh, clone);

  if (!base) {
    clone.destroy?.();
    return null;
  }

  try {
    parent.addChild(clone);
  } catch (err) {
    console.warn("[FX Bus] Tile Osc: failed to add FX clone.", {
      tileId: tile.id,
      err
    });
    clone.destroy?.();
    return null;
  }

  return {
    clone,
    base
  };
}

function createTileFxClone(tile) {
  /**
   * Large comment:
   * Create an isolated FX clone for a Foundry tile.
   *
   * The managed mesh remains in its legal Foundry parent. FX Bus only hides it
   * and adds a separate normal PIXI.Sprite clone to the same parent.
   */
  const mesh = getTileMesh(tile);
  const texture = getTextureFromMesh(mesh);
  const parent = getCloneParent(mesh);

  if (!mesh || !texture || !parent) {
    console.warn("[FX Bus] Tile Osc: cannot create clone.", {
      tileId: tile?.id,
      hasMesh: Boolean(mesh),
      hasTexture: Boolean(texture),
      hasParent: Boolean(parent)
    });
    return null;
  }

  const original = snapshotMeshDisplayState(mesh);
  const cloneState = createCloneFromMesh(tile, mesh, texture, parent, original);

  if (!cloneState) return null;

  hideManagedMesh(mesh);

  return {
    tileId: tile.id,
    mesh,
    clone: cloneState.clone,
    parent,
    original,
    base: cloneState.base,
    applied: {
      x: 0,
      y: 0,
      rotation: 0,
      scaleMul: 1
    }
  };
}

function destroyTileFxClone(state) {
  /**
   * Large comment:
   * Destroy the FX clone and restore the original managed tile mesh display
   * state.
   *
   * No transform restore is required because the original tile mesh was never
   * animated by FX Bus.
   */
  if (!state) return;

  restoreMeshDisplayState(state.mesh, state.original);

  try {
    if (state.clone?.parent) {
      state.clone.parent.removeChild(state.clone);
    }
  } catch {
    // ignore
  }

  try {
    state.clone?.destroy?.({ children: true });
  } catch {
    try {
      state.clone?.destroy?.();
    } catch {
      // ignore
    }
  }

  state.clone = null;
  state.mesh = null;
  state.parent = null;
}

function ensureCloneStillValid(tileId, state) {
  /**
   * Large comment:
   * Check whether the FX clone and source mesh are still usable.
   *
   * If Foundry has redrawn the scene and replaced the tile mesh, rebuild the
   * clone from the current tile.
   */
  const tile = getTileById(tileId);
  const mesh = getTileMesh(tile);

  if (!tile || !mesh) return false;

  const sameMesh = state?.mesh === mesh;
  const cloneOk = state?.clone && !state.clone.destroyed;

  if (sameMesh && cloneOk) return true;

  destroyTileFxClone(state);

  const rebuilt = createTileFxClone(tile);
  if (!rebuilt) return false;

  state.mesh = rebuilt.mesh;
  state.clone = rebuilt.clone;
  state.parent = rebuilt.parent;
  state.original = rebuilt.original;
  state.base = rebuilt.base;
  state.applied = rebuilt.applied;

  return true;
}

function getTokenCentre(token) {
  /**
   * Large comment:
   * Return a token centre point in scene coordinates.
   *
   * Foundry tokens expose both document coordinates and placeable dimensions.
   * Use the placeable dimensions where available because they reflect current
   * canvas state.
   */
  if (!token) return null;

  const x = Number(token.x ?? token.document?.x);
  const y = Number(token.y ?? token.document?.y);
  const width = Number(token.w ?? token.width ?? token.document?.width ?? 0);
  const height = Number(token.h ?? token.height ?? token.document?.height ?? 0);

  if (![x, y, width, height].every(Number.isFinite)) return null;

  return {
    x: x + (width / 2),
    y: y + (height / 2)
  };
}

function pointInTileBounds(tile, point) {
  /**
   * Large comment:
   * Conservative point-in-tile test using the tile document rectangle.
   *
   * This intentionally ignores rotation. For foreground fade this is preferable
   * to missing fades on irregular or rotated decorative tiles.
   */
  if (!point) return false;

  const bounds = getTileDocumentBounds(tile);
  if (!bounds) return false;

  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function isForegroundOrOverheadTile(tile) {
  /**
   * Large comment:
   * Identify tiles likely to need foreground fade approximation.
   *
   * Foundry tile document fields can vary by version and module. The checks are
   * deliberately broad and conservative:
   * - overhead true
   * - roof true
   * - occlusion mode non-zero / non-none
   * - elevation above zero
   */
  const doc = tile?.document;
  if (!doc) return false;

  if (doc.overhead === true) return true;
  if (doc.roof === true) return true;

  const occlusionMode = doc.occlusion?.mode;
  if (typeof occlusionMode === "number" && occlusionMode !== 0) return true;
  if (typeof occlusionMode === "string" && occlusionMode !== "" && occlusionMode !== "none") return true;

  const elevation = Number(doc.elevation ?? 0);
  if (Number.isFinite(elevation) && elevation > 0) return true;

  return false;
}

function getHoveredToken() {
  /**
   * Large comment:
   * Return the currently hovered token where Foundry exposes one.
   *
   * The exact hovered object field varies between versions/modules, so check
   * common places and fall back safely.
   */
  const hovered = canvas?.tokens?.hover;

  if (hovered) return hovered;

  return canvas?.tokens?.placeables?.find((token) => token.hover === true) ?? null;
}

function getRelevantTokensForManualFade() {
  /**
   * Large comment:
   * Return tokens that should trigger manual foreground fade.
   *
   * Priority:
   * - controlled tokens
   * - hovered token
   * - current user's assigned character token on the active scene, if present
   *
   * This approximates the useful player-facing behaviour without depending on
   * Foundry's internal occlusion shader path.
   */
  const tokens = new Set();

  for (const token of canvas?.tokens?.controlled ?? []) {
    tokens.add(token);
  }

  const hovered = getHoveredToken();
  if (hovered) tokens.add(hovered);

  const character = game?.user?.character;
  if (character) {
    for (const token of canvas?.tokens?.placeables ?? []) {
      if (token.actor?.id === character.id) {
        tokens.add(token);
      }
    }
  }

  return Array.from(tokens);
}

function shouldManuallyFadeClone(tile) {
  /**
   * Large comment:
   * Decide whether an animated tile clone should be faded.
   *
   * Only foreground/overhead-like tiles fade. The fade is triggered when a
   * relevant token centre sits inside the tile document rectangle.
   */
  if (!isForegroundOrOverheadTile(tile)) return false;

  const tokens = getRelevantTokensForManualFade();

  return tokens.some((token) => pointInTileBounds(tile, getTokenCentre(token)));
}

function copyDynamicVisualStateToClone(tile, mesh, clone, original, foregroundFadeAlpha) {
  /**
   * Large comment:
   * Mirror safe dynamic visual state to the FX clone.
   *
   * Do not copy mesh.visible. FX Bus intentionally sets mesh.visible = false.
   * Copying that would make the clone invisible too.
   *
   * The manual foreground fade is applied on top of the original/source alpha.
   */
  if (!tile || !mesh || !clone) return;

  clone.visible = original?.visible !== false;
  clone.renderable = original?.renderable !== false;

  const sourceAlpha = Number(mesh.alpha);
  const originalAlpha = Number(original?.alpha);

  const baseAlpha = Number.isFinite(sourceAlpha)
    ? sourceAlpha
    : Number.isFinite(originalAlpha)
      ? originalAlpha
      : 1;

  const shouldFade = shouldManuallyFadeClone(tile);
  const fadeAlpha = Number.isFinite(foregroundFadeAlpha)
    ? foregroundFadeAlpha
    : DEFAULT_FOREGROUND_FADE_ALPHA;

  clone.alpha = shouldFade
    ? Math.min(baseAlpha, fadeAlpha)
    : baseAlpha;

  if (typeof mesh.tint === "number") {
    clone.tint = mesh.tint;
  } else if (typeof original?.tint === "number") {
    clone.tint = original.tint;
  }

  if (mesh.blendMode !== undefined) {
    clone.blendMode = mesh.blendMode;
  } else if (original?.blendMode !== undefined) {
    clone.blendMode = original.blendMode;
  }

  if (mesh.filters !== undefined) {
    clone.filters = Array.isArray(mesh.filters)
      ? [...mesh.filters]
      : mesh.filters;
  } else if (original?.filters !== undefined) {
    clone.filters = Array.isArray(original.filters)
      ? [...original.filters]
      : original.filters;
  }

  if (mesh.zIndex !== undefined) {
    clone.zIndex = mesh.zIndex;
  }

  clone.cullable = mesh.cullable === true;
}

function syncCloneBaseFromMesh(state) {
  /**
   * Large comment:
   * Read the current Tile document rectangle and copy it to the clone as the
   * base transform.
   *
   * Do not copy raw mesh transform onto a plain Sprite. The Foundry tile mesh
   * and a PIXI.Sprite do not share equivalent local geometry.
   */
  if (!state?.mesh || !state?.clone) return null;

  const tile = getTileById(state.tileId);
  if (!tile) return null;

  const base = copyMeshTransformToClone(tile, state.mesh, state.clone);

  copyDynamicVisualStateToClone(
    tile,
    state.mesh,
    state.clone,
    state.original,
    state.foregroundFadeAlpha
  );

  hideManagedMesh(state.mesh);

  return base;
}

function buildAppliedOffset(state, now) {
  /**
   * Large comment:
   * Compute the current oscillation offset for the FX clone.
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

function applyCloneTransform(state, applied) {
  /**
   * Large comment:
   * Apply visual-only oscillation to the FX clone.
   *
   * This function never mutates Foundry's managed tile mesh.
   */
  const clone = state?.clone;
  const base = state?.base;

  if (!clone || !base) return;

  clone.x = base.x + applied.x;
  clone.y = base.y + applied.y;
  clone.rotation = base.rotation + applied.rotation;

  clone.scale.set(
    base.scaleX * applied.scaleMul,
    base.scaleY * applied.scaleMul
  );

  if (clone.pivot) {
    clone.pivot.set(base.pivotX, base.pivotY);
  }

  if (clone.skew) {
    clone.skew.set(base.skewX ?? 0, base.skewY ?? 0);
  }
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
      if (!ensureCloneStillValid(tileId, state)) {
        destroyTileFxClone(state);
        map.delete(tileId);
        continue;
      }

      const base = syncCloneBaseFromMesh(state);
      if (!base) {
        destroyTileFxClone(state);
        map.delete(tileId);
        continue;
      }

      state.base = base;

      const applied = buildAppliedOffset(state, now);
      applyCloneTransform(state, applied);
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
   * Update live oscillation parameters without recreating the clone.
   *
   * Existing phase and start time are preserved unless randomPhase is explicitly
   * disabled.
   */
  state.rotationRad = params.rotationRad;
  state.swayPx = params.swayPx;
  state.bobPx = params.bobPx;
  state.scaleAmp = params.scaleAmp;
  state.freqHz = params.freqHz;
  state.foregroundFadeAlpha = params.foregroundFadeAlpha;

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
    const mesh = getTileMesh(tile);

    if (!tile || !mesh) {
      console.warn("[FX Bus] Tile Osc: tile not found or has no mesh.", { tileId });
      continue;
    }

    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(existing, params);

      const base = syncCloneBaseFromMesh(existing);
      if (base) existing.base = base;

      continue;
    }

    const cloneState = createTileFxClone(tile);
    if (!cloneState) continue;

    map.set(tileId, {
      tileId,
      mesh: cloneState.mesh,
      clone: cloneState.clone,
      parent: cloneState.parent,
      original: cloneState.original,
      base: cloneState.base,
      applied: cloneState.applied,
      startedAt: performance.now(),
      phase: params.randomPhase ? phaseFromId(tileId) : 0,
      rotationRad: params.rotationRad,
      swayPx: params.swayPx,
      bobPx: params.bobPx,
      scaleAmp: params.scaleAmp,
      freqHz: params.freqHz,
      foregroundFadeAlpha: params.foregroundFadeAlpha
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

    destroyTileFxClone(state);
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