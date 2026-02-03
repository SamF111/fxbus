/**
 * FX Bus - Token Oscillation FX (Foundry VTT v12+)
 *
 * Purpose:
 * - Apply a gentle, vehicle-like motion (roll + bob + sway) to specific tokens.
 * - Runs entirely client-side via PIXI transforms. No document updates.
 *
 * Actions:
 * - fx.tokenOsc.start: start oscillation for tokenIds (creates state + snapshots base transforms)
 * - fx.tokenOsc.update: update parameters for existing oscillation entries (optional)
 * - fx.tokenOsc.stop: stop oscillation for tokenIds (restore base transforms exactly)
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
 * - Optional noise is generated deterministically from tokenId + time.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import {
  clamp,
  degToRad,
  getTokenRenderObject,
  snapshotTokenTransform,
  restoreTokenTransform
} from "../utils.js";

const EFFECT_NAME = "tokenOscillation";

const ACTION_START = "fx.tokenOsc.start";
const ACTION_UPDATE = "fx.tokenOsc.update";
const ACTION_STOP = "fx.tokenOsc.stop";

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

function getEffectMap(runtime) {
  if (!runtime.tokenFx.has(EFFECT_NAME)) {
    runtime.tokenFx.set(EFFECT_NAME, new Map()); // Map(tokenId -> state)
  }
  return runtime.tokenFx.get(EFFECT_NAME);
}

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

function asTokenIds(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.length > 0);
}

/**
 * Deterministic pseudo-noise in [-1, 1], based on tokenId and time.
 * No RNG; uses sum of sines.
 */
function noise1(tokenId, tSeconds) {
  const seed = hashStringToUnit(tokenId); // [0,1)
  const a = Math.sin((tSeconds * 17.0) + seed * 6.283185307179586);
  const b = Math.sin((tSeconds * 29.0) + seed * 12.566370614359172);
  const c = Math.sin((tSeconds * 41.0) + seed * 18.84955592153876);
  return clamp((a + 0.6 * b + 0.3 * c) / 1.9, -1, 1);
}

function hashStringToUnit(str) {
  // Simple stable hash -> [0,1). Deterministic across sessions for same tokenId.
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert uint32 to [0,1)
  return (h >>> 0) / 4294967296;
}

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

    const obj = getTokenRenderObject(token);
    if (!obj) continue;

    const existing = fxMap.get(tokenId);
    if (existing) {
      existing.params = params;
      existing.phase = pickPhase(tokenId, params.randomPhase);
      continue;
    }

    const base = snapshotTokenTransform(token);
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
    if (token) restoreTokenTransform(token, state.base);

    fxMap.delete(tokenId);
  }

  if (fxMap.size === 0) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

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

    const obj = getTokenRenderObject(token);
    if (!obj) continue;

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
    const jx = n * 0.8;
    const jy = n * 0.6;
    const jr = n * 0.15;

    obj.x = base.x + sway + jx;
    obj.y = base.y + bob + jy;
    obj.rotation = base.rotation + roll + jr;
    obj.scale.set(base.scaleX, base.scaleY);
  }
}
