/**
 * FX Bus - Token Oscillation Tab
 */

import { num, selectedTokenIds } from "./shared/panelUtils.js";

export function tokenOscTabDef() {
  return {
    id: "osc",
    label: "Token Osc",
    contentHtml: () => `
      <section class="fxbus-panel-section is-active" data-panel="osc">
        <p class="fxbus-muted">Requires selected tokens. Start can also be used as update if already running.</p>

        <div class="form-group">
          <label>Mode</label>
          <select name="oscMode">
            <option value="start" selected>Start</option>
            <option value="update">Update</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Roll (deg)</label>
            <input type="number" name="oscRollDeg" value="3" step="0.1"/>
          </div>
          <div class="form-group">
            <label>Frequency (Hz)</label>
            <input type="number" name="oscFreqHz" value="0.7" step="0.1" min="0.01" max="10"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Bob (px)</label>
            <input type="number" name="oscBobPx" value="2" step="0.1"/>
          </div>
          <div class="form-group">
            <label>Sway (px)</label>
            <input type="number" name="oscSwayPx" value="1" step="0.1"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Noise (0-0.5)</label>
            <input type="number" name="oscNoise" value="0" step="0.05" min="0" max="0.5"/>
          </div>
          <div class="form-group">
            <label class="fxbus-inline" style="margin-top:22px;">
              <input type="checkbox" name="oscRandomPhase" checked/>
              Random phase per token
            </label>
          </div>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="oscApply">Apply</button>
          <button type="button" class="fxbus-do fxbus-smallbtn" data-do="oscStop">Stop</button>
        </div>
      </section>
    `,
    wire(root, runtime) {
      function applyStop() {
        const tokenIds = selectedTokenIds();
        if (tokenIds.length === 0) {
          ui.notifications.warn("Select one or more tokens for Token Oscillation.");
          return;
        }
        runtime.emit({ action: "fx.tokenOsc.stop", tokenIds });
      }

      function applyStartOrUpdate() {
        const tokenIds = selectedTokenIds();
        if (tokenIds.length === 0) {
          ui.notifications.warn("Select one or more tokens for Token Oscillation.");
          return;
        }

        const mode = String(root.querySelector('select[name="oscMode"]')?.value ?? "start");
        if (mode === "stop") {
          applyStop();
          return;
        }

        const action = mode === "update" ? "fx.tokenOsc.update" : "fx.tokenOsc.start";

        runtime.emit({
          action,
          tokenIds,
          rollDeg: num(root.querySelector('input[name="oscRollDeg"]')?.value, 3),
          bobPx: num(root.querySelector('input[name="oscBobPx"]')?.value, 2),
          swayPx: num(root.querySelector('input[name="oscSwayPx"]')?.value, 1),
          freqHz: num(root.querySelector('input[name="oscFreqHz"]')?.value, 0.7),
          noise: num(root.querySelector('input[name="oscNoise"]')?.value, 0),
          randomPhase: !!root.querySelector('input[name="oscRandomPhase"]')?.checked
        });
      }

      root.querySelector('button[data-do="oscStop"]')?.addEventListener("click", applyStop);
      root.querySelector('button[data-do="oscApply"]')?.addEventListener("click", applyStartOrUpdate);
    }
  };
}
