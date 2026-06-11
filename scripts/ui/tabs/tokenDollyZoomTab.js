// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tokenDollyZoomTab.js

/**
 * FX Bus - Token Dolly Zoom Tab (Foundry v13+ ApplicationV2)
 *
 * Behaviour:
 * - Apply starts Token Dolly Zoom.
 * - Stop stops Token Dolly Zoom.
 * - If one token is selected, the effect anchors on that token.
 * - If multiple tokens are selected, the effect anchors on their midpoint.
 * - If no token is selected, the effect falls back to screen centre.
 *
 * Selection-layer metadata:
 * - selectionLayer: "tokens" tells the GM panel to activate Foundry's native
 *   Token selector when this tab is opened or clicked.
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro
 *   action can work.
 * - Payload is identical to Apply.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import { num } from "./shared/panelUtils.js";

const TAB_ID = "tokenDollyZoom";

function checked(panel, name, fallback = false) {
  const el = panel.querySelector(`input[name="${name}"]`);
  if (!el) return fallback;
  return Boolean(el.checked);
}

function selectedValue(panel, name, fallback) {
  const el = panel.querySelector(`select[name="${name}"]`);
  const value = String(el?.value ?? "").trim();
  return value.length ? value : fallback;
}

function getPanel(root) {
  const panel = root.querySelector(
    `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
  );

  if (!panel) throw new Error("TokenDollyZoom: panel not found");

  return panel;
}

function getTokenDollyZoomParams(panel) {
  return {
    mode: selectedValue(panel, "tokenDollyZoomMode", "punchIn"),
    anchor: "selectedToken",

    zoom: num(panel.querySelector('input[name="tokenDollyZoomZoom"]')?.value, 0.55),
    durationMs: num(panel.querySelector('input[name="tokenDollyZoomDurationMs"]')?.value, 6500),

    rollDeg: num(panel.querySelector('input[name="tokenDollyZoomRollDeg"]')?.value, 0),
    wobble: num(panel.querySelector('input[name="tokenDollyZoomWobble"]')?.value, 0),
    driftPx: num(panel.querySelector('input[name="tokenDollyZoomDriftPx"]')?.value, 0),

    counterScaleAmount: num(
      panel.querySelector('input[name="tokenDollyZoomCounterScaleAmount"]')?.value,
      1.25
    ),

    snapPeakAt: num(
      panel.querySelector('input[name="tokenDollyZoomSnapPeakAt"]')?.value,
      0.45
    ),

    easing: selectedValue(panel, "tokenDollyZoomEasing", "easeInOutCubic"),
    cancelOnCanvasNavigation: checked(panel, "tokenDollyZoomCancelOnCanvasNavigation", true)
  };
}

function buildPayload(root) {
  const panel = getPanel(root);
  const params = getTokenDollyZoomParams(panel);

  return {
    action: "fx.tokenDollyZoom.start",
    ...params
  };
}

export function tokenDollyZoomTabDef() {
  return {
    id: TAB_ID,
    label: "Token Dolly Zoom",
    selectionLayer: "tokens",

    /**
     * Build the socket payload for "Apply" / Copy-to-Macro.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      return buildPayload(root);
    },

    wire(root, runtime, signal) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );

      if (!panel) return;

      const stop = () => {
        runtime.emit({
          action: "fx.tokenDollyZoom.stop",
          restore: true
        });
      };

      const apply = () => {
        try {
          runtime.emit(buildPayload(root));
        } catch (err) {
          ui.notifications.warn("FX Bus: failed to apply Token Dolly Zoom.");
          console.warn("[FX Bus] Token Dolly Zoom apply failed", err);
        }
      };

      panel
        .querySelector('button[type="button"][data-do="tokenDollyZoomStop"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            stop();
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-do="tokenDollyZoomApply"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            apply();
          },
          { signal }
        );
    }
  };
}