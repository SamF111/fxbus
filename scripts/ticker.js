/**
 * FX Bus (Foundry VTT v12+)
 * Shared ticker management utilities.
 *
 * Design:
 * - Exactly one canvas.app.ticker callback per effect type.
 * - If an effect is "re-started" or "updated", its ticker callback is replaced to avoid stale closures.
 * - Any uncaught error inside an effect tick forcibly removes that effect ticker to prevent hard lock states.
 * - Delta time derived from ticker.deltaMS for deterministic motion.
 */

function getTicker() {
  if (!canvas?.app?.ticker) {
    throw new Error("[FX Bus] canvas.app.ticker unavailable.");
  }
  return canvas.app.ticker;
}

/**
 * Ensure a ticker exists for an effect.
 *
 * Behaviour:
 * - If a ticker already exists for effectName, it is replaced (remove old, add new).
 * - The wrapped tick runs inside a try/catch. On error, the ticker is removed to prevent the
 *   effect from continuing to clobber transforms and breaking interaction until reload.
 *
 * @param {object} runtime
 * @param {string} effectName
 * @param {(deltaMS:number)=>void} tickFn
 */
export function ensureTicker(runtime, effectName, tickFn) {
  /**
   * Always replace existing ticker for this effectName.
   * This avoids subtle bugs where an earlier closure keeps running after a "Start / Update".
   */
  const ticker = getTicker();

  const prev = runtime.tickers.get(effectName);
  if (prev) {
    try {
      ticker.remove(prev);
    } catch {
      // ignore
    }
    runtime.tickers.delete(effectName);
  }

  const wrapped = (delta) => {
    /**
     * PIXI ticker passes a delta scalar (frames at 60 fps) as `delta`.
     * Foundry exposes deterministic deltaMS on the ticker instance.
     */
    const deltaMS = ticker.deltaMS ?? (Number(delta) * (1000 / 60));

    try {
      tickFn(deltaMS);
    } catch (err) {
      console.error(`[FX Bus] ${effectName} tick failed; disabling ticker to prevent lock-up.`, err);
      cleanupTicker(runtime, effectName);
    }
  };

  runtime.tickers.set(effectName, wrapped);
  ticker.add(wrapped);
}

/**
 * Remove a ticker for an effect.
 *
 * @param {object} runtime
 * @param {string} effectName
 */
export function cleanupTicker(runtime, effectName) {
  /**
   * Remove is idempotent:
   * - If the wrapped fn is absent, no action.
   * - Safe to call from inside a failing tick.
   */
  const wrapped = runtime.tickers.get(effectName);
  if (!wrapped) return;

  const ticker = getTicker();

  try {
    ticker.remove(wrapped);
  } catch {
    // ignore
  }

  runtime.tickers.delete(effectName);
}
