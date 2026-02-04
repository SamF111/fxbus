// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs/tokenOscTab.js

/**
 * FX Bus - Token Oscillation Tab (Foundry v13+ ApplicationV2)
 *
 * UI change:
 * - Removed Mode (start/update/stop). Buttons already express intent.
 * - "Apply" now chooses start vs update automatically.
 *
 * Behaviour:
 * - If any selected token is already oscillating -> emit update
 * - Else -> emit start
 * - Stop always emits stop
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply, including start vs update decision and current token selection.
 */

import { num, selectedTokenIds } from "./shared/panelUtils.js";

const TAB_ID = "osc";

function shouldUpdate(runtime, tokenIds) {
  const map = runtime?.tokenFx;
  if (!map) return false;
  for (const id of tokenIds) {
    if (map.has?.(id)) return true;
    if (map[id]) return true;
  }
  return false;
}

export function tokenOscTabDef() {
  return {
    id: TAB_ID,
    label: "Token Osc",

    /**
     * Build the socket payload for "Apply" / Copy-to-Macro.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @returns {object}
     */
    buildApplyPayload(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) throw new Error("TokenOsc: panel not found");

      const tokenIds = selectedTokenIds();
      if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
        throw new Error("TokenOsc: no tokens selected");
      }

      const params = {
        rollDeg: num(panel.querySelector('input[name="oscRollDeg"]')?.value, 3),
        bobPx: num(panel.querySelector('input[name="oscBobPx"]')?.value, 2),
        swayPx: num(panel.querySelector('input[name="oscSwayPx"]')?.value, 1),
        freqHz: num(panel.querySelector('input[name="oscFreqHz"]')?.value, 0.7),
        noise: num(panel.querySelector('input[name="oscNoise"]')?.value, 0),
        randomPhase: Boolean(panel.querySelector('input[name="oscRandomPhase"]')?.checked)
      };

      const action = shouldUpdate(runtime, tokenIds)
        ? "fx.tokenOsc.update"
        : "fx.tokenOsc.start";

      return {
        action,
        tokenIds,
        ...params
      };
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      function stop() {
        const tokenIds = selectedTokenIds();
        if (tokenIds.length === 0) {
          ui.notifications.warn("Select one or more tokens for Token Oscillation.");
          return;
        }
        runtime.emit({ action: "fx.tokenOsc.stop", tokenIds });
      }

      function apply() {
        try {
          runtime.emit(this.buildApplyPayload(root, runtime));
        } catch (err) {
          ui.notifications.warn("Select one or more tokens for Token Oscillation.");
          console.warn("[FX Bus] Token Osc apply failed", err);
        }
      }

      panel
        .querySelector('button[type="button"][data-do="oscStop"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stop();
        });

      panel
        .querySelector('button[type="button"][data-do="oscApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });
    }
  };
}
