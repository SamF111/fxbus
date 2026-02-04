/**
 * FX Bus - Screen Noise Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/stop). Buttons already express intent.
 * - Apply always starts/updates (duration 0 if "until stopped").
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "noise";
const TEMPLATE_PATH = "modules/fxbus/templates/tabs/screenNoiseTab.hbs";

export function screenNoiseTabDef() {
  return {
    id: TAB_ID,
    label: "Noise",

    async contentHtml() {
      return await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, {});
    },

    wire(root, runtime) {
      const panel = root.querySelector(`.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`);
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
        const durationMs = until?.checked ? 0 : num(dur?.value, 0);

        runtime.emit({
          action: "fx.noise.start",
          intensity: num(panel.querySelector('input[name="noiseIntensity"]')?.value, 0.25),
          alpha: num(panel.querySelector('input[name="noiseAlpha"]')?.value, 0.35),
          grainPx: num(panel.querySelector('input[name="noiseGrainPx"]')?.value, 2),
          fps: num(panel.querySelector('input[name="noiseFps"]')?.value, 20),
          monochrome: Boolean(panel.querySelector('input[name="noiseMonochrome"]')?.checked),
          durationMs
        });
      }

      panel.querySelector('button[data-do="noiseStop"]')?.addEventListener("click", stop);
      panel.querySelector('button[data-do="noiseApply"]')?.addEventListener("click", apply);
    }
  };
}
