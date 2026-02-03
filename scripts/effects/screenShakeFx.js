/**
 * FX Bus - Screen Shake FX (Foundry VTT v12+)
 *
 * Purpose:
 * - Apply a camera shake by offsetting the PIXI stage position (x/y).
 * - Runs entirely client-side. No document updates.
 *
 * Actions:
 * - fx.screenShake.start: start a shake (overwrites any existing active shake state)
 * - fx.screenShake.stop: stop immediately and restore stage position
 *
 * Parameters (payload fields):
 * - intensityPx: number (default 12)   - max pixel displacement
 * - durationMs: number (default 600)
 *     - If 0: run indefinitely until fx.screenShake.stop or fx.bus.reset
 *     - Else: clamped to [1, 60000]
 * - freqHz: number (default 24)        - shake frequency in Hz
 *
 * Behaviour:
 * - Uses deterministic oscillation, not RNG.
 * - Quadratic ease-out over duration for finite shakes.
 * - For indefinite shakes (durationMs = 0), amplitude is constant (no envelope).
 * - Auto-restores original stage position on completion or stop.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, easeOutQuad, snapshotStage, restoreStage } from "../utils.js";

const EFFECT_NAME = "screenShake";

const ACTION_START = "fx.screenShake.start";
const ACTION_STOP = "fx.screenShake.stop";

export function registerScreenShakeFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] screenShakeFx: invalid runtime.");

  runtime.handlers.set(ACTION_START, (msg) => onStart(runtime, msg));
  runtime.handlers.set(ACTION_STOP, () => onStop(runtime));
}

function normaliseParams(msg) {
  const intensityRaw = Number.isFinite(msg.intensityPx) ? msg.intensityPx : 12;

  const durationMsRaw = Number.isFinite(msg.durationMs) ? msg.durationMs : 600;
  const durationMs = durationMsRaw === 0 ? 0 : clamp(durationMsRaw, 1, 60000);

  const freqHzRaw = Number.isFinite(msg.freqHz) ? msg.freqHz : 24;

  // Safety: sustained shake should be subtle.
  const intensityCap = durationMs === 0 ? 6 : 500;

  return {
    intensityPx: clamp(intensityRaw, 0, intensityCap),
    durationMs,
    freqHz: clamp(freqHzRaw, 0.1, 120)
  };
}

function getState(runtime) {
  return runtime.screenFx.get(EFFECT_NAME) ?? null;
}

function setState(runtime, state) {
  runtime.screenFx.set(EFFECT_NAME, state);
}

function clearState(runtime) {
  runtime.screenFx.delete(EFFECT_NAME);
}

function onStart(runtime, msg) {
  const params = normaliseParams(msg);

  // Capture base stage once, unless already shaking.
  const existing = getState(runtime);
  const base = existing?.base ?? snapshotStage();
  if (!base) return;

  setState(runtime, {
    base,
    params,
    elapsedMs: 0
  });

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onStop(runtime) {
  const state = getState(runtime);
  if (state?.base) restoreStage(state.base);

  clearState(runtime);
  cleanupTicker(runtime, EFFECT_NAME);
}

function tick(runtime, deltaMS) {
  const state = getState(runtime);
  if (!state) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  state.elapsedMs += Math.max(0, deltaMS);

  const { base, params, elapsedMs } = state;

  // Envelope:
  // - finite: ease out over duration
  // - infinite: constant
  const eased = params.durationMs === 0
    ? 1
    : 1 - easeOutQuad(clamp(elapsedMs / params.durationMs, 0, 1)); // 1 -> 0

  // Deterministic shake: two sines with phase offset.
  const timeSeconds = elapsedMs / 1000;
  const w = 2 * Math.PI * params.freqHz;

  const sx = Math.sin(w * timeSeconds);
  const sy = Math.sin(w * timeSeconds + Math.PI / 2);

  const amp = params.intensityPx * eased;

  const stage = canvas?.app?.stage;
  if (!stage) {
    onStop(runtime);
    return;
  }

  stage.x = base.x + sx * amp;
  stage.y = base.y + sy * amp;

  if (params.durationMs !== 0 && elapsedMs >= params.durationMs) {
    onStop(runtime);
  }
}
