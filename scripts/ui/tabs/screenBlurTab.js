// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\screenBlurTab.js

/**
 * FX Bus - Screen Blur Tab (Foundry v13+ ApplicationV2)
 *
 * Purpose:
 * - Full-screen post-process blur (PIXI BlurFilter applied via FX bus)
 * - Supports static blur, pulsing blur, and envelope easing
 * - No mode selector: Apply = start/update, Stop = stop
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply.
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "blur";

export function screenBlurTabDef() {
  return {
    id: TAB_ID,
    label: "Blur",

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
      if (!panel) throw new Error("ScreenBlur: panel not found");

      const until = panel.querySelector('input[name="blurUntilStopped"]');
      const dur = panel.querySelector('input[name="blurDurationMs"]');
      const durationMs = until?.checked ? 0 : num(dur?.value, 800);

      // If pulsing is enabled (freqHz > 0), default min/max to sane values.
      const freqHz = num(panel.querySelector('input[name="blurFreqHz"]')?.value, 0);

      const strength = num(panel.querySelector('input[name="blurStrength"]')?.value, 6);

      const minStrength = num(
        panel.querySelector('input[name="blurMinStrength"]')?.value,
        0
      );

      const maxStrengthRaw = panel.querySelector('input[name="blurMaxStrength"]')?.value;
      const maxStrength = Number.isFinite(Number(maxStrengthRaw))
        ? num(maxStrengthRaw, strength)
        : strength;

      return {
        action: "fx.screenBlur.start",
        strength,
        quality: num(panel.querySelector('input[name="blurQuality"]')?.value, 4),
        freqHz,
        minStrength: freqHz > 0 ? minStrength : strength,
        maxStrength: freqHz > 0 ? maxStrength : strength,
        ease: String(panel.querySelector('select[name="blurEase"]')?.value ?? "inOut"),
        durationMs
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const until = panel.querySelector('input[name="blurUntilStopped"]');
      const dur = panel.querySelector('input[name="blurDurationMs"]');

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
        runtime.emit({ action: "fx.screenBlur.stop" });
      }

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="blurApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });

      panel
        .querySelector('button[type="button"][data-do="blurStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });
    }
  };
}
