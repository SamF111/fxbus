// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\canvasMirrorTab.js

/**
 * FX Bus - Canvas Mirror Tab
 *
 * Purpose:
 * - Wire the Canvas Mirror GM panel controls.
 * - Build FX Bus socket payloads for Apply and Copy to Macro.
 * - Keep this effect canvas-only with no token or tile selection layer.
 *
 * Actions:
 * - fx.canvasMirror.start
 * - fx.canvasMirror.stop
 *
 * Axis:
 * - x: horizontal mirror, left/right reversed.
 * - y: vertical mirror, up/down reversed.
 * - xy: both axes, equivalent to a 180-degree visual inversion.
 *
 * Transition:
 * - instant: immediately applies the mirrored canvas state.
 * - fold: CSS fold before applying the final mirror.
 * - realityRipple: squash/stretch ripple before applying the final mirror.
 * - glitchSnap: digital phase-tear displacement before snapping into the final mirror.
 *
 * Interaction:
 * - The GUI always uses remapped interaction.
 * - Interaction mode is deliberately not exposed in the GM panel.
 * - visualOnly and lock remain internal/debug payload options only if supported
 *   by the effect implementation.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import { num } from "./shared/panelUtils.js";

const TAB_ID = "canvasMirror";

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

function normaliseAxis(axis) {
  const value = String(axis ?? "").trim().toLowerCase();

  if (value === "horizontal") return "x";
  if (value === "vertical") return "y";
  if (value === "both") return "xy";

  if (value === "x") return "x";
  if (value === "y") return "y";
  if (value === "xy") return "xy";

  return "x";
}

function normaliseTransition(transition) {
  const value = String(transition ?? "").trim().toLowerCase();

  if (value === "instant") return "instant";
  if (value === "fold") return "fold";

  if (value === "realityripple") return "realityRipple";
  if (value === "reality-ripple") return "realityRipple";
  if (value === "reality_ripple") return "realityRipple";
  if (value === "ripple") return "realityRipple";

  if (value === "glitchsnap") return "glitchSnap";
  if (value === "glitch-snap") return "glitchSnap";
  if (value === "glitch_snap") return "glitchSnap";
  if (value === "glitch") return "glitchSnap";

  return "instant";
}

function defaultTransitionMs(transition) {
  if (transition === "fold") return 350;
  if (transition === "realityRipple") return 700;
  if (transition === "glitchSnap") return 650;
  return 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function canvasMirrorTabDef() {
  return {
    id: TAB_ID,
    label: "Canvas Mirror",
    selectionLayer: null,
    macroName: "FX Bus - Canvas Mirror",

    /**
     * Build the socket payload for Apply and Copy to Macro.
     *
     * @param {HTMLElement} root
     * @param {object} _runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      const panel = getPanel(root);
      if (!panel) throw new Error("CanvasMirror: panel not found");

      const transition = normaliseTransition(
        stringFromSelect(panel, "canvasMirrorTransition", "instant")
      );

      const transitionMs = clamp(
        numberFromInput(
          panel,
          "canvasMirrorTransitionMs",
          defaultTransitionMs(transition)
        ),
        0,
        5000
      );

      return {
        action: "fx.canvasMirror.start",
        axis: normaliseAxis(
          stringFromSelect(panel, "canvasMirrorAxis", "x")
        ),
        interactionMode: "remap",
        transition,
        transitionMs
      };
    },

    wire(root, runtime, signal) {
      const panel = getPanel(root);
      if (!panel) return;

      const transitionSelect = panel.querySelector('select[name="canvasMirrorTransition"]');
      const transitionMsInput = panel.querySelector('input[name="canvasMirrorTransitionMs"]');

      const syncTransitionMs = () => {
        /**
         * Large comment:
         * Keep the transition duration field useful without hiding it.
         *
         * Instant mode does not need a duration, so the field is disabled and set
         * to zero. Fold, Reality Ripple, and Glitch Snap restore their sensible
         * defaults if the current value is empty or zero.
         */
        if (!transitionSelect || !transitionMsInput) return;

        const transition = normaliseTransition(transitionSelect.value);
        const isInstant = transition === "instant";

        transitionMsInput.disabled = isInstant;
        transitionMsInput.style.opacity = isInstant ? "0.6" : "1";

        if (isInstant) {
          transitionMsInput.value = "0";
          return;
        }

        const current = Number(transitionMsInput.value);
        if (!Number.isFinite(current) || current <= 0) {
          transitionMsInput.value = String(defaultTransitionMs(transition));
        }
      };

      const start = () => {
        runtime.emit(this.buildApplyPayload(root, runtime));
      };

      const stop = () => {
        runtime.emit({
          action: "fx.canvasMirror.stop"
        });
      };

      transitionSelect?.addEventListener(
        "change",
        () => {
          syncTransitionMs();
        },
        { signal }
      );

      syncTransitionMs();

      panel
        .querySelector('button[type="button"][data-action="canvasMirrorStart"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            start();
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="canvasMirrorStop"]')
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