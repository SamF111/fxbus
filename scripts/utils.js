// D:\FoundryVTT\Data\modules\fxbus\scripts\utils.js

/**
 * FX Bus (Foundry VTT v12+)
 * Shared utility functions.
 *
 * Scope:
 * - Math helpers.
 * - Snapshot and restore of render transforms.
 * - Token mesh resolution.
 * - Stage snapshotting.
 *
 * Constraints:
 * - Visual-only.
 * - Exact restoration required where used.
 */

/* ----------------------------- Math utilities ----------------------------- */

/**
 * Clamp a value to [min, max].
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Degrees to radians.
 *
 * @param {number} deg
 * @returns {number}
 */
export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Linear interpolation.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Quadratic ease-out.
 *
 * @param {number} t
 * @returns {number}
 */
export function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/* --------------------------- Token render access -------------------------- */

/**
 * Resolve the render object for a token.
 * Prefer mesh; fall back to display object.
 *
 * @param {Token} token
 * @returns {PIXI.DisplayObject|null}
 */
export function getTokenRenderObject(token) {
  if (!token) return null;
  if (token.mesh) return token.mesh;
  if (token.object) return token.object;
  return null;
}

/* -------------------------- Snapshot and restore -------------------------- */

/**
 * Capture the base render transform for a token.
 *
 * @param {Token} token
 * @returns {{x:number,y:number,rotation:number,scaleX:number,scaleY:number}|null}
 */
export function snapshotTokenTransform(token) {
  const obj = getTokenRenderObject(token);
  if (!obj) return null;

  return {
    x: obj.x,
    y: obj.y,
    rotation: obj.rotation,
    scaleX: obj.scale.x,
    scaleY: obj.scale.y
  };
}

/**
 * Restore a previously captured transform exactly.
 *
 * @param {Token} token
 * @param {{x:number,y:number,rotation:number,scaleX:number,scaleY:number}|null} snapshot
 */
export function restoreTokenTransform(token, snapshot) {
  if (!snapshot) return;

  const obj = getTokenRenderObject(token);
  if (!obj) return;

  obj.x = snapshot.x;
  obj.y = snapshot.y;
  obj.rotation = snapshot.rotation;
  obj.scale.set(snapshot.scaleX, snapshot.scaleY);
}

/* --------------------------- Stage snapshotting --------------------------- */

/**
 * Snapshot the canvas stage position.
 *
 * @returns {{x:number,y:number}|null}
 */
export function snapshotStage() {
  const stage = canvas?.app?.stage;
  if (!stage) return null;

  return {
    x: stage.x,
    y: stage.y
  };
}

/**
 * Restore the canvas stage position.
 *
 * @param {{x:number,y:number}|null} snapshot
 */
export function restoreStage(snapshot) {
  if (!snapshot) return;

  const stage = canvas?.app?.stage;
  if (!stage) return;

  stage.x = snapshot.x;
  stage.y = snapshot.y;
}
