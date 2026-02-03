/**
 * FX Bus (Foundry VTT v12+)
 * Shared ticker management utilities.
 *
 * Design:
 * - Exactly one canvas.app.ticker callback per effect type.
 * - Tickers self-remove when no active state remains.
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
 * @param {object} runtime
 * @param {string} effectName
 * @param {(deltaMS:number)=>void} tickFn
 */
export function ensureTicker(runtime, effectName, tickFn) {
  if (runtime.tickers.has(effectName)) return;

  const ticker = getTicker();

  const wrapped = (delta) => {
    const deltaMS = ticker.deltaMS ?? (delta * (1000 / 60));
    tickFn(deltaMS);
  };

  runtime.tickers.set(effectName, wrapped);
  ticker.add(wrapped);
}

/**
 * Remove a ticker if no state remains for that effect.
 *
 * @param {object} runtime
 * @param {string} effectName
 */
export function cleanupTicker(runtime, effectName) {
  const wrapped = runtime.tickers.get(effectName);
  if (!wrapped) return;

  const ticker = getTicker();
  ticker.remove(wrapped);
  runtime.tickers.delete(effectName);
}
