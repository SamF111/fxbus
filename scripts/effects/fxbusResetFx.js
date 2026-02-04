// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\fxbusResetFx.js

/**
 * FX Bus - Global Reset FX
 *
 * Purpose:
 * - Stop ALL FX and restore visuals to the pre-FX baseline.
 *
 * Mechanism:
 * - Dispatch each effect's STOP action so that it can restore its own snapshots.
 * - Then hard-clean tickers and residual maps as a backstop.
 *
 * Assumptions:
 * - Token effects are stored in runtime.tokenFx as Map(effectName -> Map(tokenId -> state)).
 * - Screen effects are stored in runtime.screenFx as Map(effectName -> state).
 * - Each effect provides a stop handler registered on runtime.handlers for its stop action.
 * - Ticker utilities manage runtime.tickers as Map(effectName -> wrappedTickerFn) and must be removed via cleanupTicker().
 */

import { cleanupTicker } from "../ticker.js";

const ACTION_RESET = "fx.bus.reset";

// Canonical + legacy token osc stop names (support both; remove legacy later)
const TOKEN_OSC_STOP = "fx.tokenOsc.stop";
const TOKEN_OSC_STOP_LEGACY = "tokenOscStop";

// Screen stop actions
const SCREEN_SHAKE_STOP = "fx.screenShake.stop";
const SCREEN_PULSE_STOP = "fx.screenPulse.stop";
const SCREEN_VIGNETTE_STOP = "fx.screenVignette.stop";
const CHROM_AB_STOP = "fx.chromAb.stop";
const NOISE_STOP = "fx.noise.stop";
const SCREEN_BLUR_STOP = "fx.screenBlur.stop";
const SCREEN_SMEAR_STOP = "fx.screenSmear.stop";
const SCREEN_STREAK_STOP = "fx.screenStreak.stop";

export function registerFxbusResetFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] fxbusResetFx: invalid runtime.");
  runtime.handlers.set(ACTION_RESET, () => onReset(runtime));
}

function safeCallHandler(runtime, action, payload) {
  const fn = runtime.handlers.get(action);
  if (typeof fn !== "function") {
    console.warn("[FX Bus] reset: missing handler", { action });
    return;
  }
  try {
    fn(payload ?? { action });
  } catch (err) {
    console.error("[FX Bus] reset: handler threw", { action, err });
  }
}

function hasHandler(runtime, action) {
  return typeof runtime.handlers.get(action) === "function";
}

function collectAllTokenIds(runtime) {
  const ids = new Set();

  for (const fxMap of runtime.tokenFx.values()) {
    if (!(fxMap instanceof Map)) continue;
    for (const tokenId of fxMap.keys()) {
      if (typeof tokenId === "string" && tokenId.length > 0) ids.add(tokenId);
    }
  }

  return Array.from(ids);
}

function stopIfPresent(runtime, action, payload) {
  if (!hasHandler(runtime, action)) return;
  safeCallHandler(runtime, action, payload ?? { action });
}

function backstopTickerCleanup(runtime) {
  try {
    const names = Array.from(runtime.tickers.keys());
    for (const effectName of names) {
      cleanupTicker(runtime, effectName);
    }
  } catch (err) {
    console.warn("[FX Bus] reset: ticker cleanup issue", err);
  }
}

function onReset(runtime) {
  // 1) Token effects: stop with all tokenIds so transforms restore.
  const tokenIds = collectAllTokenIds(runtime);
  if (tokenIds.length > 0) {
    if (hasHandler(runtime, TOKEN_OSC_STOP)) {
      safeCallHandler(runtime, TOKEN_OSC_STOP, { action: TOKEN_OSC_STOP, tokenIds });
    } else if (hasHandler(runtime, TOKEN_OSC_STOP_LEGACY)) {
      safeCallHandler(runtime, TOKEN_OSC_STOP_LEGACY, { action: TOKEN_OSC_STOP_LEGACY, tokenIds });
    }
  }

  // 2) Screen effects: call each stop action so stage filters/offsets restore.
  stopIfPresent(runtime, SCREEN_SHAKE_STOP);
  stopIfPresent(runtime, SCREEN_PULSE_STOP);
  stopIfPresent(runtime, SCREEN_VIGNETTE_STOP);
  stopIfPresent(runtime, CHROM_AB_STOP);
  stopIfPresent(runtime, NOISE_STOP);
  stopIfPresent(runtime, SCREEN_BLUR_STOP);
  stopIfPresent(runtime, SCREEN_SMEAR_STOP);
  stopIfPresent(runtime, SCREEN_STREAK_STOP);

  // 3) Backstop cleanup: remove any remaining tickers and clear maps.
  backstopTickerCleanup(runtime);

  runtime.tokenFx.clear();
  runtime.screenFx.clear();

  console.log("[FX Bus] Global reset executed (restored).");
}
