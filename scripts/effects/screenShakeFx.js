// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\screenShakeFx.js

/**
 * FX Bus - Screen Shake FX (Foundry v13+)
 *
 * Purpose:
 * - Apply a camera shake by offsetting the PIXI stage position (x/y).
 * - Runs entirely client-side. No document updates.
 *
 * Critical fix:
 * - Never "own" stage.x/y absolutely during the shake.
 * - Track and apply a delta offset on top of whatever the stage position is now.
 *   This prevents interfering with panning/drag interactions that can otherwise get stuck.
 *
 * Actions:
 * - fx.screenShake.start: start a shake (overwrites any existing active shake state)
 * - fx.screenShake.stop: stop immediately and restore stage position (removes only our offset)
 *
 * Parameters (payload fields):
 * - intensityPx: number (default 12)   - max pixel displacement
 * - durationMs: number (default 600)
 *     - If 0: run indefinitely until fx.screenShake.stop or fx.bus.reset
 *     - Else: clamped to [1, 60000]
 * - freqHz: number (default 24)        - shake frequency in Hz
 *
 * Behaviour:
 * - Deterministic oscillation (no RNG).
 * - Quadratic ease-out over duration for finite shakes.
 * - For indefinite shakes (durationMs = 0), amplitude is constant (no envelope).
 * - Auto-restores by removing only the last applied offset (no snapping over user pan).
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, easeOutQuad, snapshotStage } from "../utils.js";

const EFFECT_NAME = "screenShake";

const ACTION_START = "fx.screenShake.start";
const ACTION_STOP = "fx.screenShake.stop";

export function registerScreenShakeFx(runtime) {
  /**
   * Register FX Bus message handlers for screen shake.
   * Uses a single keyed state entry under runtime.screenFx.
   */
  if (!runtime?.handlers) throw new Error("[FX Bus] screenShakeFx: invalid runtime.");

  runtime.handlers.set(ACTION_START, (msg) => onStart(runtime, msg));
  runtime.handlers.set(ACTION_STOP, () => onStop(runtime));
}

function normaliseParams(msg) {
  /**
   * Normalise and clamp incoming parameters.
   * Keeps indefinite shakes subtle to reduce input disruption.
   */
  const intensityRaw = Number.isFinite(msg?.intensityPx) ? msg.intensityPx : 12;

  const durationMsRaw = Number.isFinite(msg?.durationMs) ? msg.durationMs : 600;
  const durationMs = durationMsRaw === 0 ? 0 : clamp(durationMsRaw, 1, 60000);

  const freqHzRaw = Number.isFinite(msg?.freqHz) ? msg.freqHz : 24;

  // Safety: sustained shake should be subtle.
  const intensityCap = durationMs === 0 ? 6 : 500;

  return {
    intensityPx: clamp(intensityRaw, 0, intensityCap),
    durationMs,
    freqHz: clamp(freqHzRaw, 0.1, 120)
  };
}

function getState(runtime) {
  /**
   * Read current screen shake state.
   */
  return runtime.screenFx.get(EFFECT_NAME) ?? null;
}

function setState(runtime, state) {
  /**
   * Persist current screen shake state.
   */
  runtime.screenFx.set(EFFECT_NAME, state);
}

function clearState(runtime) {
  /**
   * Remove current screen shake state.
   */
  runtime.screenFx.delete(EFFECT_NAME);
}

function getStage() {
  /**
   * Resolve PIXI stage safely.
   */
  return canvas?.app?.stage ?? null;
}

function removeAppliedOffset(state) {
  /**
   * Remove only the offset we last applied, preserving any user pan/other movement.
   * This is the core fix: do not restore to a stale absolute snapshot.
   */
  const stage = getStage();
  if (!stage) return;

  const last = state?.lastOffset ?? { x: 0, y: 0 };
  if (!last) return;

  stage.x = stage.x - last.x;
  stage.y = stage.y - last.y;

  state.lastOffset = { x: 0, y: 0 };
}

function onStart(runtime, msg) {
  /**
   * Start or restart a shake.
   * If already active, remove the previously applied offset before continuing,
   * then keep the evolving base (including any pan) as the reference.
   */
  const params = normaliseParams(msg ?? {});
  const stage = getStage();
  if (!stage) return;

  const existing = getState(runtime);
  if (existing) {
    removeAppliedOffset(existing);
  }

  // Capture an initial base snapshot for reference/debug only.
  // Do not restore to it on stop (stop removes offset only).
  const initialBase = snapshotStage();
  if (!initialBase) return;

  const state = {
    initialBase,
    params,
    elapsedMs: 0,
    lastOffset: { x: 0, y: 0 }
  };

  setState(runtime, state);
  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onStop(runtime) {
  /**
   * Stop immediately.
   * Removes only our last applied offset so the stage returns to whatever it should be now.
   */
  const state = getState(runtime);
  if (state) {
    removeAppliedOffset(state);
  }

  clearState(runtime);
  cleanupTicker(runtime, EFFECT_NAME);
}

function tick(runtime, deltaMS) {
  /**
   * Tick handler. Applies a deterministic offset as a delta on top of the current stage position.
   * Steps:
   * 1) Remove last tick's offset to recover the current base (which may have changed due to pan).
   * 2) Compute new offset for this tick.
   * 3) Apply new offset and store it.
   */
  const state = getState(runtime);
  if (!state) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  const stage = getStage();
  if (!stage) {
    onStop(runtime);
    return;
  }

  const safeDelta = Math.max(0, deltaMS);
  state.elapsedMs += safeDelta;

  // 1) Remove the last applied offset to recover current base.
  const last = state.lastOffset ?? { x: 0, y: 0 };
  stage.x = stage.x - last.x;
  stage.y = stage.y - last.y;

  const { params, elapsedMs } = state;

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

  // 2) Compute this tick's offset.
  const nextOffset = {
    x: sx * amp,
    y: sy * amp
  };

  // 3) Apply and store.
  stage.x = stage.x + nextOffset.x;
  stage.y = stage.y + nextOffset.y;
  state.lastOffset = nextOffset;

  if (params.durationMs !== 0 && elapsedMs >= params.durationMs) {
    onStop(runtime);
  }
}
