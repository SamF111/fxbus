/**
 * FX Bus - Screen Shake Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/stop). Buttons already express intent.
 * - Apply always starts a new shake (duration 0 if "until stopped").
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "shake";
const TEMPLATE_PATH = "modules/fxbus/templates/tabs/screenShakeTab.hbs";

export function screenShakeTabDef() {
  return {
    id: TAB_ID,
    label: "Screen Shake",

    async contentHtml() {
      return await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, {});
    },

    wire(root, runtime) {
      const panel = root.querySelector(`.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`);
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
        const durationMs = until?.checked ? 0 : num(dur?.value, 600);

        runtime.emit({
          action: "fx.screenShake.start",
          intensityPx: num(panel.querySelector('input[name="shakeIntensityPx"]')?.value, 12),
          durationMs,
          freqHz: num(panel.querySelector('input[name="shakeFreqHz"]')?.value, 24)
        });
      }

      panel.querySelector('button[data-do="shakeStop"]')?.addEventListener("click", stop);
      panel.querySelector('button[data-do="shakeApply"]')?.addEventListener("click", apply);
    }
  };
}
