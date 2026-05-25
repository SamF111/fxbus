// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenRecoilFx.js

/**
 * FX Bus - Token Recoil FX (Foundry VTT v13+)
 *
 * Purpose:
 * - Apply a short client-side visual displacement to tokens.
 * - Support radial-out, radial-in, and fixed-direction recoil.
 * - Allow macro/module integration through a stable socket payload.
 *
 * Compatibility goals:
 * - Drag-safe: never touch token.x/y or the Token container position.
 * - Z Scatter-safe: do not reparent token.mesh/icon, and do not animate position.
 *
 * Implementation:
 * - Animate ONLY:
 *   - target.pivot -> visual recoil offset without touching position.
 *   - target.rotation -> optional small impact roll.
 * - Snapshot + restore:
 *   - pivot, rotation, scale
 *   - visible/renderable/alpha
 *
 * Actions:
 * - fx.tokenRecoil.burst
 * - fx.tokenRecoil.stop
 *
 * Payload:
 * {
 *   action: "fx.tokenRecoil.burst",
 *   origin: { x: 2400, y: 1800 },
 *   tokenIds: ["abc", "def"],          // optional
 *   excludeTokenIds: ["source"],       // optional
 *   affect: "tokensInRadius",         // tokensInRadius | listedOnly | selectedOnly | selectedInRadius
 *   mode: "radialOut",                // radialOut | radialIn | directional
 *   radiusPx: 500,
 *   distancePx: 40,
 *   durationMs: 450,
 *   falloff: "linear",                // linear | smooth | none
 *   angleDeg: 0,                      // directional mode only
 *   maxDelayMs: 0,
 *   rotationDeg: 0,
 *   includeHidden: false
 * }
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";

const EFFECT_NAME = "tokenRecoil";

const ACTION_BURST = "fx.tokenRecoil.burst";
const ACTION_STOP = "fx.tokenRecoil.stop";

/**
 * Register handlers for token recoil effect.
 *
 * @param {object} runtime
 */
export function registerTokenRecoilFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] tokenRecoilFx: invalid runtime.");

  runtime.handlers.set(ACTION_BURST, (msg) => onBurst(runtime, msg));
  runtime.handlers.set(ACTION_STOP, (msg) => onStop(runtime, msg));
}

/**
 * Retrieve the per-effect state map for this runtime.
 *
 * @param {object} runtime
 * @returns {Map<string, object>}
 */
function getEffectMap(runtime) {
  if (!runtime.tokenFx.has(EFFECT_NAME)) runtime.tokenFx.set(EFFECT_NAME, new Map());
  return runtime.tokenFx.get(EFFECT_NAME);
}

/**
 * Resolve the render object to animate.
 * Do not reparent it.
 *
 * Mirrors tokenOscillationFx.js behaviour so recoil stays drag-safe and Z Scatter-safe.
 *
 * @param {Token} token
 * @returns {PIXI.DisplayObject|null}
 */
function getTokenRecoilTarget(token) {
  return token?.mesh ?? token?.icon ?? null;
}

/**
 * Snapshot baseline transform + render-state for the target.
 *
 * @param {PIXI.DisplayObject} target
 * @returns {object|null}
 */
function snapshotBase(target) {
  if (!target) return null;

  const pivotX = Number.isFinite(target.pivot?.x) ? target.pivot.x : 0;
  const pivotY = Number.isFinite(target.pivot?.y) ? target.pivot.y : 0;

  const rotation = Number.isFinite(target.rotation) ? target.rotation : 0;

  const scaleX = Number.isFinite(target.scale?.x) ? target.scale.x : 1;
  const scaleY = Number.isFinite(target.scale?.y) ? target.scale.y : 1;

  const visible = typeof target.visible === "boolean" ? target.visible : true;
  const renderable = typeof target.renderable === "boolean" ? target.renderable : true;
  const alpha = Number.isFinite(target.alpha) ? target.alpha : 1;

  return {
    pivotX,
    pivotY,
    rotation,
    scaleX,
    scaleY,
    visible,
    renderable,
    alpha
  };
}

/**
 * Restore baseline.
 *
 * @param {PIXI.DisplayObject} target
 * @param {object} base
 */
function restoreBase(target, base) {
  if (!target || !base) return;

  if (target.pivot?.set) target.pivot.set(base.pivotX, base.pivotY);
  else {
    target.pivot.x = base.pivotX;
    target.pivot.y = base.pivotY;
  }

  target.rotation = base.rotation;

  if (target.scale?.set) target.scale.set(base.scaleX, base.scaleY);
  else {
    target.scale.x = base.scaleX;
    target.scale.y = base.scaleY;
  }

  target.visible = base.visible;
  target.renderable = base.renderable;
  target.alpha = base.alpha;
}

/**
 * Defensive tokenId normalisation.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
function asTokenIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.length > 0);
}

/**
 * Build a tokenId exclusion set from payload.
 *
 * @param {object} msg
 * @returns {Set<string>}
 */
function getExcludedTokenIds(msg) {
  return new Set(asTokenIds(msg?.excludeTokenIds));
}

/**
 * Parse finite numeric value.
 *
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse origin from incoming payload.
 *
 * @param {object} msg
 * @returns {{x:number,y:number}|null}
 */
function parseOrigin(msg) {
  const x = numberOr(msg?.origin?.x, NaN);
  const y = numberOr(msg?.origin?.y, NaN);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

/**
 * Parse and clamp incoming parameters from the bus payload.
 *
 * @param {object} msg
 * @returns {object}
 */
function normaliseParams(msg) {
  const modeRaw = String(msg?.mode ?? "radialOut");
  const affectRaw = String(msg?.affect ?? "tokensInRadius");
  const falloffRaw = String(msg?.falloff ?? "linear");

  const mode = ["radialOut", "radialIn", "directional"].includes(modeRaw)
    ? modeRaw
    : "radialOut";

  const affect = ["tokensInRadius", "listedOnly", "selectedOnly", "selectedInRadius"].includes(affectRaw)
    ? affectRaw
    : "tokensInRadius";

  const falloff = ["linear", "smooth", "none"].includes(falloffRaw)
    ? falloffRaw
    : "linear";

  return {
    mode,
    affect,
    falloff,
    radiusPx: clamp(numberOr(msg?.radiusPx, 500), 1, 10000),
    distancePx: clamp(numberOr(msg?.distancePx, 40), 0, 300),
    durationMs: clamp(numberOr(msg?.durationMs, 450), 50, 10000),
    angleDeg: numberOr(msg?.angleDeg, 0),
    maxDelayMs: clamp(numberOr(msg?.maxDelayMs, 0), 0, 500),
    rotationRad: degToRad(clamp(numberOr(msg?.rotationDeg, 0), -45, 45)),
    includeHidden: msg?.includeHidden === true
  };
}

/**
 * Resolve token centre in canvas coordinates.
 *
 * @param {Token} token
 * @returns {{x:number,y:number}|null}
 */
function getTokenCentre(token) {
  if (!token) return null;

  if (Number.isFinite(token.center?.x) && Number.isFinite(token.center?.y)) {
    return {
      x: token.center.x,
      y: token.center.y
    };
  }

  const x = numberOr(token.document?.x ?? token.x, NaN);
  const y = numberOr(token.document?.y ?? token.y, NaN);
  const w = numberOr(token.w, 0);
  const h = numberOr(token.h, 0);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: x + (w / 2),
    y: y + (h / 2)
  };
}

/**
 * Distance between two canvas points.
 *
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {number}
 */
function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Test whether a token centre is within radius.
 *
 * @param {Token} token
 * @param {{x:number,y:number}} origin
 * @param {number} radiusPx
 * @returns {boolean}
 */
function tokenInRadius(token, origin, radiusPx) {
  const centre = getTokenCentre(token);
  if (!centre) return false;
  return distanceBetween(centre, origin) <= radiusPx;
}

/**
 * Filter hidden/excluded/unusable tokens.
 *
 * @param {Token[]} tokens
 * @param {boolean} includeHidden
 * @param {Set<string>} excludedTokenIds
 * @returns {Token[]}
 */
function filterUsableTokens(tokens, includeHidden, excludedTokenIds) {
  return tokens.filter((token) => {
    if (!token) return false;
    if (excludedTokenIds.has(token.id)) return false;
    if (!includeHidden && token.document?.hidden) return false;
    return Boolean(getTokenRecoilTarget(token));
  });
}

/**
 * Select affected tokens from payload mode.
 *
 * @param {object} msg
 * @param {{x:number,y:number}} origin
 * @param {object} params
 * @returns {Token[]}
 */
function selectAffectedTokens(msg, origin, params) {
  const excludedTokenIds = getExcludedTokenIds(msg);

  if (params.affect === "listedOnly") {
    const ids = new Set(asTokenIds(msg?.tokenIds));
    const listed = (canvas?.tokens?.placeables ?? []).filter((token) => ids.has(token.id));
    return filterUsableTokens(listed, params.includeHidden, excludedTokenIds);
  }

  if (params.affect === "selectedOnly") {
    return filterUsableTokens(canvas?.tokens?.controlled ?? [], params.includeHidden, excludedTokenIds);
  }

  if (params.affect === "selectedInRadius") {
    return filterUsableTokens(canvas?.tokens?.controlled ?? [], params.includeHidden, excludedTokenIds)
      .filter((token) => tokenInRadius(token, origin, params.radiusPx));
  }

  return filterUsableTokens(canvas?.tokens?.placeables ?? [], params.includeHidden, excludedTokenIds)
    .filter((token) => tokenInRadius(token, origin, params.radiusPx));
}

/**
 * Normalise vector.
 *
 * Returns null for zero-length radial vectors so source tokens at the exact
 * origin do not jump upwards from an arbitrary fallback direction.
 *
 * @param {number} dx
 * @param {number} dy
 * @returns {{x:number,y:number}|null}
 */
function normaliseVector(dx, dy) {
  const len = Math.hypot(dx, dy);

  if (!Number.isFinite(len) || len <= 0.0001) {
    return null;
  }

  return {
    x: dx / len,
    y: dy / len
  };
}

/**
 * Calculate falloff strength.
 *
 * @param {number} distance
 * @param {number} radiusPx
 * @param {string} falloff
 * @returns {number}
 */
function falloffStrength(distance, radiusPx, falloff) {
  if (falloff === "none") return 1;

  const t = clamp(1 - (distance / Math.max(radiusPx, 1)), 0, 1);

  if (falloff === "smooth") {
    return t * t * (3 - (2 * t));
  }

  return t;
}

/**
 * Compute the recoil vector and delay for a token.
 *
 * Important:
 * - Returned offset is content displacement in desired visual direction.
 * - The ticker applies this through pivot inversion.
 * - Radial modes skip exact-origin tokens instead of assigning an arbitrary direction.
 *
 * @param {Token} token
 * @param {{x:number,y:number}} origin
 * @param {object} params
 * @returns {{offsetX:number,offsetY:number,delayMs:number}|null}
 */
function computeRecoil(token, origin, params) {
  const centre = getTokenCentre(token);
  if (!centre) return null;

  const distance = distanceBetween(centre, origin);
  const strength = falloffStrength(distance, params.radiusPx, params.falloff);
  const effectiveDistance = params.distancePx * strength;

  if (effectiveDistance <= 0) return null;

  let dir;

  if (params.mode === "directional") {
    const a = degToRad(params.angleDeg);
    dir = {
      x: Math.cos(a),
      y: Math.sin(a)
    };
  } else {
    const radial = normaliseVector(centre.x - origin.x, centre.y - origin.y);
    if (!radial) return null;

    dir = params.mode === "radialIn"
      ? { x: -radial.x, y: -radial.y }
      : radial;
  }

  const delayMs = params.maxDelayMs > 0
    ? clamp(distance / Math.max(params.radiusPx, 1), 0, 1) * params.maxDelayMs
    : 0;

  return {
    offsetX: dir.x * effectiveDistance,
    offsetY: dir.y * effectiveDistance,
    delayMs
  };
}

/**
 * Cubic ease out.
 *
 * @param {number} t
 * @returns {number}
 */
function easeOutCubic(t) {
  const p = 1 - clamp(t, 0, 1);
  return 1 - (p * p * p);
}

/**
 * Cubic ease in-out.
 *
 * @param {number} t
 * @returns {number}
 */
function easeInOutCubic(t) {
  const x = clamp(t, 0, 1);

  if (x < 0.5) return 4 * x * x * x;

  const p = -2 * x + 2;
  return 1 - ((p * p * p) / 2);
}

/**
 * Recoil curve:
 * - Fast snap out.
 * - Short hold.
 * - Smooth return.
 *
 * @param {number} t
 * @returns {number}
 */
function recoilCurve(t) {
  const x = clamp(t, 0, 1);

  if (x < 0.28) return easeOutCubic(x / 0.28);
  if (x < 0.38) return 1;

  return 1 - easeInOutCubic((x - 0.38) / 0.62);
}

/**
 * Restore and delete one active recoil state.
 *
 * @param {object} runtime
 * @param {string} tokenId
 */
function stopOne(runtime, tokenId) {
  const fxMap = getEffectMap(runtime);
  const state = fxMap.get(tokenId);
  if (!state) return;

  const token = canvas?.tokens?.get(tokenId);
  const target = getTokenRecoilTarget(token);

  if (target) restoreBase(target, state.base);

  fxMap.delete(tokenId);

  if (fxMap.size === 0) cleanupTicker(runtime, EFFECT_NAME);
}

/**
 * Stop all active token recoil states.
 *
 * @param {object} runtime
 */
function stopAll(runtime) {
  const fxMap = getEffectMap(runtime);

  for (const state of fxMap.values()) {
    const token = canvas?.tokens?.get(state.tokenId);
    const target = getTokenRecoilTarget(token);

    if (target) restoreBase(target, state.base);
  }

  fxMap.clear();
  cleanupTicker(runtime, EFFECT_NAME);
}

function onBurst(runtime, msg) {
  const origin = parseOrigin(msg);
  if (!origin) {
    console.warn("[FX Bus] tokenRecoil ignored: invalid origin.", msg);
    return;
  }

  const params = normaliseParams(msg);
  const tokens = selectAffectedTokens(msg, origin, params);
  if (tokens.length === 0) return;

  const fxMap = getEffectMap(runtime);

  for (const token of tokens) {
    if (!token?.id) continue;

    // Replace per token: restore any existing recoil before taking a fresh baseline.
    if (fxMap.has(token.id)) stopOne(runtime, token.id);

    const target = getTokenRecoilTarget(token);
    if (!target) continue;

    const base = snapshotBase(target);
    if (!base) continue;

    const recoil = computeRecoil(token, origin, params);
    if (!recoil) continue;

    const rotationSign = recoil.offsetX < 0 ? -1 : 1;

    fxMap.set(token.id, {
      tokenId: token.id,
      base,
      offsetX: recoil.offsetX,
      offsetY: recoil.offsetY,
      delayMs: recoil.delayMs,
      durationMs: params.durationMs,
      rotationRad: params.rotationRad * rotationSign,
      tMs: 0
    });
  }

  if (fxMap.size > 0) ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onStop(runtime, msg) {
  const tokenIds = asTokenIds(msg?.tokenIds);

  if (tokenIds.length === 0) {
    stopAll(runtime);
    return;
  }

  for (const tokenId of tokenIds) stopOne(runtime, tokenId);
}

/**
 * Per-frame update.
 *
 * Enforced invariants while active:
 * - target.visible/renderable/alpha pinned to baseline.
 * - position untouched.
 * - visual displacement applied via pivot.
 * - optional roll applied via rotation.
 *
 * @param {object} runtime
 * @param {number} deltaMS
 */
function tick(runtime, deltaMS) {
  const fxMap = getEffectMap(runtime);

  if (fxMap.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  const dt = Math.max(0, deltaMS);

  for (const state of Array.from(fxMap.values())) {
    const token = canvas?.tokens?.get(state.tokenId);
    const target = getTokenRecoilTarget(token);

    if (!target) {
      fxMap.delete(state.tokenId);
      continue;
    }

    state.tMs += dt;

    const localMs = state.tMs - state.delayMs;

    if (localMs < 0) {
      target.visible = state.base.visible;
      target.renderable = state.base.renderable;
      target.alpha = state.base.alpha;
      continue;
    }

    const t = clamp(localMs / Math.max(state.durationMs, 1), 0, 1);
    const k = recoilCurve(t);

    target.visible = state.base.visible;
    target.renderable = state.base.renderable;
    target.alpha = state.base.alpha;

    // Pivot inversion: increasing pivot moves rendered content opposite.
    const pivotX = state.base.pivotX - (state.offsetX * k);
    const pivotY = state.base.pivotY - (state.offsetY * k);

    if (target.pivot?.set) target.pivot.set(pivotX, pivotY);
    else {
      target.pivot.x = pivotX;
      target.pivot.y = pivotY;
    }

    target.rotation = state.base.rotation + (state.rotationRad * k);

    if (target.scale?.set) target.scale.set(state.base.scaleX, state.base.scaleY);
    else {
      target.scale.x = state.base.scaleX;
      target.scale.y = state.base.scaleY;
    }

    if (t >= 1) {
      restoreBase(target, state.base);
      fxMap.delete(state.tokenId);
    }
  }

  if (fxMap.size === 0) cleanupTicker(runtime, EFFECT_NAME);
}