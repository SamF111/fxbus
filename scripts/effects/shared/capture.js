// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\shared\capture.js

/**
 * FX Bus - Shared Capture Utilities
 *
 * Correct model (matches working screenSmearFx):
 * - Capture canvas.stage AS-SEEN (camera transform included).
 * - If you need a screen-locked overlay while staying in the same pipeline, keep the overlay
 *   as a child of canvas.stage and apply inverse(canvas.stage.worldTransform) to it each tick.
 *
 * Do NOT "neutralise" camera by zeroing position/scale/pivot for capture.
 * That captures world-origin space and produces the classic top-left mini-copy symptom.
 *
 * Safety:
 * - Never removeFromParent/destroy in capture helpers.
 * - When hiding objects, only toggle flags (renderable/visible) and always restore in finally.
 * - Guard lockContainerToScreenSpace against detached containers (parent null), which otherwise
 *   can trigger PIXI updateTransform(parent=null) crashes.
 */

function safeUpdateWorldTransform(obj) {
  try {
    obj?.updateTransform?.();
  } catch {
    // ignore
  }
}

function snapshotFlags(obj) {
  return {
    obj,
    visible: obj?.visible,
    renderable: obj?.renderable,
    alpha: obj?.alpha
  };
}

function applyHidden(obj) {
  if (!obj) return;
  // Prefer renderable to avoid side effects; also set visible false for belt-and-braces.
  if ("renderable" in obj) obj.renderable = false;
  if ("visible" in obj) obj.visible = false;
}

function restoreFlags(snap) {
  const obj = snap?.obj;
  if (!obj) return;

  if ("renderable" in obj && typeof snap.renderable !== "undefined") obj.renderable = snap.renderable;
  if ("visible" in obj && typeof snap.visible !== "undefined") obj.visible = snap.visible;
  if ("alpha" in obj && typeof snap.alpha !== "undefined") obj.alpha = snap.alpha;
}

/**
 * Render a stage into a RenderTexture exactly as the user sees it.
 * Optionally hides specific display objects during the capture (feedback prevention).
 *
 * @param {PIXI.Renderer} renderer
 * @param {PIXI.Container} stage        Typically canvas.stage
 * @param {PIXI.RenderTexture} rt
 * @param {object} [opts]
 * @param {boolean} [opts.clear=true]
 * @param {Array<PIXI.DisplayObject>} [opts.hide=[]]  Objects to hide during capture
 */
export function renderStageAsSeen(renderer, stage, rt, opts = {}) {
  if (!renderer || !stage || !rt) return;

  const clear = opts?.clear !== false;
  const hide = Array.isArray(opts?.hide) ? opts.hide.filter(Boolean) : [];

  const snaps = hide.map(snapshotFlags);

  try {
    // Keep transforms current before render (and before any inverse-lock usage elsewhere).
    safeUpdateWorldTransform(stage);

    for (const s of snaps) applyHidden(s.obj);

    renderer.render(stage, { renderTexture: rt, clear });
  } finally {
    for (let i = snaps.length - 1; i >= 0; i--) {
      try {
        restoreFlags(snaps[i]);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Lock a container to screen space while it remains a child of the camera-transformed stage.
 * This cancels the parent camera transform for that container only.
 *
 * @param {typeof PIXI} PIXI
 * @param {PIXI.Container} stage        Typically canvas.stage
 * @param {PIXI.Container} container    Overlay container that is a child of stage
 */
export function lockContainerToScreenSpace(PIXI, stage, container) {
  if (!PIXI || !stage || !container) return;

  // Critical guard: detached containers can crash PIXI internals during transform updates.
  if (!container.parent) return;

  const wt = stage.worldTransform;
  if (!wt) return;

  // Ensure stage transforms are current before reading worldTransform.
  safeUpdateWorldTransform(stage);

  const inv = new PIXI.Matrix();
  inv.copyFrom(wt);
  inv.invert();

  container.transform.setFromMatrix(inv);
}
