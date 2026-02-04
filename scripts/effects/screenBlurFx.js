// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\screenBlurFx.js

/**
 * FX Bus - Screen Blur FX (Foundry v13+)
 *
 * Purpose:
 * - Full-screen blur overlay using PIXI BlurFilter applied to canvas.stage.
 *
 * Messages:
 * - fx.screenBlur.start:
 *    strength      number  (0-100, typical 0-20)
 *    quality       number  (1-8)
 *    durationMs    number  (0 = until stopped)
 *    ease          string  ("inOut" | "in" | "out" | "linear")
 *    freqHz        number  (0 = static, >0 = pulse)
 *    minStrength   number
 *    maxStrength   number
 *
 * - fx.screenBlur.stop
 *
 * Runtime:
 * - Uses the enforced shared ticker utilities:
 *   ensureTicker(runtime, effectName, tickFn(deltaMS))
 *   cleanupTicker(runtime, effectName)
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";

const FX_ID = "screenBlur";

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function easeValue(kind, t01) {
  const t = clamp(t01, 0, 1);

  switch (String(kind)) {
    case "in":
      return t * t;
    case "out":
      return 1 - (1 - t) * (1 - t);
    case "linear":
      return t;
    case "inOut":
    default:
      return t * t * (3 - 2 * t); // smoothstep
  }
}

function getPixi() {
  return globalThis.PIXI ?? foundry?.canvas?.PIXI ?? null;
}

function ensureBlurFilter() {
  const PIXI = getPixi();
  if (!PIXI?.filters?.BlurFilter) throw new Error("[FX Bus] PIXI BlurFilter not available");

  const stage = globalThis.canvas?.stage;
  if (!stage) throw new Error("[FX Bus] canvas.stage not available");

  const filters = Array.isArray(stage.filters) ? stage.filters : [];
  let f = filters.find((x) => x?.__fxbusId === FX_ID);

  if (!f) {
    f = new PIXI.filters.BlurFilter(0);
    f.__fxbusId = FX_ID;
    stage.filters = [...filters, f];
  }

  return { stage, filter: f };
}

function removeBlurFilter() {
  const stage = globalThis.canvas?.stage;
  if (!stage) return;

  const filters = Array.isArray(stage.filters) ? stage.filters : [];
  const next = filters.filter((x) => x?.__fxbusId !== FX_ID);
  stage.filters = next.length ? next : null;
}

function computeStrength(params, elapsedSec) {
  const base = clamp(params.strength, 0, 100);
  const f = clamp(params.freqHz, 0, 60);

  if (f <= 0) return base;

  const lo = clamp(params.minStrength, 0, 100);
  const hi = clamp(params.maxStrength, 0, 100);
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  const phase = elapsedSec * f * Math.PI * 2;
  const wave01 = (Math.sin(phase) + 1) * 0.5;

  return a + (b - a) * wave01;
}

function registerRuntimeHandler(runtime, action, fn) {
  if (!runtime) return false;

  if (typeof runtime.register === "function") {
    runtime.register(action, fn);
    return true;
  }

  if (typeof runtime.on === "function") {
    runtime.on(action, fn);
    return true;
  }

  if (typeof runtime.addHandler === "function") {
    runtime.addHandler(action, fn);
    return true;
  }

  if (typeof runtime.handle === "function") {
    runtime.handle(action, fn);
    return true;
  }

  if (runtime.handlers && typeof runtime.handlers.set === "function") {
    runtime.handlers.set(action, fn);
    return true;
  }

  if (runtime._handlers && typeof runtime._handlers.set === "function") {
    runtime._handlers.set(action, fn);
    return true;
  }

  console.warn("[FX Bus] Cannot register handler; runtime API not recognised", { action, runtime });
  return false;
}

export function registerScreenBlurFx(runtime) {
  // Ensure runtime has the tickers map expected by the enforced ticker utility.
  if (!runtime.tickers) runtime.tickers = new Map();

  const state = {
    active: false,
    elapsedMs: 0,
    durationMs: 0,
    params: null,
    filter: null
  };

  function stop() {
    state.active = false;

    try {
      cleanupTicker(runtime, FX_ID);
    } catch {
      // ignore
    }

    try {
      if (state.filter) state.filter.blur = 0;
    } catch {
      // ignore
    }

    state.filter = null;
    state.params = null;
    state.elapsedMs = 0;
    state.durationMs = 0;

    removeBlurFilter();
  }

  function start(payload = {}) {
    const durationMs = clamp(payload.durationMs ?? 0, 0, 600000);

    const params = {
      strength: clamp(payload.strength ?? 6, 0, 100),
      quality: clamp(payload.quality ?? 4, 1, 8),
      ease: String(payload.ease ?? "inOut"),
      freqHz: clamp(payload.freqHz ?? 0, 0, 60),
      minStrength: clamp(payload.minStrength ?? 0, 0, 100),
      maxStrength: clamp(payload.maxStrength ?? (payload.strength ?? 6), 0, 100)
    };

    let filter;
    try {
      ({ filter } = ensureBlurFilter());
    } catch (err) {
      console.error("[FX Bus] screenBlur ensure filter failed", err);
      return;
    }

    try {
      filter.quality = params.quality;
    } catch {
      // ignore
    }

    state.active = true;
    state.elapsedMs = 0;
    state.durationMs = durationMs;
    state.params = params;
    state.filter = filter;

    try {
      // Replace any prior ticker wrapper for this effect name.
      cleanupTicker(runtime, FX_ID);
    } catch {
      // ignore
    }

    try {
      ensureTicker(runtime, FX_ID, (deltaMS) => {
        if (!state.active || !state.filter || !state.params) return;

        state.elapsedMs += clamp(deltaMS, 0, 250); // clamp to avoid huge jumps on tab-switch/focus
        const elapsedMs = state.elapsedMs;
        const elapsedSec = elapsedMs / 1000;

        let env = 1;
        if (state.durationMs > 0) {
          const t01 = elapsedMs / state.durationMs;
          if (t01 >= 1) {
            stop();
            return;
          }
          env = easeValue(state.params.ease, t01);
        }

        const s = computeStrength(state.params, elapsedSec) * env;

        try {
          state.filter.blur = s;
        } catch (err) {
          console.error("[FX Bus] screenBlur tick failed", err);
          stop();
        }
      });
    } catch (err) {
      console.error("[FX Bus] screenBlur ensureTicker failed", err);
      stop();
    }
  }

  registerRuntimeHandler(runtime, "fx.screenBlur.start", start);
  registerRuntimeHandler(runtime, "fx.screenBlur.stop", stop);
}
