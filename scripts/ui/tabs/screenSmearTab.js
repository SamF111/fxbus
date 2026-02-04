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
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "smear";
const TEMPLATE_PATH = "modules/fxbus/templates/tabs/screenSmearTab.hbs";

export function screenSmearTabDef() {
  return {
    id: TAB_ID,
    label: "Smear",

    async contentHtml() {
      return await renderTemplate(TEMPLATE_PATH, {});
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
        const durationMs = until?.checked ? 0 : num(dur?.value, 900);

        runtime.emit({
          action: "fx.screenSmear.start",

          // Strength of the smear (0-1 recommended).
          strength: num(panel.querySelector('input[name="smearStrength"]')?.value, 0.55),

          // Persistence / decay (0-1). Higher = longer trails.
          persistence: num(panel.querySelector('input[name="smearPersistence"]')?.value, 0.85),

          // If true, smear responds more aggressively to camera movement.
          cameraWeighted: Boolean(panel.querySelector('input[name="smearCameraWeighted"]')?.checked),

          // Optional extra wobble to avoid perfectly stable ghosting.
          jitterPx: num(panel.querySelector('input[name="smearJitterPx"]')?.value, 0),

          // Limit per-frame step to prevent extreme streaking on low FPS / huge deltas.
          maxStepPx: num(panel.querySelector('input[name="smearMaxStepPx"]')?.value, 40),

          // Fade-in/out envelope for finite duration runs.
          ease: String(panel.querySelector('select[name="smearEase"]')?.value ?? "inOut"),

          // Pulse the smear amount (0 = static).
          freqHz: num(panel.querySelector('input[name="smearFreqHz"]')?.value, 0),
          minStrength: num(panel.querySelector('input[name="smearMinStrength"]')?.value, 0),
          maxStrength: num(panel.querySelector('input[name="smearMaxStrength"]')?.value, 0.55),

          durationMs
        });
      }

      panel
        .querySelector('button[data-do="smearApply"]')
        ?.addEventListener("click", apply);

      panel
        .querySelector('button[data-do="smearStop"]')
        ?.addEventListener("click", stop);
    }
  };
}
