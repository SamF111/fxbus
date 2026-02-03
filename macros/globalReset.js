/**
 * FX Bus - Global Reset (GM Macro)
 *
 * Purpose:
 * - Emergency kill switch for all FX Bus effects.
 * - Stops all active effects on all clients.
 * - Restores all token and screen transforms to their original state.
 *
 * Usage:
 * - Run as GM only.
 * - Safe to execute at any time.
 *
 * Action dispatched:
 * - fx.bus.reset
 */

(() => {
  // GM-only safety check
  if (!game.user.isGM) return;

  // Ensure FX Bus runtime exists
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) {
    ui.notifications.error("FX Bus runtime not available.");
    return;
  }

  // Emit global reset
  runtime.emit({ action: "fx.bus.reset" });

  // Optional local confirmation
  ui.notifications.info("FX Bus: all effects reset.");
})();
