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
 */

import { num, selectedTokenIds } from "./shared/panelUtils.js";

const TAB_ID = "osc";
const TEMPLATE_PATH = "modules/fxbus/templates/tabs/tokenOscTab.hbs";

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

    async contentHtml() {
      return await foundry.applications.handlebars.renderTemplate(TEMPLATE_PATH, {});
    },

    wire(root, runtime) {
      const panel = root.querySelector(`.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`);
      if (!panel) return;

      function readParams() {
        return {
          rollDeg: num(panel.querySelector('input[name="oscRollDeg"]')?.value, 3),
          bobPx: num(panel.querySelector('input[name="oscBobPx"]')?.value, 2),
          swayPx: num(panel.querySelector('input[name="oscSwayPx"]')?.value, 1),
          freqHz: num(panel.querySelector('input[name="oscFreqHz"]')?.value, 0.7),
          noise: num(panel.querySelector('input[name="oscNoise"]')?.value, 0),
          randomPhase: Boolean(panel.querySelector('input[name="oscRandomPhase"]')?.checked)
        };
      }

      function stop() {
        const tokenIds = selectedTokenIds();
        if (tokenIds.length === 0) {
          ui.notifications.warn("Select one or more tokens for Token Oscillation.");
          return;
        }
        runtime.emit({ action: "fx.tokenOsc.stop", tokenIds });
      }

      function apply() {
        const tokenIds = selectedTokenIds();
        if (tokenIds.length === 0) {
          ui.notifications.warn("Select one or more tokens for Token Oscillation.");
          return;
        }

        const action = shouldUpdate(runtime, tokenIds) ? "fx.tokenOsc.update" : "fx.tokenOsc.start";

        runtime.emit({
          action,
          tokenIds,
          ...readParams()
        });
      }

      panel.querySelector('button[data-do="oscStop"]')?.addEventListener("click", stop);
      panel.querySelector('button[data-do="oscApply"]')?.addEventListener("click", apply);
    }
  };
}
