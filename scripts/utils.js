/**
 * FX Bus (Foundry VTT v12+)
 * Shared utility functions.
 *
 * Scope:
 * - Math helpers.
 * - Snapshot and restore of render transforms.
 * - Token mesh resolution.
 *
 * Constraints:
 * - Visual-only.
 * - Exact restoration required.
 */

/* ----------------------------- Math utilities ----------------------------- */

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/* --------------------------- Token render access --------------------------- */

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

/* -------------------------- Snapshot and restore --------------------------- */

/**
 * Capture the base render transform for a token.
 *
 * @param {Token} token
 * @returns {object|null}
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
 * @param {object} snapshot
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

/* --------------------------- Stage snapshotting ---------------------------- */

/**
 * Snapshot the canvas stage position.
 *
 * @returns {{x:number,y:number}}
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
 * @param {{x:number,y:number}} snapshot
 */
export function restoreStage(snapshot) {
  if (!snapshot) return;

  const stage = canvas?.app?.stage;
  if (!stage) return;

  stage.x = snapshot.x;
  stage.y = snapshot.y;
}
