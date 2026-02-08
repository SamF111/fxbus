// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenOscillationFx.js

/**
 * FX Bus - Token Oscillation FX (Foundry VTT v13+)
 *
 * Compatibility goals:
 * - Drag-safe: never touch token.x/y or the Token container position.
 * - Z Scatter-safe: do not reparent token.mesh/icon, and do not animate position.
 *
 * Implementation:
 * - Animate ONLY:
 *   - target.pivot (bob/sway)  -> visual offset without touching position.
 *   - target.rotation (roll)
 * - Snapshot + restore:
 *   - pivot, rotation, scale
 *   - visible/renderable/alpha (prevents "stuck invisible" if another module toggles state and never restores due to transform contention)
 *
 * Notes:
 * - Enforcing baseline visibility during oscillation may override other modules that intentionally hide the mesh
 *   while the effect is running. This is deliberate to eliminate the permanent-invisible failure mode.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";

const EFFECT_NAME = "tokenOscillation";

const ACTION_START = "fx.tokenOsc.start";
const ACTION_UPDATE = "fx.tokenOsc.update";
const ACTION_STOP = "fx.tokenOsc.stop";

// FNV-1a 32-bit hash constants
const FNV_OFFSET_BASIS_32 = 0x811c9dc5;
const FNV_PRIME_32 = 0x01000193;
const UINT32_MAX_PLUS_ONE = 2 ** 32;

// Noise harmonic and mixing constants
const NOISE_FREQ_A = 17.0;
const NOISE_FREQ_B = 29.0;
const NOISE_FREQ_C = 41.0;

const NOISE_W_A = 1.0;
const NOISE_W_B = 0.6;
const NOISE_W_C = 0.3;
const NOISE_W_SUM = NOISE_W_A + NOISE_W_B + NOISE_W_C;

// Jitter projection
const JITTER_X = 0.8;
const JITTER_Y = 0.6;
const JITTER_ROT = 0.15;

/**
 * Register handlers for token oscillation effect.
 *
 * @param {object} runtime
 */
export function registerTokenOscillationFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] tokenOscillationFx: invalid runtime.");

  runtime.handlers.set(ACTION_START, (msg) => onStart(runtime, msg));
  runtime.handlers.set(ACTION_UPDATE, (msg) => onUpdate(runtime, msg));
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
 * Parse and clamp incoming parameters from the bus payload.
 *
 * @param {object} msg
 * @returns {object}
 */
function normaliseParams(msg) {
  const rollDeg = Number.isFinite(msg.rollDeg) ? msg.rollDeg : 3;
  const bobPx = Number.isFinite(msg.bobPx) ? msg.bobPx : 2;
  const swayPx = Number.isFinite(msg.swayPx) ? msg.swayPx : 1;
  const freqHz = Number.isFinite(msg.freqHz) ? msg.freqHz : 0.7;
  const noise = Number.isFinite(msg.noise) ? msg.noise : 0;
  const randomPhase = typeof msg.randomPhase === "boolean" ? msg.randomPhase : true;

  return {
    rollRad: degToRad(rollDeg),
    bobPx,
    swayPx,
    freqHz: Math.max(0.01, freqHz),
    noise: clamp(noise, 0, 0.5),
    randomPhase
  };
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
 * Resolve the render object to animate.
 * Do not reparent it.
 *
 * @param {Token} token
 * @returns {PIXI.DisplayObject|null}
 */
function getTokenOscTarget(token) {
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
 * Deterministic pseudo-noise in [-1, 1].
 *
 * @param {string} tokenId
 * @param {number} tSeconds
 * @returns {number}
 */
function noise1(tokenId, tSeconds) {
  const seed = hashStringToUnit(tokenId);

  const TWO_PI = 2 * Math.PI;
  const FOUR_PI = 4 * Math.PI;
  const SIX_PI = 6 * Math.PI;

  const a = Math.sin((tSeconds * NOISE_FREQ_A) + seed * TWO_PI);
  const b = Math.sin((tSeconds * NOISE_FREQ_B) + seed * FOUR_PI);
  const c = Math.sin((tSeconds * NOISE_FREQ_C) + seed * SIX_PI);

  return clamp((NOISE_W_A * a + NOISE_W_B * b + NOISE_W_C * c) / NOISE_W_SUM, -1, 1);
}

/**
 * FNV-1a 32-bit hash -> unit interval [0, 1)
 *
 * @param {string} str
 * @returns {number}
 */
function hashStringToUnit(str) {
  let h = FNV_OFFSET_BASIS_32;

  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME_32);
  }

  return (h >>> 0) / UINT32_MAX_PLUS_ONE;
}

/**
 * Phase is deterministic from tokenId unless randomPhase=false.
 *
 * @param {string} tokenId
 * @param {boolean} randomPhase
 * @returns {number}
 */
function pickPhase(tokenId, randomPhase) {
  if (!randomPhase) return 0;
  return hashStringToUnit(tokenId) * 2 * Math.PI;
}

function onStart(runtime, msg) {
  const tokenIds = asTokenIds(msg.tokenIds);
  if (tokenIds.length === 0) return;

  const params = normaliseParams(msg);
  const fxMap = getEffectMap(runtime);

  for (const tokenId of tokenIds) {
    const token = canvas?.tokens?.get(tokenId);
    if (!token) continue;

    const target = getTokenOscTarget(token);
    if (!target) continue;

    const existing = fxMap.get(tokenId);
    if (existing) {
      existing.params = params;
      existing.phase = pickPhase(tokenId, params.randomPhase);
      continue;
    }

    const base = snapshotBase(target);
    if (!base) continue;

    fxMap.set(tokenId, {
      tokenId,
      base,
      params,
      phase: pickPhase(tokenId, params.randomPhase),
      t: 0
    });
  }

  if (fxMap.size > 0) ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onUpdate(runtime, msg) {
  const tokenIds = asTokenIds(msg.tokenIds);
  if (tokenIds.length === 0) return;

  const params = normaliseParams(msg);
  const fxMap = getEffectMap(runtime);

  for (const tokenId of tokenIds) {
    const state = fxMap.get(tokenId);
    if (!state) continue;

    state.params = params;
    state.phase = pickPhase(tokenId, params.randomPhase);
  }
}

function onStop(runtime, msg) {
  const tokenIds = asTokenIds(msg.tokenIds);
  if (tokenIds.length === 0) return;

  const fxMap = getEffectMap(runtime);

  for (const tokenId of tokenIds) {
    const state = fxMap.get(tokenId);
    if (!state) continue;

    const token = canvas?.tokens?.get(tokenId);
    if (token) {
      const target = getTokenOscTarget(token);
      if (target) restoreBase(target, state.base);
    }

    fxMap.delete(tokenId);
  }

  if (fxMap.size === 0) cleanupTicker(runtime, EFFECT_NAME);
}

/**
 * Per-frame update.
 *
 * Enforced invariants while active:
 * - target.visible/renderable/alpha pinned to baseline to avoid “perma-invisible” after overlap resolution.
 * - position untouched (no bob/sway in position).
 * - bob/sway applied via pivot; roll via rotation.
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

  const dt = Math.max(0, deltaMS) / 1000;

  for (const state of fxMap.values()) {
    const token = canvas?.tokens?.get(state.tokenId);
    if (!token) continue;

    const target = getTokenOscTarget(token);
    if (!target) continue;

    state.t += dt;

    const { base, params, phase } = state;

    const w = 2 * Math.PI * params.freqHz;
    const t = state.t;

    const s = Math.sin(w * t + phase);
    const c = Math.cos(w * t + phase);

    const roll = params.rollRad * s;
    const bob = params.bobPx * c;
    const sway = params.swayPx * s;

    const n = params.noise > 0 ? noise1(state.tokenId, t) * params.noise : 0;
    const jx = n * JITTER_X;
    const jy = n * JITTER_Y;
    const jr = n * JITTER_ROT;

    // Pin render-state to baseline while effect is active.
    target.visible = base.visible;
    target.renderable = base.renderable;
    target.alpha = base.alpha;

    // Pivot offsets (invert sign because pivot moves the content opposite).
    const pivotX = base.pivotX - (sway + jx);
    const pivotY = base.pivotY - (bob + jy);

    if (target.pivot?.set) target.pivot.set(pivotX, pivotY);
    else {
      target.pivot.x = pivotX;
      target.pivot.y = pivotY;
    }

    target.rotation = base.rotation + roll + jr;

    if (target.scale?.set) target.scale.set(base.scaleX, base.scaleY);
    else {
      target.scale.x = base.scaleX;
      target.scale.y = base.scaleY;
    }
  }
}
