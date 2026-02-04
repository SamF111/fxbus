// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs/screenNoiseTab.js

/**
 * FX Bus - Screen Noise Tab (Foundry v13+ ApplicationV2)
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

const TAB_ID = "noise";

export function screenNoiseTabDef() {
  return {
    id: TAB_ID,
    label: "Noise",

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
      if (!panel) throw new Error("ScreenNoise: panel not found");

      const until = panel.querySelector('input[name="noiseUntilStopped"]');
      const dur = panel.querySelector('input[name="noiseDurationMs"]');
      const durationMs = until?.checked ? 0 : num(dur?.value, 0);

      return {
        action: "fx.noise.start",
        intensity: num(panel.querySelector('input[name="noiseIntensity"]')?.value, 0.25),
        alpha: num(panel.querySelector('input[name="noiseAlpha"]')?.value, 0.35),
        grainPx: num(panel.querySelector('input[name="noiseGrainPx"]')?.value, 2),
        fps: num(panel.querySelector('input[name="noiseFps"]')?.value, 20),
        monochrome: Boolean(panel.querySelector('input[name="noiseMonochrome"]')?.checked),
        durationMs
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const until = panel.querySelector('input[name="noiseUntilStopped"]');
      const dur = panel.querySelector('input[name="noiseDurationMs"]');

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
        runtime.emit({ action: "fx.noise.stop" });
      }

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="noiseStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });

      panel
        .querySelector('button[type="button"][data-do="noiseApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });
    }
  };
}
