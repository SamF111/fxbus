/**
 * FX Bus - Screen Pulse Tab (Foundry v13+ ApplicationV2)
 *
 * Fixes:
 * - Remove dead contentHtml/renderTemplate path: Option A renders via partial in fxbus-panel.hbs.
 * - Align button selectors with template (data-action="pulseStart"/"pulseStop").
 * - Add colour pair wiring (expects pulseColourPicker + pulseColour in the HBS).
 * - Emit parameters that actually exist in the HBS (no phantom fields).
 * - Remove "Test local".
 */

import { num, normaliseHex, setDisabled, syncColourPair } from "./shared/panelUtils.js";

const TAB_ID = "pulse";

export function screenPulseTabDef() {
  return {
    id: TAB_ID,
    label: "Screen Pulse",

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      // Colour picker + text field pair
      syncColourPair(panel, "pulseColourPicker", "pulseColour", "#ff0000");

      const until = panel.querySelector('input[name="pulseUntilStopped"]');
      const dur = panel.querySelector('input[name="pulseDurationMs"]');

      if (until && dur) {
        const sync = () => setDisabled(dur, Boolean(until.checked));
        until.addEventListener("change", sync);
        sync();
      }

      function stop() {
        runtime.emit({ action: "fx.screenPulse.stop" });
      }

      function start() {
        const durationMs = until?.checked ? 0 : num(dur?.value, 1500);

        runtime.emit({
          action: "fx.screenPulse.start",
          colour: normaliseHex(
            panel.querySelector('input[name="pulseColour"]')?.value,
            "#ff0000"
          ),
          durationMs,
          freqHz: num(panel.querySelector('input[name="pulseFreqHz"]')?.value, 2),
          minAlpha: num(panel.querySelector('input[name="pulseMinAlpha"]')?.value, 0),
          maxAlpha: num(panel.querySelector('input[name="pulseMaxAlpha"]')?.value, 0.35),
          intensity: num(panel.querySelector('input[name="pulseIntensity"]')?.value, 1.0),
          shape: String(panel.querySelector('select[name="pulseShape"]')?.value ?? "sine"),
          ease: String(panel.querySelector('select[name="pulseEase"]')?.value ?? "inOut"),
          blendMode: String(
            panel.querySelector('select[name="pulseBlendMode"]')?.value ?? "SCREEN"
          )
        });
      }

      panel
        .querySelector('button[type="button"][data-action="pulseStart"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          start();
        });

      panel
        .querySelector('button[type="button"][data-action="pulseStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });
    }
  };
}
