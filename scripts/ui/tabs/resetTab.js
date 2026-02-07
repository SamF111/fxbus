// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs/resetTab.js

/**
 * FX Bus - Reset Tab (Foundry v13+ ApplicationV2)
 *
 * Purpose:
 * - Trigger a global reset (stop all FX and restore transforms) on all connected clients.
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Execute Reset.
 *
 * Conventions:
 * - Uses the shared panel-level "fxbusCopyToMacro" handler via data-action="fxbusCopyToMacro".
 * - Uses data-do for local button wiring, matching other tabs.
 */

const TAB_ID = "reset";

export function resetTabDef() {
  return {
    id: TAB_ID,
    label: "Reset",

    /**
     * Build the socket payload for "Execute Reset" / Copy-to-Macro.
     *
     * @param {HTMLElement} _root
     * @param {object} _runtime
     * @returns {object}
     */
    buildApplyPayload(_root, _runtime) {
      return { action: "fx.bus.reset" };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="resetApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });
    }
  };
}
