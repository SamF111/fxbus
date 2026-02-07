// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenOscillationFx.js

/**
 * FX Bus - Token Oscillation FX (Foundry VTT v13+)
 *
 * Purpose:
 * - Apply a gentle, vehicle-like motion (roll + bob + sway) to specific tokens.
 * - Runs entirely client-side via PIXI transforms. No document updates.
 *
 * Core drag-safety constraint:
 * - NEVER write to token.x / token.y / token.position (world-space container motion).
 * - Foundry owns token world movement (dragging, snapping, ruler movement).
 *
 * What we *do* animate:
 * - A render child display object: token.mesh (preferred) or token.icon (fallback).
 *
 * Why the earlier "local-only" approach can fail:
 * - In v13, the rendered sprite may not be parented directly to the Token container.
 * - If the render object is in WORLD space (not token-local), writing "local offsets"
 *   pins the sprite while the selection border (token container) moves.
 *
 * Therefore we support two coordinate modes:
 * - LOCAL mode: target.parent === token
 *   - target.position is local to token; apply offsets directly.
 * - WORLD mode: target.parent !== token
 *   - target.position is in the same space as token.x/y; drive target.position
 *     from token.x/y each frame plus a cached offset.
 *
 * Actions:
 * - fx.tokenOsc.start: start oscillation for tokenIds (creates per-token state + baseline)
 * - fx.tokenOsc.update: update parameters for existing oscillation entries
 * - fx.tokenOsc.stop: stop oscillation for tokenIds (restore baseline exactly)
 *
 * Parameters (payload fields):
 * - tokenIds: string[]
 * - rollDeg: number (default 3)          - peak roll in degrees
 * - bobPx: number (default 2)            - peak vertical offset in pixels
 * - swayPx: number (default 1)           - peak horizontal offset in pixels
 * - freqHz: number (default 0.7)         - oscillation frequency in Hz
 * - noise: number (default 0)            - bounded micro-jitter amplitude multiplier (0-0.5 recommended)
 * - randomPhase: boolean (default true)  - per-token phase offset
 *
 * Determinism:
 * - No runtime RNG after state creation.
 * - Phase and noise are derived deterministically from tokenId.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, degToRad } from "../utils.js";

const EFFECT_NAME = "tokenOscillation";

const ACTION_START = "fx.tokenOsc.start";
const ACTION_UPDATE = "fx.tokenOsc.update";
const ACTION_STOP = "fx.tokenOsc.stop";

// FNV-1a 32-bit hash constants (Fowler–Noll–Vo)
const FNV_OFFSET_BASIS_32 = 0x811c9dc5; // 2166136261
const FNV_PRIME_32 = 0x01000193; // 16777619
const UINT32_MAX_PLUS_ONE = 2 ** 32;

// Noise harmonic and mixing constants (design choices; normalised to keep output in [-1, 1])
const NOISE_FREQ_A = 17.0;
const NOISE_FREQ_B = 29.0;
const NOISE_FREQ_C = 41.0;

const NOISE_W_A = 1.0;
const NOISE_W_B = 0.6;
const NOISE_W_C = 0.3;
const NOISE_W_SUM = NOISE_W_A + NOISE_W_B + NOISE_W_C;

// Jitter projection (design choices)
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
 * Shape:
 * - Map(tokenId -> {
 *     tokenId,
 *     base,      // baseline transform descriptor (local or world mode)
 *     params,    // oscillation parameters
 *     phase,     // deterministic phase offset
 *     t          // elapsed seconds since effect started
 *   })
 */
function getEffectMap(runtime) {
  if (!runtime.tokenFx.has(EFFECT_NAME)) {
    runtime.tokenFx.set(EFFECT_NAME, new Map()); // Map(tokenId -> state)
  }
  return runtime.tokenFx.get(EFFECT_NAME);
}

/**
 * Parse and clamp incoming parameters from the bus payload.
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
 */
function asTokenIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.length > 0);
}

/**
 * Resolve the render object that should receive oscillation.
 *
 * IMPORTANT:
 * - This must NOT be the Token container itself.
 * - We must operate on a rendered child so we do not interfere with Foundry’s
 *   ownership of token world-space movement during drag operations.
 *
 * Preference order:
 * 1) token.mesh  (v13 primary render mesh; preferred)
 * 2) token.icon  (fallback for older / edge cases)
 *
 * @param {Token} token
 * @returns {PIXI.DisplayObject|null}
 */
function getTokenOscTarget(token) {
  return token?.mesh ?? token?.icon ?? null;
}

/**
 * Snapshot a baseline transform for the target in a drag-safe way.
 *
 * Two modes are detected automatically:
 *
 * LOCAL mode (target.parent === token):
 * - target.position is token-local.
 * - We store localX/localY and reapply around those values each tick.
 *
 * WORLD mode (target.parent !== token):
 * - target.position is in world space (same coordinate space as token.x/y).
 * - We store dx/dy = (target.position - token.x/y).
 * - Each tick we set target.position = token.x/y + dx/dy + oscillation offsets.
 *
 * Rotation and scale are always stored/restored directly on the target.
 *
 * @param {Token} token
 * @param {PIXI.DisplayObject} target
 * @returns {object|null} baseline descriptor
 */
function snapshotTargetBase(token, target) {
  if (!token || !target) return null;

  const rotation = Number.isFinite(target.rotation) ? target.rotation : 0;
  const scaleX = Number.isFinite(target.scale?.x) ? target.scale.x : 1;
  const scaleY = Number.isFinite(target.scale?.y) ? target.scale.y : 1;

  const isLocal = target.parent === token;

  if (isLocal) {
    const localX = Number.isFinite(target.position?.x) ? target.position.x : 0;
    const localY = Number.isFinite(target.position?.y) ? target.position.y : 0;

    return {
      mode: "local",
      localX,
      localY,
      rotation,
      scaleX,
      scaleY
    };
  }

  // WORLD mode: treat target.position as world-space, anchored to token.x/y.
  const worldX = Number.isFinite(target.position?.x) ? target.position.x : token.x;
  const worldY = Number.isFinite(target.position?.y) ? target.position.y : token.y;

  return {
    mode: "world",
    dx: worldX - token.x,
    dy: worldY - token.y,
    rotation,
    scaleX,
    scaleY
  };
}

/**
 * Restore the target to its exact baseline transform.
 *
 * Drag-safe by construction:
 * - token.x/y are never modified
 * - WORLD mode restoration anchors to token’s *current* x/y, so restoration remains correct
 *   even if the token was dragged while oscillating.
 *
 * @param {Token} token
 * @param {PIXI.DisplayObject} target
 * @param {object} base
 */
function restoreTargetBase(token, target, base) {
  if (!token || !target || !base) return;

  if (base.mode === "local") {
    if (target.position?.set) target.position.set(base.localX, base.localY);
    else {
      target.position.x = base.localX;
      target.position.y = base.localY;
    }
  } else {
    const x = token.x + base.dx;
    const y = token.y + base.dy;

    if (target.position?.set) target.position.set(x, y);
    else {
      target.position.x = x;
      target.position.y = y;
    }
  }

  target.rotation = base.rotation;

  if (target.scale?.set) target.scale.set(base.scaleX, base.scaleY);
  else {
    target.scale.x = base.scaleX;
    target.scale.y = base.scaleY;
  }
}

/**
 * Deterministic pseudo-noise in [-1, 1], based on tokenId and time.
 * No RNG; uses sum of sines with explicit multiples of Math.PI.
 */
function noise1(tokenId, tSeconds) {
  const seed = hashStringToUnit(tokenId); // [0,1)

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
 * - offset basis and prime are fixed by the FNV specification
 * - mapping to [0,1) is an adaptation for phase/noise seeding
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
 * This gives a stable, non-synchronised "fleet" motion for many tokens.
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

    // Update existing entry rather than re-snapshotting baseline.
    const existing = fxMap.get(tokenId);
    if (existing) {
      existing.params = params;
      existing.phase = pickPhase(tokenId, params.randomPhase);
      continue;
    }

    // Snapshot baseline once at start.
    const base = snapshotTargetBase(token, target);
    if (!base) continue;

    fxMap.set(tokenId, {
      tokenId,
      base,
      params,
      phase: pickPhase(tokenId, params.randomPhase),
      t: 0
    });
  }

  if (fxMap.size > 0) {
    ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
  }
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
      if (target) restoreTargetBase(token, target, state.base);
    }

    fxMap.delete(tokenId);
  }

  if (fxMap.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

/**
 * Per-frame oscillation update.
 *
 * Key property:
 * - In WORLD mode, the sprite is re-anchored to token.x/y each frame, so it follows
 *   the token while dragging without us ever mutating token.x/y.
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

    // Angular frequency for a sinusoid: w = 2πf
    const w = 2 * Math.PI * params.freqHz;
    const t = state.t;

    // Use sin/cos for phase-shifted components:
    // - roll and sway follow sin
    // - bob follows cos (90° out of phase) so the motion feels like suspension
    const s = Math.sin(w * t + phase);
    const c = Math.cos(w * t + phase);

    const roll = params.rollRad * s;
    const bob = params.bobPx * c;
    const sway = params.swayPx * s;

    // Optional deterministic jitter scaled by noise parameter.
    const n = params.noise > 0 ? noise1(state.tokenId, t) * params.noise : 0;
    const jx = n * JITTER_X;
    const jy = n * JITTER_Y;
    const jr = n * JITTER_ROT;

    if (base.mode === "local") {
      // LOCAL MODE: apply offsets relative to cached local baseline.
      if (target.position?.set) {
        target.position.set(base.localX + sway + jx, base.localY + bob + jy);
      } else {
        target.position.x = base.localX + sway + jx;
        target.position.y = base.localY + bob + jy;
      }
    } else {
      // WORLD MODE: anchor to token.x/y every frame so dragging remains correct.
      const x = token.x + base.dx + sway + jx;
      const y = token.y + base.dy + bob + jy;

      if (target.position?.set) target.position.set(x, y);
      else {
        target.position.x = x;
        target.position.y = y;
      }
    }

    // Rotation and scale always apply directly to the target.
    target.rotation = base.rotation + roll + jr;

    if (target.scale?.set) target.scale.set(base.scaleX, base.scaleY);
    else {
      target.scale.x = base.scaleX;
      target.scale.y = base.scaleY;
    }
  }
}
