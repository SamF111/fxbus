// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs/screenVignetteTab.js

/**
 * FX Bus - Screen Vignette Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/stop). Buttons already express intent.
 * - Apply always starts (duration 0 if "until stopped").
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply.
 */

import { num, normaliseHex, setDisabled, syncColourPair } from "./shared/panelUtils.js";

const TAB_ID = "vignette";

export function screenVignetteTabDef() {
  return {
    id: TAB_ID,
    label: "Vignette",

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
      if (!panel) throw new Error("ScreenVignette: panel not found");

      const until = panel.querySelector('input[name="vigUntilStopped"]');
      const dur = panel.querySelector('input[name="vigDurationMs"]');
      const durationMs = until?.checked ? 0 : num(dur?.value, 1200);

      return {
        action: "fx.screenVignette.start",
        colour: normaliseHex(
          panel.querySelector('input[name="vigColour"]')?.value,
          "#000000"
        ),
        innerRadius: num(panel.querySelector('input[name="vigInnerRadius"]')?.value, 0.6),
        outerRadius: num(panel.querySelector('input[name="vigOuterRadius"]')?.value, 0.95),
        maxAlpha: num(panel.querySelector('input[name="vigMaxAlpha"]')?.value, 0.6),
        minAlpha: num(panel.querySelector('input[name="vigMinAlpha"]')?.value, 0),
        freqHz: num(panel.querySelector('input[name="vigFreqHz"]')?.value, 0),
        shape: String(panel.querySelector('select[name="vigShape"]')?.value ?? "sine"),
        durationMs,
        ease: String(panel.querySelector('select[name="vigEase"]')?.value ?? "inOut"),
        blendMode: String(
          panel.querySelector('select[name="vigBlendMode"]')?.value ?? "MULTIPLY"
        )
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      syncColourPair(panel, "vigColourPicker", "vigColour", "#000000");

      const until = panel.querySelector('input[name="vigUntilStopped"]');
      const dur = panel.querySelector('input[name="vigDurationMs"]');

      if (until && dur) {
        const sync = () => setDisabled(dur, Boolean(until.checked));
        until.addEventListener("change", sync);
        sync();
      }

      function stop() {
        runtime.emit({ action: "fx.screenVignette.stop" });
      }

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="vigStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });

      panel
        .querySelector('button[type="button"][data-do="vigApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });
    }
  };
}
