/**
 * FX Bus - Screen Vignette Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/stop). Buttons already express intent.
 * - Apply always starts (duration 0 if "until stopped").
 */

import { num, normaliseHex, setDisabled, syncColourPair } from "./shared/panelUtils.js";

const TAB_ID = "vignette";
const TEMPLATE_PATH = "modules/fxbus/templates/tabs/screenVignetteTab.hbs";

export function screenVignetteTabDef() {
  return {
    id: TAB_ID,
    label: "Vignette",

    async contentHtml() {
      return await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, {});
    },

    wire(root, runtime) {
      const panel = root.querySelector(`.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`);
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
        const durationMs = until?.checked ? 0 : num(dur?.value, 1200);

        runtime.emit({
          action: "fx.screenVignette.start",
          colour: normaliseHex(panel.querySelector('input[name="vigColour"]')?.value, "#000000"),
          innerRadius: num(panel.querySelector('input[name="vigInnerRadius"]')?.value, 0.6),
          outerRadius: num(panel.querySelector('input[name="vigOuterRadius"]')?.value, 0.95),
          maxAlpha: num(panel.querySelector('input[name="vigMaxAlpha"]')?.value, 0.6),
          minAlpha: num(panel.querySelector('input[name="vigMinAlpha"]')?.value, 0),
          freqHz: num(panel.querySelector('input[name="vigFreqHz"]')?.value, 0),
          shape: String(panel.querySelector('select[name="vigShape"]')?.value ?? "sine"),
          durationMs,
          ease: String(panel.querySelector('select[name="vigEase"]')?.value ?? "inOut"),
          blendMode: String(panel.querySelector('select[name="vigBlendMode"]')?.value ?? "MULTIPLY")
        });
      }

      panel.querySelector('button[data-do="vigStop"]')?.addEventListener("click", stop);
      panel.querySelector('button[data-do="vigApply"]')?.addEventListener("click", apply);
    }
  };
}
