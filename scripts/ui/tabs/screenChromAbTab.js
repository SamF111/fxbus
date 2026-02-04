// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs/screenChromAbTab.js

/**
 * FX Bus - Chromatic Aberration Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/stop). Buttons already express intent.
 * - Apply always starts/updates (duration 0 if "until stopped").
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply.
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "chromab";

export function screenChromAbTabDef() {
  return {
    id: TAB_ID,
    label: "Chrom Ab",

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
      if (!panel) throw new Error("ChromAb: panel not found");

      const until = panel.querySelector('input[name="chromAbUntilStopped"]');
      const dur = panel.querySelector('input[name="chromAbDurationMs"]');
      const durationMs = until?.checked ? 0 : num(dur?.value, 0);

      const amountPx = num(
        panel.querySelector('input[name="chromAbAmountPx"]')?.value,
        1.2
      );
      const minAmountPx = num(
        panel.querySelector('input[name="chromAbMinAmountPx"]')?.value,
        amountPx
      );
      const maxAmountPx = num(
        panel.querySelector('input[name="chromAbMaxAmountPx"]')?.value,
        amountPx
      );

      return {
        action: "fx.chromAb.start",
        amountPx,
        angleDeg: num(panel.querySelector('input[name="chromAbAngleDeg"]')?.value, 0),

        durationMs,
        ease: String(panel.querySelector('select[name="chromAbEase"]')?.value ?? "inOut"),

        freqHz: num(panel.querySelector('input[name="chromAbFreqHz"]')?.value, 0),
        shape: String(panel.querySelector('select[name="chromAbShape"]')?.value ?? "sine"),
        minAmountPx,
        maxAmountPx,

        rotateDegPerSec: num(
          panel.querySelector('input[name="chromAbRotateDegPerSec"]')?.value,
          0
        )
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const until = panel.querySelector('input[name="chromAbUntilStopped"]');
      const dur = panel.querySelector('input[name="chromAbDurationMs"]');

      if (until && dur) {
        const sync = () => {
          const on = Boolean(until.checked);
          setDisabled(dur, on);
          if (on) dur.value = "0";
        };
        until.addEventListener("change", sync);
        sync();
      }

      function stop() {
        runtime.emit({ action: "fx.chromAb.stop" });
      }

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="chromAbStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });

      panel
        .querySelector('button[type="button"][data-do="chromAbApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });
    }
  };
}
