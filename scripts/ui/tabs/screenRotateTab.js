// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\screenRotateTab.js

/**
 * FX Bus - Screen Rotate Tab
 *
 * Purpose:
 * - Wire the Screen Rotate GM panel controls.
 * - Build FX Bus socket payloads for Apply and Copy to Macro.
 * - Keep this effect screen-only with no token or tile selection layer.
 *
 * Actions:
 * - fx.screenRotate.start
 * - fx.screenRotate.stop
 *
 * Modes:
 * - wobble: temporary disorientation, returns to baseline.
 * - wobbleHold: disorientation while settling at the new additive angle.
 * - ease: smooth additive rotation.
 * - spin: stronger smooth additive rotation.
 * - snap: immediate additive rotation.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import { num } from "./shared/panelUtils.js";

const TAB_ID = "rotate";

function boolFromCheckbox(panel, name, fallback = false) {
  const el = panel.querySelector(`input[name="${name}"]`);
  if (!el) return fallback;
  return Boolean(el.checked);
}

function stringFromSelect(panel, name, fallback) {
  const el = panel.querySelector(`select[name="${name}"]`);
  const value = String(el?.value ?? "").trim();
  return value.length ? value : fallback;
}

function numberFromInput(panel, name, fallback) {
  const el = panel.querySelector(`input[name="${name}"]`);
  return num(el?.value, fallback);
}

function getPanel(root) {
  return root.querySelector(`.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`);
}

function normaliseMode(mode) {
  const value = String(mode ?? "").trim();

  if (value === "wobbleHold") return "wobbleHold";
  if (value === "wobblehold") return "wobbleHold";
  if (value === "wobble-hold") return "wobbleHold";
  if (value === "wobble_hold") return "wobbleHold";

  if (value === "wobble") return "wobble";
  if (value === "ease") return "ease";
  if (value === "spin") return "spin";
  if (value === "snap") return "snap";

  return "wobble";
}

function shouldForceReturnWhenFinished(mode) {
  /**
   * Large comment:
   * Wobble is the temporary impulse mode, so it should return unless the user
   * deliberately unticks the return option.
   *
   * Wobble Hold is the opposite: it must finish at the new additive angle, so
   * it always sends returnWhenFinished false regardless of the checkbox state.
   */
  return mode === "wobbleHold";
}

export function screenRotateTabDef() {
  return {
    id: TAB_ID,
    label: "Screen Rotate",
    selectionLayer: null,
    macroName: "FX Bus - Screen Rotate",

    /**
     * Build the socket payload for Apply and Copy to Macro.
     *
     * @param {HTMLElement} root
     * @param {object} _runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      const panel = getPanel(root);
      if (!panel) throw new Error("ScreenRotate: panel not found");

      const mode = normaliseMode(
        stringFromSelect(panel, "rotateMode", "wobble")
      );

      const returnWhenFinished = shouldForceReturnWhenFinished(mode)
        ? false
        : boolFromCheckbox(panel, "rotateReturnWhenFinished", true);

      return {
        action: "fx.screenRotate.start",
        angleDeg: numberFromInput(panel, "rotateAngleDeg", 45),
        durationMs: numberFromInput(panel, "rotateDurationMs", 2500),
        mode,
        freqHz: numberFromInput(panel, "rotateFreqHz", 0.7),
        returnWhenFinished,
        holdWhenFinished: mode === "wobbleHold" ? true : !returnWhenFinished
      };
    },

    wire(root, runtime, signal) {
      const panel = getPanel(root);
      if (!panel) return;

      const modeSelect = panel.querySelector('select[name="rotateMode"]');
      const returnCheckbox = panel.querySelector('input[name="rotateReturnWhenFinished"]');

      const syncReturnCheckbox = () => {
        /**
         * Large comment:
         * Wobble Hold must land at the new angle. Disable the return checkbox in
         * that mode so the UI cannot express an invalid combination.
         */
        if (!modeSelect || !returnCheckbox) return;

        const mode = normaliseMode(modeSelect.value);
        const forcedHold = mode === "wobbleHold";

        returnCheckbox.disabled = forcedHold;
        returnCheckbox.style.opacity = forcedHold ? "0.6" : "1";

        if (forcedHold) {
          returnCheckbox.checked = false;
        }
      };

      const start = () => {
        runtime.emit(this.buildApplyPayload(root, runtime));
      };

      const stop = () => {
        runtime.emit({
          action: "fx.screenRotate.stop"
        });
      };

      modeSelect?.addEventListener(
        "change",
        () => {
          syncReturnCheckbox();
        },
        { signal }
      );

      syncReturnCheckbox();

      panel
        .querySelector('button[type="button"][data-action="rotateStart"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            start();
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="rotateStop"]')
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