// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\screenPulseTab.js

/**
 * FX Bus - Screen Pulse Tab (Foundry v13+ ApplicationV2)
 *
 * Fixes:
 * - Remove dead contentHtml/renderTemplate path: Option A renders via partial in fxbus-panel.hbs.
 * - Align button selectors with template (data-action="pulseStart"/"pulseStop").
 * - Add colour pair wiring (expects pulseColourPicker + pulseColour in the HBS).
 * - Emit parameters that actually exist in the HBS.
 * - Support pulse/static mode for the updated screenPulse effect.
 * - Force a default mode when persisted uiState contains an empty value.
 * - Remove "Test local".
 *
 * Copy-to-macro support:
 * - Adds buildApplyPayload(root, runtime) used by the GM panel.
 * - Payload is identical to the "Start" emission.
 */

import { num, normaliseHex, setDisabled, syncColourPair } from "./shared/panelUtils.js";

const TAB_ID = "pulse";

export function screenPulseTabDef() {
  return {
    id: TAB_ID,
    label: "Screen Pulse",

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
      if (!panel) throw new Error("ScreenPulse: panel not found");

      const until = panel.querySelector('input[name="pulseUntilStopped"]');
      const dur = panel.querySelector('input[name="pulseDurationMs"]');
      const modeEl = panel.querySelector('select[name="pulseMode"]');

      if (modeEl && !modeEl.value) {
        modeEl.value = "pulse";
      }

      const mode = String(modeEl?.value ?? "pulse").trim().toLowerCase();
      const durationMs = until?.checked ? 0 : num(dur?.value, 1500);

      return {
        action: "fx.screenPulse.start",
        colour: normaliseHex(
          panel.querySelector('input[name="pulseColour"]')?.value,
          "#ff0000"
        ),
        mode: mode === "static" ? "static" : "pulse",
        durationMs,
        alpha: num(panel.querySelector('input[name="pulseAlpha"]')?.value, 0.35),
        freqHz: num(panel.querySelector('input[name="pulseFreqHz"]')?.value, 2),
        minAlpha: num(panel.querySelector('input[name="pulseMinAlpha"]')?.value, 0),
        maxAlpha: num(panel.querySelector('input[name="pulseMaxAlpha"]')?.value, 0.35),
        shape: String(
          panel.querySelector('select[name="pulseShape"]')?.value ?? "sine"
        ),
        ease: String(
          panel.querySelector('select[name="pulseEase"]')?.value ?? "inOut"
        ),
        blendMode: String(
          panel.querySelector('select[name="pulseBlendMode"]')?.value ?? "SCREEN"
        )
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      // Colour picker + text field pair
      syncColourPair(panel, "pulseColourPicker", "pulseColour", "#ff0000");

      const until = panel.querySelector('input[name="pulseUntilStopped"]');
      const dur = panel.querySelector('input[name="pulseDurationMs"]');
      const mode = panel.querySelector('select[name="pulseMode"]');
      const alpha = panel.querySelector('input[name="pulseAlpha"]');
      const freqHz = panel.querySelector('input[name="pulseFreqHz"]');
      const minAlpha = panel.querySelector('input[name="pulseMinAlpha"]');
      const maxAlpha = panel.querySelector('input[name="pulseMaxAlpha"]');
      const shape = panel.querySelector('select[name="pulseShape"]');

      if (mode && !mode.value) {
        mode.value = "pulse";
      }

      const syncDuration = () => {
        if (until && dur) setDisabled(dur, Boolean(until.checked));
      };

      const syncMode = () => {
        const isStatic = String(mode?.value ?? "pulse").trim().toLowerCase() === "static";

        setDisabled(alpha, !isStatic);
        setDisabled(freqHz, isStatic);
        setDisabled(minAlpha, isStatic);
        setDisabled(maxAlpha, isStatic);
        setDisabled(shape, isStatic);
      };

      if (until && dur) {
        until.addEventListener("change", syncDuration);
        syncDuration();
      }

      if (mode) {
        mode.addEventListener("change", syncMode);
        syncMode();
      }

      function stop() {
        runtime.emit({ action: "fx.screenPulse.stop" });
      }

      function start() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-action="pulseStart"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          start.call(this);
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