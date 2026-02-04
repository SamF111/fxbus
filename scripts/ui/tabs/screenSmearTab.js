// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\screenSmearTab.js

/**
 * FX Bus - Screen Smear Tab (Foundry v13+ ApplicationV2)
 *
 * Purpose:
 * - Screen-space motion smear / trailing ghost effect.
 * - No mode selector: Apply = start/update, Stop = stop.
 *
 * Notes:
 * - wire() is scoped to this tab panel only (prevents cross-tab collisions).
 * - Duration = 0 runs until stopped.
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply.
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "smear";

export function screenSmearTabDef() {
  return {
    id: TAB_ID,
    label: "Smear",

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
      if (!panel) throw new Error("ScreenSmear: panel not found");

      const until = panel.querySelector('input[name="smearUntilStopped"]');
      const dur = panel.querySelector('input[name="smearDurationMs"]');
      const durationMs = until?.checked ? 0 : num(dur?.value, 900);

      return {
        action: "fx.screenSmear.start",

        strength: num(panel.querySelector('input[name="smearStrength"]')?.value, 0.55),
        persistence: num(
          panel.querySelector('input[name="smearPersistence"]')?.value,
          0.85
        ),
        cameraWeighted: Boolean(
          panel.querySelector('input[name="smearCameraWeighted"]')?.checked
        ),
        jitterPx: num(panel.querySelector('input[name="smearJitterPx"]')?.value, 0),
        maxStepPx: num(panel.querySelector('input[name="smearMaxStepPx"]')?.value, 40),

        ease: String(panel.querySelector('select[name="smearEase"]')?.value ?? "inOut"),

        freqHz: num(panel.querySelector('input[name="smearFreqHz"]')?.value, 0),
        minStrength: num(
          panel.querySelector('input[name="smearMinStrength"]')?.value,
          0
        ),
        maxStrength: num(
          panel.querySelector('input[name="smearMaxStrength"]')?.value,
          0.55
        ),

        durationMs
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const until = panel.querySelector('input[name="smearUntilStopped"]');
      const dur = panel.querySelector('input[name="smearDurationMs"]');

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
        runtime.emit({ action: "fx.screenSmear.stop" });
      }

      function apply() {
        runtime.emit(this.buildApplyPayload(root, runtime));
      }

      panel
        .querySelector('button[type="button"][data-do="smearApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });

      panel
        .querySelector('button[type="button"][data-do="smearStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });
    }
  };
}
