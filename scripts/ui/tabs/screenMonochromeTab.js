// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\screenMonochromeTab.js

/**
 * FX Bus - Screen Monochrome Tab (Foundry v13+ ApplicationV2)
 *
 * Controls a filter-based noir effect.
 *
 * Copy-to-macro support:
 * - buildApplyPayload(root, runtime) returns the exact socket payload.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import { num, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "monochrome";

export function screenMonochromeTabDef() {
  return {
    id: TAB_ID,
    label: "Monochrome",

    buildApplyPayload(root, _runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) throw new Error("ScreenMonochrome: panel not found");

      const until = panel.querySelector('input[name="monoUntilStopped"]');
      const dur = panel.querySelector('input[name="monoDurationMs"]');

      const durationMs = until?.checked ? 0 : num(dur?.value, 0);

      return {
        action: "fx.screenMonochrome.start",
        durationMs,
        fadeInMs: num(panel.querySelector('input[name="monoFadeInMs"]')?.value, 300),
        fadeOutMs: num(panel.querySelector('input[name="monoFadeOutMs"]')?.value, 300),
        contrast: num(panel.querySelector('input[name="monoContrast"]')?.value, 1.35),
        brightness: num(panel.querySelector('input[name="monoBrightness"]')?.value, 0.92),
        alpha: num(panel.querySelector('input[name="monoAlpha"]')?.value, 1.0)
      };
    },

    wire(root, runtime, signal) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const until = panel.querySelector('input[name="monoUntilStopped"]');
      const dur = panel.querySelector('input[name="monoDurationMs"]');

      const syncDuration = () => {
        if (until && dur) setDisabled(dur, Boolean(until.checked));
      };

      if (until && dur) {
        until.addEventListener("change", syncDuration, { signal });
        syncDuration();
      }

      const stop = () => {
        runtime.emit({ action: "fx.screenMonochrome.stop" });
      };

      const start = () => {
        runtime.emit(this.buildApplyPayload(root, runtime));
      };

      const update = () => {
        const payload = this.buildApplyPayload(root, runtime);
        payload.action = "fx.screenMonochrome.update";
        runtime.emit(payload);
      };

      panel
        .querySelector('button[type="button"][data-action="monoStart"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            start();
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="monoUpdate"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            update();
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="monoStop"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            stop();
          },
          { signal }
        );
    }
  };
}