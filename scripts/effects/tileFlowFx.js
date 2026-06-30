// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tileFlowFx.js

/**
 * FX Bus - Tile Flow FX
 *
 * Purpose:
 * - Apply visual-only velocity-driven texture flow to scene tiles identified by tileIds.
 * - Designed for roads, conveyor belts, cloud layers, smoke banks, water currents,
 *   data streams, forcefield shimmer, factory machinery, and cinematic chase scenes.
 *
 * Actions:
 * - fx.tileFlow.start
 * - fx.tileFlow.stop
 * - fx.tileFlow.update
 *
 * Payload fields:
 * - tileIds: string[]
 * - angleDeg: number
 * - startSpeedPxPerSec: number
 * - accelerationMode: "none" | "linear" | "sine" | "easeIn" | "easeOut" | "easeInOut"
 * - accelerationPxPerSec2: number
 * - accelerationDurationMs: number
 * - durationMs: number
 * - completionMode: "reset" | "retain"
 * - stopMode: "reset" | "retain"
 * - forceReset: boolean
 * - randomPhase: boolean
 * - overlayAlpha: number
 * - blendMode: string
 * - repeatScale: number
 *
 * Behaviour:
 * - Runs entirely client-side.
 * - Does not update Tile documents.
 * - Does not mutate tile texture offsets in document data.
 * - Does not call tile.control(), tile.release(), or inspect tile.controlled.
 * - Does not shader-modify the Foundry-managed tile mesh.
 * - Creates a passive PIXI.TilingSprite overlay beside the real tile render object.
 * - Temporarily hides the original tile render object by alpha while the overlay is active.
 * - Restores the original tile render object alpha on stop/reset.
 * - The overlay follows the tile render object's parent, position, rotation, pivot, skew,
 *   visibility, renderability, blend mode, zIndex, and document dimensions.
 * - The overlay deliberately does not inherit object.scale, because Foundry tile meshes may
 *   already bake document sizing into their geometry.
 * - The overlay is clipped to the TileDocument rectangle.
 * - Stop/reset destroys only the overlay, mask, and any FX-owned temporary texture.
 *
 * Foundry v13/v14 compatibility:
 * - The overlay is inserted into the tile render object's actual parent.
 * - Therefore its position/rotation must come from the render object, not from
 *   TileDocument scene coordinates.
 * - The sprite/mask dimensions still come from TileDocument width/height.
 * - Do not use object.getLocalBounds(); in Foundry v14 it can expose texture/internal
 *   bounds and make the whole tile image repeat as miniature copies.
 *
 * Long-running stability:
 * - Accumulated tile flow phase is wrapped to a large phase-safe pixel range.
 * - Wrap spans are whole displayed texture repeat periods, preventing visible snap.
 * - This prevents very long-running flows from building huge tilePosition values.
 * - Force reset always overrides retain behaviour.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";

const EFFECT_NAME = "tileFlow";

const ACTION_START = "fx.tileFlow.start";
const ACTION_STOP = "fx.tileFlow.stop";
const ACTION_UPDATE = "fx.tileFlow.update";

const STATUS_RUNNING = "running";
const STATUS_HELD = "held";

const MODE_RESET = "reset";
const MODE_RETAIN = "retain";

const ACCEL_NONE = "none";
const ACCEL_LINEAR = "linear";
const ACCEL_SINE = "sine";
const ACCEL_EASE_IN = "easeIn";
const ACCEL_EASE_OUT = "easeOut";
const ACCEL_EASE_IN_OUT = "easeInOut";

const DEFAULT_ACCELERATION_DURATION_MS = 5000;
const MIN_SCALE = 0.0001;
const BLEED_PX = 2;
const Z_ORDER_EPSILON = 0.0001;
const PHASE_WRAP_THRESHOLD_PX = 100000;

let warnedBleedFailure = false;

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
   * Tile Flow does not replace this object. It uses the object as the
   * authoritative render-context source for the passive overlay.
   */
  if (!tile) return null;
  if (tile.mesh) return tile.mesh;
  if (tile.tile) return tile.tile;

  return null;
}

function getTextureFromObject(object) {
  return object?.texture ?? object?.material?.texture ?? null;
}

function getTextureFrame(texture) {
  /**
   * Large comment:
   * Resolve the source frame used by the texture on its base texture.
   *
   * The bleed texture duplicates pixels around this frame. This is safer than
   * assuming the texture occupies the whole base texture, because PIXI textures
   * may be framed or atlased.
   */
  const frame = texture?.frame;

  const x = Number(frame?.x ?? 0);
  const y = Number(frame?.y ?? 0);
  const width =
    Number(frame?.width) ||
    Number(texture?.orig?.width) ||
    Number(texture?.width) ||
    1;
  const height =
    Number(frame?.height) ||
    Number(texture?.orig?.height) ||
    Number(texture?.height) ||
    1;

  return {
    x,
    y,
    width: Math.max(1, Math.abs(width)),
    height: Math.max(1, Math.abs(height))
  };
}

function getTextureDimensions(texture) {
  /**
   * Large comment:
   * Resolve source texture dimensions from PIXI texture fields.
   *
   * Prefer frame dimensions for Tile Flow because framed textures are what the
   * TilingSprite actually samples. Fall back to orig/baseTexture/direct fields.
   */
  const frame = getTextureFrame(texture);

  const width =
    Number(frame.width) ||
    Number(texture?.orig?.width) ||
    Number(texture?.baseTexture?.width) ||
    Number(texture?.width) ||
    1;

  const height =
    Number(frame.height) ||
    Number(texture?.orig?.height) ||
    Number(texture?.baseTexture?.height) ||
    Number(texture?.height) ||
    1;

  return {
    width: Math.max(1, Math.abs(width)),
    height: Math.max(1, Math.abs(height))
  };
}

function getTileTextureScale(documentState, texture, repeatScale) {
  /**
   * Large comment:
   * Compute the tileScale that makes a TilingSprite display the same apparent
   * image scale as the real Foundry tile.
   */
  const textureSize = getTextureDimensions(texture);

  const baseScaleX = documentState.width / textureSize.width;
  const baseScaleY = documentState.height / textureSize.height;

  const repeat = clamp(Number(repeatScale ?? 1), 0.05, 20);

  return {
    x: Math.max(MIN_SCALE, baseScaleX * repeat),
    y: Math.max(MIN_SCALE, baseScaleY * repeat),
    baseX: Math.max(MIN_SCALE, baseScaleX),
    baseY: Math.max(MIN_SCALE, baseScaleY),
    textureWidth: textureSize.width,
    textureHeight: textureSize.height
  };
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

function normaliseMode(value, fallback = MODE_RESET) {
  const mode = String(value ?? "").trim().toLowerCase();

  if (mode === MODE_RETAIN) return MODE_RETAIN;
  if (mode === MODE_RESET) return MODE_RESET;

  return fallback;
}

function normaliseAccelerationMode(value) {
  const mode = String(value ?? ACCEL_NONE).trim();

  if (mode === ACCEL_LINEAR) return ACCEL_LINEAR;
  if (mode === ACCEL_SINE) return ACCEL_SINE;
  if (mode === ACCEL_EASE_IN) return ACCEL_EASE_IN;
  if (mode === ACCEL_EASE_OUT) return ACCEL_EASE_OUT;
  if (mode === ACCEL_EASE_IN_OUT) return ACCEL_EASE_IN_OUT;
  if (mode === ACCEL_NONE) return ACCEL_NONE;

  return ACCEL_NONE;
}

function normaliseBlendMode(value) {
  const key = String(value ?? "NORMAL").trim().toUpperCase();

  const blendModes = PIXI?.BLEND_MODES ?? {};
  if (Object.prototype.hasOwnProperty.call(blendModes, key)) {
    return blendModes[key];
  }

  return blendModes.NORMAL ?? 0;
}

function buildParams(payload) {
  const accelerationMode = normaliseAccelerationMode(payload?.accelerationMode ?? ACCEL_NONE);

  return {
    angleDeg: clamp(Number(payload?.angleDeg ?? 90), -3600, 3600),
    startSpeedPxPerSec: clamp(Number(payload?.startSpeedPxPerSec ?? 120), -5000, 5000),
    accelerationMode,
    accelerationPxPerSec2: clamp(Number(payload?.accelerationPxPerSec2 ?? 0), -5000, 5000),
    accelerationDurationMs: clamp(
      Number(payload?.accelerationDurationMs ?? DEFAULT_ACCELERATION_DURATION_MS),
      0,
      3_600_000
    ),
    durationMs: clamp(Number(payload?.durationMs ?? 0), 0, 3_600_000),
    completionMode: normaliseMode(payload?.completionMode, MODE_RESET),
    randomPhase: payload?.randomPhase !== false,
    overlayAlpha: clamp(Number(payload?.overlayAlpha ?? 1), 0, 1),
    repeatScale: clamp(Number(payload?.repeatScale ?? 1), 0.05, 20),
    blendMode: normaliseBlendMode(payload?.blendMode ?? "NORMAL")
  };
}

function snapshotTileDocumentState(tile) {
  /**
   * Large comment:
   * Snapshot the TileDocument placement fields used to size the overlay.
   *
   * This is read-only. It does not mutate the document.
   *
   * Do not use x/y from this snapshot to position the overlay after it has been
   * inserted into the tile render object's parent. Use the render object's
   * local position instead.
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
    width: Math.max(1, Math.abs(width)),
    height: Math.max(1, Math.abs(height)),
    rotation
  };
}

function sameDocumentShape(a, b) {
  if (!a || !b) return false;

  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height &&
    a.rotation === b.rotation
  );
}

function configurePassiveDisplayObject(object) {
  /**
   * Large comment:
   * Ensure FX overlay display objects never block normal Foundry canvas
   * interaction, including native tile selection.
   */
  if (!object) return;

  object.eventMode = "none";
  object.interactive = false;
  object.interactiveChildren = false;
}

function drawMask(mask, width, height) {
  if (!mask) return;

  mask.clear();
  mask.beginFill(0xffffff, 1);
  mask.drawRect(
    -width / 2,
    -height / 2,
    width,
    height
  );
  mask.endFill();
}

function resetOverlayGeometryToDocumentShape(state) {
  /**
   * Large comment:
   * Keep the overlay sprite and mask sized to the TileDocument rectangle.
   *
   * The container follows the Foundry tile render object's position/rotation.
   * The overlay's own drawable area remains the document tile rectangle.
   *
   * Do not use object.getLocalBounds() here. In Foundry v14 this can report
   * texture/internal bounds, which makes the overlay repeat the whole tile image
   * many times inside itself.
   */
  if (!state?.sprite || !state?.mask || !state?.documentState) return;

  const width = Math.max(1, Number(state.documentState.width ?? 1));
  const height = Math.max(1, Number(state.documentState.height ?? 1));

  state.sprite.x = -width / 2;
  state.sprite.y = -height / 2;
  state.sprite.width = width;
  state.sprite.height = height;

  state.mask.x = 0;
  state.mask.y = 0;

  drawMask(state.mask, width, height);
}

function copyPointLike(target, source, fallbackX = 0, fallbackY = 0) {
  /**
   * Large comment:
   * Copy PIXI point-like values without assuming copyFrom exists.
   */
  if (!target) return;

  if (source && typeof target.copyFrom === "function") {
    try {
      target.copyFrom(source);
      return;
    } catch {
      // Fall through to direct assignment.
    }
  }

  target.x = Number.isFinite(Number(source?.x)) ? Number(source.x) : fallbackX;
  target.y = Number.isFinite(Number(source?.y)) ? Number(source.y) : fallbackY;
}

function restoreOriginalTileObject(state) {
  /**
   * Large comment:
   * Restore the Foundry-managed tile render object's alpha after Tile Flow ends
   * or when Foundry replaces the render object.
   */
  if (!state?.object || !state.originalObjectAlphaCaptured) return;

  try {
    state.object.alpha = Number.isFinite(Number(state.originalObjectAlpha))
      ? Number(state.originalObjectAlpha)
      : 1;
  } catch {
    // ignore
  }

  state.originalObjectAlphaCaptured = false;
}

function captureOriginalTileObjectAlpha(state, object) {
  /**
   * Large comment:
   * Capture the original alpha exactly once per render object.
   */
  if (!state || !object || state.originalObjectAlphaCaptured) return;

  state.originalObjectAlpha = Number.isFinite(Number(object.alpha))
    ? Number(object.alpha)
    : 1;
  state.originalObjectAlphaCaptured = true;
}

function hideOriginalTileObject(state, object) {
  /**
   * Large comment:
   * Hide the Foundry-managed tile render object while Tile Flow owns the visible
   * animated replacement.
   *
   * This remains visual-only. It does not mutate TileDocument data.
   */
  if (!state || !object) return;

  captureOriginalTileObjectAlpha(state, object);

  try {
    object.alpha = 0;
  } catch {
    // ignore
  }
}

function getOriginalTileObjectAlpha(state, object) {
  /**
   * Large comment:
   * Return the tile render object's effective pre-FX alpha.
   *
   * Once the original object is hidden, object.alpha is zero. The overlay must
   * still use the captured pre-FX alpha as its visibility basis.
   */
  if (state?.originalObjectAlphaCaptured) {
    const captured = Number(state.originalObjectAlpha);
    return Number.isFinite(captured) ? captured : 1;
  }

  const live = Number(object?.alpha);
  return Number.isFinite(live) ? live : 1;
}

function syncOverlayTransformToTileObject(state, object) {
  /**
   * Large comment:
   * Sync the overlay container to the Foundry tile render object's local
   * placement while keeping overlay geometry document-sized.
   *
   * Critical rule:
   * - The overlay is inserted into object.parent, so position/rotation/pivot/skew
   *   come from the render object.
   * - The overlay sprite and mask are sized from TileDocument.
   * - Do not copy object.scale. Foundry's tile render object may already bake
   *   document dimensions into its mesh/texture mapping. Copying object.scale
   *   causes the v14 small-overlay failure.
   */
  if (!state?.container || !object) return;

  copyPointLike(
    state.container.position,
    object.position,
    Number(object.x ?? 0),
    Number(object.y ?? 0)
  );

  state.container.rotation = Number.isFinite(Number(object.rotation))
    ? Number(object.rotation)
    : degToRad(Number(state.documentState?.rotation ?? 0));

  if (state.container.scale) {
    state.container.scale.set(1, 1);
  }

  if (state.container.pivot) {
    copyPointLike(state.container.pivot, object.pivot, 0, 0);
  }

  if (state.container.skew && object.skew) {
    copyPointLike(state.container.skew, object.skew, 0, 0);
  }

  resetOverlayGeometryToDocumentShape(state);
}

function normaliseExternalVisualTransform(transform) {
  /**
   * Large comment:
   * Normalise a transform supplied by another visual-only tile effect.
   *
   * Tile Flow owns the overlay container while it is active. Other effects, such
   * as Tile Rotation, may need to compose an additional visual transform on top
   * of Tile Flow's base sync-to-tile transform. The override is deliberately
   * local render state only; it is never written back to the TileDocument.
   */
  if (!transform || typeof transform !== "object") return null;

  const x = Number(transform.x);
  const y = Number(transform.y);
  const rotation = Number(transform.rotation);

  if (![x, y, rotation].every(Number.isFinite)) return null;

  return {
    x,
    y,
    rotation
  };
}

function applyExternalVisualTransform(state) {
  /**
   * Large comment:
   * Re-apply a composed visual transform after Tile Flow has synchronised its
   * overlay back to the underlying tile render object.
   *
   * Without this hook, Tile Flow's ticker can overwrite Tile Rotation's overlay
   * transform on whichever client happens to tick Flow after Rotation. Keeping
   * the composition here makes the result deterministic in both Foundry v13 and
   * Foundry v14.
   */
  const transform = normaliseExternalVisualTransform(state?.externalVisualTransform);
  const container = state?.container;

  if (!transform || !container || container.destroyed) return false;

  try {
    container.x = transform.x;
    container.y = transform.y;
    container.rotation = transform.rotation;
    return true;
  } catch (err) {
    console.warn("[FX Bus] Tile Flow: failed to apply external visual transform.", err);
    return false;
  }
}

function createSubTexture(sourceTexture, x, y, width, height) {
  /**
   * Large comment:
   * Create a small texture frame from the same base texture as the tile.
   *
   * These temporary subtextures are only used to render the bleeded texture once.
   * They are destroyed without destroying the shared base texture.
   */
  const baseTexture = sourceTexture?.baseTexture;
  if (!baseTexture) return null;

  const frame = new PIXI.Rectangle(x, y, width, height);

  return new PIXI.Texture(baseTexture, frame);
}

function addSprite(container, texture, x, y) {
  if (!container || !texture) return null;

  const sprite = new PIXI.Sprite(texture);
  sprite.x = x;
  sprite.y = y;
  sprite.roundPixels = false;
  sprite.eventMode = "none";
  sprite.interactive = false;
  sprite.interactiveChildren = false;

  container.addChild(sprite);
  return sprite;
}

function renderToTexture(renderer, container, renderTexture) {
  /**
   * Large comment:
   * Render to a RenderTexture while tolerating PIXI v6/v7 signature differences.
   */
  try {
    renderer.render(container, {
      renderTexture,
      clear: true
    });
    return true;
  } catch {
    try {
      renderer.render(container, renderTexture, true);
      return true;
    } catch {
      return false;
    }
  }
}

function destroyTemporarySubTextures(textures) {
  for (const texture of textures) {
    try {
      texture?.destroy?.(false);
    } catch {
      // ignore
    }
  }
}

function createBleededFlowTexture(sourceTexture) {
  /**
   * Large comment:
   * Create a temporary texture with a small duplicated-pixel border.
   *
   * The returned texture is a framed texture over the centre of the padded render
   * texture. Its frame remains the original source size, so tileScale and repeat
   * cadence stay correct, while linear filtering near the seam can sample the
   * duplicated edge pixels outside the frame.
   */
  const renderer = canvas?.app?.renderer;
  if (!renderer || !sourceTexture?.baseTexture || !PIXI?.RenderTexture) return null;

  const frame = getTextureFrame(sourceTexture);
  const bleed = Math.max(
    1,
    Math.min(
      BLEED_PX,
      Math.floor(frame.width / 2),
      Math.floor(frame.height / 2)
    )
  );

  if (bleed < 1) return null;

  const paddedWidth = frame.width + (bleed * 2);
  const paddedHeight = frame.height + (bleed * 2);

  let renderTexture = null;
  let flowTexture = null;
  let container = null;
  const temporarySubTextures = [];

  try {
    renderTexture = PIXI.RenderTexture.create({
      width: paddedWidth,
      height: paddedHeight,
      resolution: 1
    });

    container = new PIXI.Container();
    container.roundPixels = false;
    configurePassiveDisplayObject(container);

    const left = createSubTexture(
      sourceTexture,
      frame.x + frame.width - bleed,
      frame.y,
      bleed,
      frame.height
    );
    const right = createSubTexture(
      sourceTexture,
      frame.x,
      frame.y,
      bleed,
      frame.height
    );
    const top = createSubTexture(
      sourceTexture,
      frame.x,
      frame.y + frame.height - bleed,
      frame.width,
      bleed
    );
    const bottom = createSubTexture(
      sourceTexture,
      frame.x,
      frame.y,
      frame.width,
      bleed
    );

    const topLeft = createSubTexture(
      sourceTexture,
      frame.x + frame.width - bleed,
      frame.y + frame.height - bleed,
      bleed,
      bleed
    );
    const topRight = createSubTexture(
      sourceTexture,
      frame.x,
      frame.y + frame.height - bleed,
      bleed,
      bleed
    );
    const bottomLeft = createSubTexture(
      sourceTexture,
      frame.x + frame.width - bleed,
      frame.y,
      bleed,
      bleed
    );
    const bottomRight = createSubTexture(
      sourceTexture,
      frame.x,
      frame.y,
      bleed,
      bleed
    );

    temporarySubTextures.push(
      left,
      right,
      top,
      bottom,
      topLeft,
      topRight,
      bottomLeft,
      bottomRight
    );

    addSprite(container, topLeft, 0, 0);
    addSprite(container, top, bleed, 0);
    addSprite(container, topRight, bleed + frame.width, 0);

    addSprite(container, left, 0, bleed);
    addSprite(container, sourceTexture, bleed, bleed);
    addSprite(container, right, bleed + frame.width, bleed);

    addSprite(container, bottomLeft, 0, bleed + frame.height);
    addSprite(container, bottom, bleed, bleed + frame.height);
    addSprite(container, bottomRight, bleed + frame.width, bleed + frame.height);

    const rendered = renderToTexture(renderer, container, renderTexture);
    if (!rendered) throw new Error("Renderer failed to render Tile Flow bleed texture.");

    flowTexture = new PIXI.Texture(
      renderTexture.baseTexture,
      new PIXI.Rectangle(
        bleed,
        bleed,
        frame.width,
        frame.height
      )
    );

    return {
      texture: flowTexture,
      renderTexture,
      bleedPx: bleed
    };
  } catch (err) {
    try {
      flowTexture?.destroy?.(false);
    } catch {
      // ignore
    }

    try {
      renderTexture?.destroy?.(true);
    } catch {
      // ignore
    }

    if (!warnedBleedFailure) {
      warnedBleedFailure = true;
      console.warn("[FX Bus] Tile Flow: failed to create bleeded texture. Falling back to source texture.", err);
    }

    return null;
  } finally {
    destroyTemporarySubTextures(temporarySubTextures);

    try {
      container?.destroy?.({ children: true });
    } catch {
      try {
        container?.destroy?.();
      } catch {
        // ignore
      }
    }
  }
}

function destroyOwnedFlowTexture(state) {
  /**
   * Large comment:
   * Destroy only textures created by Tile Flow.
   *
   * Never destroy the original tile source texture, because that belongs to
   * Foundry's texture cache and may be shared by other tiles.
   */
  if (!state) return;

  try {
    state.flowTexture?.destroy?.(false);
  } catch {
    // ignore
  }

  try {
    state.bleedRenderTexture?.destroy?.(true);
  } catch {
    // ignore
  }

  state.flowTexture = null;
  state.bleedRenderTexture = null;
  state.bleedPx = 0;
}

function createOverlayTextureBundle(sourceTexture) {
  const bleeded = createBleededFlowTexture(sourceTexture);

  if (!bleeded?.texture) {
    return {
      texture: sourceTexture,
      flowTexture: null,
      bleedRenderTexture: null,
      bleedPx: 0,
      usedBleedTexture: false
    };
  }

  return {
    texture: bleeded.texture,
    flowTexture: bleeded.texture,
    bleedRenderTexture: bleeded.renderTexture,
    bleedPx: bleeded.bleedPx,
    usedBleedTexture: true
  };
}

function createOverlayObjects(tileId, sourceTexture, documentState) {
  /**
   * Large comment:
   * Create the passive context-following overlay.
   */
  const textureBundle = createOverlayTextureBundle(sourceTexture);

  const container = new PIXI.Container();
  const sprite = new PIXI.TilingSprite(
    textureBundle.texture,
    documentState.width,
    documentState.height
  );
  const mask = new PIXI.Graphics();

  container.name = `fxbus-tileFlow-overlay-${tileId}`;
  sprite.name = `fxbus-tileFlow-sprite-${tileId}`;
  mask.name = `fxbus-tileFlow-mask-${tileId}`;

  configurePassiveDisplayObject(container);
  configurePassiveDisplayObject(sprite);
  configurePassiveDisplayObject(mask);

  container.roundPixels = false;
  sprite.roundPixels = false;
  mask.roundPixels = false;

  sprite.x = -documentState.width / 2;
  sprite.y = -documentState.height / 2;
  sprite.width = documentState.width;
  sprite.height = documentState.height;

  drawMask(mask, documentState.width, documentState.height);

  sprite.mask = mask;

  container.addChild(sprite);
  container.addChild(mask);

  return {
    container,
    sprite,
    mask,
    texture: textureBundle.texture,
    flowTexture: textureBundle.flowTexture,
    bleedRenderTexture: textureBundle.bleedRenderTexture,
    bleedPx: textureBundle.bleedPx,
    usedBleedTexture: textureBundle.usedBleedTexture
  };
}

function refreshOverlayTextureForSource(state, sourceTexture) {
  /**
   * Large comment:
   * Recreate the overlay texture if the Foundry tile's source texture changes.
   */
  if (!state || state.sourceTexture === sourceTexture) return;

  destroyOwnedFlowTexture(state);

  const textureBundle = createOverlayTextureBundle(sourceTexture);

  state.sourceTexture = sourceTexture;
  state.texture = textureBundle.texture;
  state.flowTexture = textureBundle.flowTexture;
  state.bleedRenderTexture = textureBundle.bleedRenderTexture;
  state.bleedPx = textureBundle.bleedPx;
  state.usedBleedTexture = textureBundle.usedBleedTexture;

  if (state.sprite) {
    state.sprite.texture = textureBundle.texture;
  }
}

function applyOverlayRenderOrder(state) {
  /**
   * Large comment:
   * Keep the Flow overlay in the same render ordering context as its source
   * tile without overwriting or flattening the tile layer's existing z-order.
   */
  const object = state?.object;
  const container = state?.container;
  const parent = object?.parent;

  if (!object || !container) return;

  const objectZ = Number(object.zIndex);

  if (Number.isFinite(objectZ)) {
    container.zIndex = parent?.sortableChildren
      ? objectZ + Z_ORDER_EPSILON
      : objectZ;
  }

  for (const field of ["sort", "sortLayer", "elevation"]) {
    if (object[field] !== undefined) {
      try {
        container[field] = object[field];
      } catch {
        // ignore
      }
    }
  }

  if (parent) {
    try {
      parent.sortDirty = true;
    } catch {
      // ignore
    }
  }
}

function insertOverlayBesideTileObject(state) {
  /**
   * Large comment:
   * Insert the overlay into the tile render object's actual parent.
   */
  const object = state.object;
  const container = state.container;
  const parent = object?.parent;

  if (!object || !container || !parent?.addChild) return false;

  applyOverlayRenderOrder(state);

  if (container.parent !== parent) {
    try {
      container.parent?.removeChild?.(container);
    } catch {
      // ignore
    }

    try {
      parent.addChild(container);
    } catch (err) {
      console.warn("[FX Bus] Tile Flow: failed to insert overlay beside tile.", {
        tileId: state.tileId,
        err
      });
      return false;
    }
  }

  applyOverlayRenderOrder(state);

  if (!parent.sortableChildren) {
    try {
      const objectIndex = parent.getChildIndex?.(object);
      const overlayIndex = parent.getChildIndex?.(container);

      if (
        Number.isFinite(objectIndex) &&
        Number.isFinite(overlayIndex) &&
        overlayIndex !== objectIndex + 1
      ) {
        parent.setChildIndex?.(
          container,
          Math.min(objectIndex + 1, parent.children.length - 1)
        );
      }
    } catch {
      // ignore
    }
  }

  return true;
}

function applyTileScaleToSprite(state) {
  /**
   * Large comment:
   * Apply the correct tileScale for the current tile document size and source
   * texture size.
   */
  const scale = getTileTextureScale(
    state.documentState,
    state.sourceTexture,
    state.repeatScale
  );

  state.effectiveTileScaleX = scale.x;
  state.effectiveTileScaleY = scale.y;
  state.baseTileScaleX = scale.baseX;
  state.baseTileScaleY = scale.baseY;
  state.textureWidth = scale.textureWidth;
  state.textureHeight = scale.textureHeight;

  state.sprite.tileScale.set(scale.x, scale.y);
}

function syncOverlayToTile(state) {
  /**
   * Large comment:
   * Sync the passive overlay to the current tile render context.
   */
  const tile = getTileById(state.tileId);
  const object = getTileRenderObject(tile);
  const sourceTexture = getTextureFromObject(object);
  const documentState = snapshotTileDocumentState(tile);

  if (!tile || !object || !sourceTexture || !documentState) return false;

  if (state.object !== object || object.destroyed) {
    restoreOriginalTileObject(state);
    state.tile = tile;
    state.object = object;
  }

  refreshOverlayTextureForSource(state, sourceTexture);

  const shapeChanged = !sameDocumentShape(state.documentState, documentState);
  state.documentState = documentState;

  applyTileScaleToSprite(state);

  if (!insertOverlayBesideTileObject(state)) return false;

  syncOverlayTransformToTileObject(state, object);
  applyExternalVisualTransform(state);

  if (shapeChanged) {
    setSpriteTilePosition(state);
  }

  const originalAlpha = getOriginalTileObjectAlpha(state, object);

  state.container.visible = object.visible !== false;
  state.container.renderable = object.renderable !== false;
  state.container.alpha = clamp(originalAlpha * state.overlayAlpha, 0, 1);

  hideOriginalTileObject(state, object);

  if (object.blendMode !== undefined && state.useTileBlendMode) {
    state.container.blendMode = object.blendMode;
    state.sprite.blendMode = object.blendMode;
  } else {
    state.container.blendMode = state.blendMode;
    state.sprite.blendMode = state.blendMode;
  }

  if (typeof object.tint === "number") {
    try {
      state.sprite.tint = object.tint;
    } catch {
      // ignore
    }
  }

  return true;
}

function destroyOverlay(state) {
  if (!state) return;

  restoreOriginalTileObject(state);

  try {
    if (state.container?.parent) {
      state.container.parent.removeChild(state.container);
    }
  } catch {
    // ignore
  }

  try {
    state.container?.destroy?.({ children: true });
  } catch {
    try {
      state.container?.destroy?.();
    } catch {
      // ignore
    }
  }

  destroyOwnedFlowTexture(state);

  state.container = null;
  state.sprite = null;
  state.mask = null;
  state.texture = null;
  state.sourceTexture = null;
}

function phaseFromId(id) {
  let hash = 0;

  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash % 10000) / 10000;
}

function wrapPhaseAxisPx(value, periodPx) {
  /**
   * Large comment:
   * Keep accumulated displayed-pixel phase bounded without changing the visible
   * texture phase.
   *
   * The wrap span must be a whole-number multiple of the displayed repeat
   * period. Wrapping at an arbitrary fixed distance can visibly snap because it
   * changes the sampled texture phase.
   *
   * Use floor(threshold / period) + 1 so the wrap span is always greater than
   * the configured threshold, while still being phase-equivalent.
   */
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  const period = Math.abs(Number(periodPx));
  if (!Number.isFinite(period) || period <= MIN_SCALE) return n;

  const multiple = Math.max(
    1,
    Math.floor(PHASE_WRAP_THRESHOLD_PX / period) + 1
  );

  const wrapSpan = period * multiple;

  if (Math.abs(n) < wrapSpan) return n;

  const wrapped = n % wrapSpan;

  return wrapped < 0 ? wrapped + wrapSpan : wrapped;
}

function wrapStatePhasePx(state) {
  /**
   * Large comment:
   * Keep accumulated displayed-pixel phase bounded without changing the visible
   * texture phase.
   *
   * The displayed repeat period is:
   *   source texture size * effective tile scale
   *
   * Wrapping by a whole-number multiple of that period preserves the exact
   * sampled texture phase. Wrapping by an arbitrary pixel value does not.
   */
  if (!state) return;

  const periodX = Math.max(
    MIN_SCALE,
    Number(state.textureWidth ?? 1) * Number(state.effectiveTileScaleX ?? 1)
  );

  const periodY = Math.max(
    MIN_SCALE,
    Number(state.textureHeight ?? 1) * Number(state.effectiveTileScaleY ?? 1)
  );

  state.tilePositionX = wrapPhaseAxisPx(state.tilePositionX, periodX);
  state.tilePositionY = wrapPhaseAxisPx(state.tilePositionY, periodY);
}

function setSpriteTilePosition(state) {
  /**
   * Large comment:
   * Apply accumulated displayed-pixel offsets to PIXI's texture-space
   * tilePosition.
   *
   * TilingSprite.tilePosition is not in document/display pixels. It is affected
   * by tileScale. Dividing by the effective tileScale keeps motion visually
   * consistent when a tile is displayed larger than its source texture.
   *
   * Do not round the texture-space position. Rounding creates sub-frame jumps
   * which are most visible at texture repetition boundaries at certain canvas
   * zoom levels.
   *
   * Phase wrapping must preserve the visible texture phase. Therefore the
   * accumulated displayed-pixel phase is only wrapped by whole displayed texture
   * repeat periods, never by an arbitrary fixed distance.
   */
  if (!state?.sprite) return;

  const scaleX = Math.max(MIN_SCALE, Number(state.effectiveTileScaleX ?? 1));
  const scaleY = Math.max(MIN_SCALE, Number(state.effectiveTileScaleY ?? 1));

  wrapStatePhasePx(state);

  state.sprite.roundPixels = false;

  state.sprite.tilePosition.set(
    state.tilePositionX / scaleX,
    state.tilePositionY / scaleY
  );
}

function applyInitialPhase(state) {
  /**
   * Large comment:
   * Apply a deterministic starting tilePosition offset so multiple selected
   * tiles do not visibly loop in perfect lockstep unless requested.
   */
  if (!state?.randomPhase || !state?.sprite) return;

  const p = phaseFromId(state.tileId);
  const angleRad = degToRad(state.angleDeg);
  const phaseDistance = p * Math.max(
    state.documentState.width,
    state.documentState.height
  );

  state.tilePositionX += Math.cos(angleRad) * phaseDistance;
  state.tilePositionY += Math.sin(angleRad) * phaseDistance;

  setSpriteTilePosition(state);
}

function curve01(mode, p) {
  /**
   * Large comment:
   * Return a shaping value in [0, 1] for acceleration behaviour.
   */
  const t = clamp(Number(p), 0, 1);

  if (mode === ACCEL_LINEAR) return t;
  if (mode === ACCEL_SINE) return Math.sin(t * Math.PI * 0.5);
  if (mode === ACCEL_EASE_IN) return t * t;
  if (mode === ACCEL_EASE_OUT) return 1 - ((1 - t) * (1 - t));

  if (mode === ACCEL_EASE_IN_OUT) {
    return t < 0.5
      ? 2 * t * t
      : 1 - (Math.pow(-2 * t + 2, 2) / 2);
  }

  return 0;
}

function computeSpeedPxPerSec(state) {
  /**
   * Large comment:
   * Compute the current speed.
   */
  if (state.accelerationMode === ACCEL_NONE) {
    return state.startSpeedPxPerSec;
  }

  const accelerationDurationSec = state.accelerationDurationMs / 1000;

  if (
    !Number.isFinite(accelerationDurationSec) ||
    accelerationDurationSec <= 0 ||
    state.accelerationPxPerSec2 === 0
  ) {
    return state.startSpeedPxPerSec;
  }

  const elapsedSec = state.elapsedMs / 1000;
  const accelerationElapsedSec = Math.min(elapsedSec, accelerationDurationSec);
  const p = clamp(accelerationElapsedSec / accelerationDurationSec, 0, 1);

  if (state.accelerationMode === ACCEL_LINEAR) {
    return state.startSpeedPxPerSec +
      (state.accelerationPxPerSec2 * accelerationElapsedSec);
  }

  return state.startSpeedPxPerSec +
    (state.accelerationPxPerSec2 * accelerationDurationSec * curve01(state.accelerationMode, p));
}

function velocityVector(state) {
  const angleRad = degToRad(state.angleDeg);
  const speed = computeSpeedPxPerSec(state);

  return {
    x: Math.cos(angleRad) * speed,
    y: Math.sin(angleRad) * speed,
    speed
  };
}

function normaliseTickerDeltaMs(deltaMS) {
  /**
   * Large comment:
   * Be tolerant of ticker utility behaviour.
   */
  const n = Number(deltaMS);

  if (!Number.isFinite(n) || n <= 0) return 16.6667;
  if (n > 250) return 250;

  return n;
}

function updateRunningState(runtime, tileId, state, deltaMS) {
  if (state.status !== STATUS_RUNNING) return;

  if (!syncOverlayToTile(state)) {
    destroyOverlay(state);
    getTileMap(runtime).delete(tileId);
    return;
  }

  const dtMs = normaliseTickerDeltaMs(deltaMS);
  const dtSec = dtMs / 1000;

  state.elapsedMs += dtMs;

  const velocity = velocityVector(state);

  state.tilePositionX += velocity.x * dtSec;
  state.tilePositionY += velocity.y * dtSec;
  state.currentSpeedPxPerSec = velocity.speed;

  setSpriteTilePosition(state);

  if (state.durationMs > 0 && state.elapsedMs >= state.durationMs) {
    completeState(runtime, tileId, state);

    if (state.completionMode === MODE_RESET) {
      getTileMap(runtime).delete(tileId);
    }
  }
}

function completeState(runtime, tileId, state) {
  /**
   * Large comment:
   * Complete a running Tile Flow state when its total duration expires.
   *
   * Reset destroys the overlay. Retain stops motion but leaves the passive
   * overlay visible at the current tilePosition.
   */
  if (state.completionMode === MODE_RETAIN) {
    state.status = STATUS_HELD;
    return;
  }

  resetState(runtime, tileId, state);
}

function resetState(_runtime, _tileId, state) {
  /**
   * Large comment:
   * Hard reset a Tile Flow state.
   *
   * This destroys only the passive overlay, mask, and FX-owned temporary texture.
   * It does not mutate the TileDocument or alter the Foundry-managed tile mesh.
   */
  if (!state) return;

  state.tilePositionX = 0;
  state.tilePositionY = 0;

  destroyOverlay(state);
}

function ensureTileTicker(runtime) {
  const map = getTileMap(runtime);

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => {
    for (const [tileId, state] of Array.from(map.entries())) {
      if (state.status === STATUS_HELD) {
        if (!syncOverlayToTile(state)) {
          resetState(runtime, tileId, state);
          map.delete(tileId);
        }

        setSpriteTilePosition(state);
        continue;
      }

      updateRunningState(runtime, tileId, state, deltaMS);
    }

    if (map.size === 0) {
      cleanupTicker(runtime, EFFECT_NAME);
    }
  });
}

function updateExistingState(runtime, tileId, state, params) {
  /**
   * Large comment:
   * Restart or update an existing Tile Flow state.
   *
   * Retained tilePosition offsets are preserved, but kept phase-safe wrapped.
   * This means a retained flow can resume from its current visual phase without
   * unbounded numeric growth or visible snap.
   */
  state.angleDeg = params.angleDeg;
  state.startSpeedPxPerSec = params.startSpeedPxPerSec;
  state.accelerationMode = params.accelerationMode;
  state.accelerationPxPerSec2 = params.accelerationPxPerSec2;
  state.accelerationDurationMs = params.accelerationDurationMs;
  state.durationMs = params.durationMs;
  state.completionMode = params.completionMode;
  state.randomPhase = params.randomPhase;
  state.overlayAlpha = params.overlayAlpha;
  state.repeatScale = params.repeatScale;
  state.blendMode = params.blendMode;
  state.useTileBlendMode = params.blendMode === normaliseBlendMode("NORMAL");
  state.elapsedMs = 0;
  state.currentSpeedPxPerSec = params.startSpeedPxPerSec;
  state.status = STATUS_RUNNING;

  wrapStatePhasePx(state);

  if (!syncOverlayToTile(state)) {
    resetState(runtime, tileId, state);
    getTileMap(runtime).delete(tileId);
    return;
  }

  setSpriteTilePosition(state);
}

function startOrUpdate(runtime, payload) {
  const map = getTileMap(runtime);
  const tileIds = normaliseTileIds(payload);
  const params = buildParams(payload);

  for (const tileId of tileIds) {
    const existing = map.get(tileId);

    if (existing) {
      updateExistingState(runtime, tileId, existing, params);
      continue;
    }

    const tile = getTileById(tileId);
    const object = getTileRenderObject(tile);
    const sourceTexture = getTextureFromObject(object);
    const documentState = snapshotTileDocumentState(tile);

    if (!tile || !object || !sourceTexture || !documentState) {
      console.warn("[FX Bus] Tile Flow: cannot start.", {
        tileId,
        hasTile: Boolean(tile),
        hasObject: Boolean(object),
        hasTexture: Boolean(sourceTexture),
        hasDocumentState: Boolean(documentState)
      });
      continue;
    }

    const overlay = createOverlayObjects(tileId, sourceTexture, documentState);

    const state = {
      tileId,
      tile,
      object,
      sourceTexture,
      texture: overlay.texture,

      flowTexture: overlay.flowTexture,
      bleedRenderTexture: overlay.bleedRenderTexture,
      bleedPx: overlay.bleedPx,
      usedBleedTexture: overlay.usedBleedTexture,

      documentState,

      container: overlay.container,
      sprite: overlay.sprite,
      mask: overlay.mask,

      tilePositionX: 0,
      tilePositionY: 0,

      effectiveTileScaleX: 1,
      effectiveTileScaleY: 1,
      baseTileScaleX: 1,
      baseTileScaleY: 1,
      textureWidth: 1,
      textureHeight: 1,

      angleDeg: params.angleDeg,
      startSpeedPxPerSec: params.startSpeedPxPerSec,
      accelerationMode: params.accelerationMode,
      accelerationPxPerSec2: params.accelerationPxPerSec2,
      accelerationDurationMs: params.accelerationDurationMs,
      currentSpeedPxPerSec: params.startSpeedPxPerSec,

      durationMs: params.durationMs,
      elapsedMs: 0,
      completionMode: params.completionMode,
      randomPhase: params.randomPhase,

      overlayAlpha: params.overlayAlpha,
      repeatScale: params.repeatScale,
      blendMode: params.blendMode,
      useTileBlendMode: params.blendMode === normaliseBlendMode("NORMAL"),

      originalObjectAlpha: 1,
      originalObjectAlphaCaptured: false,

      externalVisualTransform: null,

      status: STATUS_RUNNING
    };

    if (!syncOverlayToTile(state)) {
      destroyOverlay(state);
      continue;
    }

    applyInitialPhase(state);

    map.set(tileId, state);
  }

  ensureTileTicker(runtime);
}

function stop(runtime, payload) {
  const map = getTileMap(runtime);
  const tileIds = normaliseTileIds(payload);
  const forceReset = payload?.forceReset === true || payload?.reset === true;
  const mode = forceReset
    ? MODE_RESET
    : normaliseMode(payload?.stopMode ?? payload?.mode, MODE_RESET);

  const idsToStop = tileIds.length > 0
    ? tileIds
    : Array.from(map.keys());

  for (const tileId of idsToStop) {
    const state = map.get(tileId);
    if (!state) continue;

    if (mode === MODE_RETAIN) {
      wrapStatePhasePx(state);
      state.status = STATUS_HELD;
      setSpriteTilePosition(state);
      continue;
    }

    resetState(runtime, tileId, state);
    map.delete(tileId);
  }

  if (map.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

export function registerTileFlowFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTileFlowFx: invalid runtime.");
  }

  if (!runtime.tileFx) runtime.tileFx = new Map();

  runtime.handlers.set(ACTION_START, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startOrUpdate(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stop(runtime, payload));
}

export function getTileFlowState(runtime, tileId) {
  /**
   * Large comment:
   * Return the active or retained Tile Flow state for a tile.
   *
   * This is intentionally read-only for other effects.
   */
  const id = String(tileId ?? "").trim();
  if (!id) return null;

  return runtime?.tileFx?.get?.(EFFECT_NAME)?.get?.(id) ?? null;
}

export function getTileFlowVisualObject(runtime, tileId) {
  /**
   * Large comment:
   * Return the currently visible Tile Flow display object for composition.
   *
   * The overlay implementation keeps the original Foundry tile mesh untouched.
   * Composition effects should target the overlay while Tile Flow is active.
   */
  const state = getTileFlowState(runtime, tileId);

  if (!state?.container || state.container.destroyed) return null;

  return state.container;
}

export function setTileFlowVisualTransformOverride(runtime, tileId, transform) {
  /**
   * Large comment:
   * Store a composed visual transform for Tile Flow's overlay container.
   *
   * This exists for effects that need to transform the visible representation of
   * a tile while Tile Flow owns that representation. Tile Rotation uses this so
   * anchor rotation remains stable even if Tile Flow's ticker runs after Tile
   * Rotation's ticker on a given frame.
   */
  const state = getTileFlowState(runtime, tileId);

  if (!state?.container || state.container.destroyed) return false;

  const normalised = normaliseExternalVisualTransform(transform);
  if (!normalised) return false;

  state.externalVisualTransform = normalised;
  applyExternalVisualTransform(state);

  return true;
}

export function clearTileFlowVisualTransformOverride(runtime, tileId) {
  /**
   * Large comment:
   * Remove a previously stored composed transform from Tile Flow's overlay.
   *
   * The next Tile Flow sync returns the overlay to the underlying tile render
   * object's transform. This is used when Tile Rotation stops with restoration
   * enabled or when Rotation no longer targets the Tile Flow overlay.
   */
  const state = getTileFlowState(runtime, tileId);

  if (!state) return false;

  state.externalVisualTransform = null;

  return true;
}

export function hasTileFlowVisual(runtime, tileId) {
  /**
   * Large comment:
   * Return whether Tile Flow currently has a visible overlay for a tile.
   *
   * This includes both running and retained flow states.
   */
  return Boolean(getTileFlowVisualObject(runtime, tileId));
}