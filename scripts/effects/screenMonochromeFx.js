// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\screenMonochromeFx.js

/**
 * FX Bus - Screen Monochrome FX
 *
 * Purpose:
 * - Apply a full-screen noir-style monochrome grade using PIXI.ColorMatrixFilter.
 * - Supports fade-in, optional timed hold, and fade-out.
 * - Runs entirely client-side. No document updates.
 *
 * Actions:
 * - fx.screenMonochrome.start
 * - fx.screenMonochrome.stop
 * - fx.screenMonochrome.update
 *
 * Payload fields:
 * - durationMs: number (default 0)
 *     - 0 = run until stopped
 *     - otherwise clamped to [1, 60000]
 * - fadeInMs: number (default 300)
 * - fadeOutMs: number (default 300)
 * - contrast: number (default 1.35)
 * - brightness: number (default 0.92)
 * - alpha: number 0-1 (default 1.0)
 * - immediate: boolean (stop only)
 *     - true = destroy immediately without fade-out
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, lerp } from "../utils.js";

const EFFECT_NAME = "screenMonochrome";

const ACTION_START = "fx.screenMonochrome.start";
const ACTION_STOP = "fx.screenMonochrome.stop";
const ACTION_UPDATE = "fx.screenMonochrome.update";

export function registerScreenMonochromeFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] screenMonochromeFx: invalid runtime.");
  }

  runtime.handlers.set(ACTION_START, (msg) => onStart(runtime, msg));
  runtime.handlers.set(ACTION_STOP, (msg) => onStop(runtime, msg));
  runtime.handlers.set(ACTION_UPDATE, (msg) => onUpdate(runtime, msg));
}

function getStage() {
  const stage = canvas?.app?.stage;
  if (!stage) throw new Error("[FX Bus] screenMonochromeFx: canvas.app.stage unavailable.");
  return stage;
}

function getRendererScreen() {
  const screen = canvas?.app?.renderer?.screen;
  if (!screen) return null;
  return screen;
}

function getColorMatrixFilterClass() {
  const FilterClass = globalThis.PIXI?.filters?.ColorMatrixFilter ?? globalThis.PIXI?.ColorMatrixFilter;
  if (!FilterClass) {
    throw new Error("[FX Bus] screenMonochromeFx: PIXI.ColorMatrixFilter unavailable.");
  }
  return FilterClass;
}

function normaliseParams(msg = {}) {
  const durationMsRaw = Number(msg.durationMs);
  const fadeInMsRaw = Number(msg.fadeInMs);
  const fadeOutMsRaw = Number(msg.fadeOutMs);
  const contrastRaw = Number(msg.contrast);
  const brightnessRaw = Number(msg.brightness);
  const alphaRaw = Number(msg.alpha);

  const durationMs = Number.isFinite(durationMsRaw)
    ? (durationMsRaw === 0 ? 0 : clamp(Math.round(durationMsRaw), 1, 60000))
    : 0;

  return {
    durationMs,
    fadeInMs: Number.isFinite(fadeInMsRaw) ? clamp(Math.round(fadeInMsRaw), 0, 10000) : 300,
    fadeOutMs: Number.isFinite(fadeOutMsRaw) ? clamp(Math.round(fadeOutMsRaw), 0, 10000) : 300,
    contrast: Number.isFinite(contrastRaw) ? clamp(contrastRaw, 0, 4) : 1.35,
    brightness: Number.isFinite(brightnessRaw) ? clamp(brightnessRaw, 0, 3) : 0.92,
    alpha: Number.isFinite(alphaRaw) ? clamp(alphaRaw, 0, 1) : 1.0
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

function ensureFiltersArray(target) {
  if (!Array.isArray(target.filters)) {
    target.filters = [];
  }
  return target.filters;
}

function attachFilter(target, filter) {
  const filters = ensureFiltersArray(target);
  if (!filters.includes(filter)) {
    target.filters = [...filters, filter];
  }
}

function detachFilter(target, filter) {
  const filters = Array.isArray(target.filters) ? target.filters : [];
  target.filters = filters.filter((f) => f !== filter);
}

function syncFilterArea(target) {
  const screen = getRendererScreen();
  if (!screen) return;
  target.filterArea = screen;
}

function clearFilterAreaIfUnused(target) {
  const filters = Array.isArray(target.filters) ? target.filters : [];
  if (filters.length > 0) return;

  try {
    delete target.filterArea;
  } catch {
    try {
      target.filterArea = undefined;
    } catch {
      // ignore
    }
  }
}

function createEffectState() {
  const stage = getStage();
  const FilterClass = getColorMatrixFilterClass();
  const filter = new FilterClass();

  filter.reset();
  syncFilterArea(stage);
  attachFilter(stage, filter);

  return {
    target: stage,
    filter,
    params: normaliseParams({}),
    elapsedMs: 0,
    stopRequested: false,
    fadeOutElapsedMs: 0,
    currentStrength: 0
  };
}

function hardResetFilter(filter) {
  try {
    filter.reset();
  } catch {
    // ignore
  }
}

function destroyEffect(runtime) {
  const state = getState(runtime);
  if (!state) return;

  cleanupTicker(runtime, EFFECT_NAME);

  try {
    hardResetFilter(state.filter);
  } catch {
    // ignore
  }

  try {
    if (state.target && state.filter) {
      detachFilter(state.target, state.filter);
    }
  } catch {
    // ignore
  }

  try {
    if (state.target) {
      clearFilterAreaIfUnused(state.target);
    }
  } catch {
    // ignore
  }

  try {
    state.filter?.destroy?.();
  } catch {
    // ignore
  }

  clearState(runtime);

  try {
    canvas?.app?.renderer?.render?.(canvas.app.stage);
  } catch {
    // ignore
  }
}

function computeStrength(state) {
  const { params } = state;
  let strength = params.alpha;

  if (!state.stopRequested && params.fadeInMs > 0) {
    const t = clamp(state.elapsedMs / params.fadeInMs, 0, 1);
    strength *= t;
  }

  if (state.stopRequested) {
    if (params.fadeOutMs <= 0) return 0;
    const t = clamp(state.fadeOutElapsedMs / params.fadeOutMs, 0, 1);
    strength *= (1 - t);
  }

  return clamp(strength, 0, 1);
}

function refreshFilter(state) {
  syncFilterArea(state.target);

  const strength = computeStrength(state);
  const greyscaleAmount = strength;
  const contrastAmount = lerp(1, state.params.contrast, strength);
  const brightnessAmount = lerp(1, state.params.brightness, strength);

  const filter = state.filter;
  filter.reset();

  if (typeof filter.greyscale === "function") {
    filter.greyscale(greyscaleAmount, false);
  } else if (typeof filter.blackAndWhite === "function" && greyscaleAmount > 0.0001) {
    filter.blackAndWhite(false);
  }

  if (typeof filter.contrast === "function") {
    filter.contrast(contrastAmount, true);
  }

  if (typeof filter.brightness === "function") {
    filter.brightness(brightnessAmount, true);
  }

  state.currentStrength = strength;
}

function beginStop(state) {
  if (state.stopRequested) return;
  state.stopRequested = true;
  state.fadeOutElapsedMs = 0;
}

function onStart(runtime, msg) {
  destroyEffect(runtime);

  const state = createEffectState();
  state.params = normaliseParams(msg);
  state.elapsedMs = 0;
  state.stopRequested = false;
  state.fadeOutElapsedMs = 0;

  setState(runtime, state);
  refreshFilter(state);

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onUpdate(runtime, msg) {
  const state = getState(runtime);
  if (!state) {
    onStart(runtime, msg);
    return;
  }

  state.params = normaliseParams({
    durationMs: msg.durationMs ?? state.params.durationMs,
    fadeInMs: msg.fadeInMs ?? state.params.fadeInMs,
    fadeOutMs: msg.fadeOutMs ?? state.params.fadeOutMs,
    contrast: msg.contrast ?? state.params.contrast,
    brightness: msg.brightness ?? state.params.brightness,
    alpha: msg.alpha ?? state.params.alpha
  });

  state.stopRequested = false;
  state.fadeOutElapsedMs = 0;

  refreshFilter(state);
  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onStop(runtime, msg = {}) {
  const state = getState(runtime);
  if (!state) return;

  const immediate = Boolean(msg?.immediate);

  if (immediate || state.params.fadeOutMs <= 0) {
    destroyEffect(runtime);
    return;
  }

  beginStop(state);
  refreshFilter(state);
  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function tick(runtime, deltaMS) {
  const state = getState(runtime);
  if (!state) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  const dt = Math.max(0, deltaMS);
  state.elapsedMs += dt;

  if (!state.stopRequested && state.params.durationMs !== 0 && state.elapsedMs >= state.params.durationMs) {
    beginStop(state);
  }

  if (state.stopRequested) {
    state.fadeOutElapsedMs += dt;
  }

  refreshFilter(state);

  if (state.stopRequested && state.currentStrength <= 0.0001) {
    destroyEffect(runtime);
  }
}