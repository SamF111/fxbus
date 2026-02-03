/**
 * FX Bus - Global Reset FX (Foundry VTT v12+)
 *
 * Purpose:
 * - Immediately stop all FX.
 * - Restore all token and stage transforms.
 * - Remove all active tickers.
 * - Remove any FX overlay display objects stored on runtime.
 *
 * Action:
 * - fx.bus.reset
 */

import { restoreTokenTransform, restoreStage } from "../utils.js";

function safeDestroyDisplayObject(obj) {
  if (!obj) return;
  try {
    if (obj.parent) obj.parent.removeChild(obj);
  } catch (_) {}
  try {
    const tex = obj.texture ?? null;
    obj.destroy?.({ children: true });
    try { tex?.destroy?.(true); } catch (_) {}
  } catch (_) {}
}

export function registerFxBusResetFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] fxbusResetFx: invalid runtime.");

  runtime.handlers.set("fx.bus.reset", () => {
    // Restore all token FX and clear state
    for (const fxMap of runtime.tokenFx.values()) {
      for (const state of fxMap.values()) {
        const token = canvas?.tokens?.get(state.tokenId);
        if (token && state.base) {
          try {
            restoreTokenTransform(token, state.base);
          } catch (_) {}
        }
      }
      fxMap.clear();
    }
    runtime.tokenFx.clear();

    // Restore stage for any screen FX states which captured it
    for (const state of runtime.screenFx.values()) {
      if (state?.base) {
        try {
          restoreStage(state.base);
        } catch (_) {}
      }
    }
    runtime.screenFx.clear();

    // Remove any known overlay objects stored on runtime
    safeDestroyDisplayObject(runtime.__screenPulseOverlay);
    runtime.__screenPulseOverlay = null;

    safeDestroyDisplayObject(runtime.__screenVignetteSprite);
    runtime.__screenVignetteSprite = null;

    // Remove all tickers
    for (const tickerFn of runtime.tickers.values()) {
      try {
        canvas?.app?.ticker?.remove(tickerFn);
      } catch (_) {}
    }
    runtime.tickers.clear();

    console.warn("[FX Bus] Global reset executed.");
  });
}
