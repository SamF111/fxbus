// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs/screenShakeTab.js

/**
 * FX Bus - Screen Shake Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/stop). Buttons already express intent.
 * - Apply always starts a new shake (duration 0 if "until stopped").
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply.
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "shake";

export function screenShakeTabDef() {
  return {
    id: TAB_ID,
    label: "Screen Shake",

    /**
     * Build the socket payload for "Apply" / Copy-to-Macro.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) throw new Error("ScreenShake: panel not found");

      const until = panel.querySelector('input[name="shakeUntilStopped"]');
      const dur = panel.querySelector('input[name="shakeDurationMs"]');
      const durationMs = until?.checked ? 0 : num(dur?.value, 600);

      return {
        action: "fx.screenShake.start",
        intensityPx: num(panel.querySelector('input[name="shakeIntensityPx"]')?.value, 12),
        durationMs,
        freqHz: num(panel.querySelector('input[name="shakeFreqHz"]')?.value, 24)
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const until = panel.querySelector('input[name="shakeUntilStopped"]');
      const dur = panel.querySelector('input[name="shakeDurationMs"]');

      if (until && dur) {
        const sync = () => setDisabled(dur, Boolean(until.checked));
        until.addEventListener("change", sync);
        sync();
      }

      function stop() {
        runtime.emit({ action: "fx.screenShake.stop" });
      }

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="shakeStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });

      panel
        .querySelector('button[type="button"][data-do="shakeApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });
    }
  };
}
