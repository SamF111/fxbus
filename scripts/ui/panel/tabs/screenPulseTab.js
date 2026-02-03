/**
 * FX Bus - Screen Pulse Tab
 */

import { num, normaliseHex, setDisabled, syncColourPair } from "../shared/panelUtils.js";

export function screenPulseTabDef() {
  return {
    id: "pulse",
    label: "Screen Pulse",
    contentHtml: () => `
      <section class="fxbus-panel-section" data-panel="pulse">
        <p class="fxbus-muted">durationMs = 0 runs until stopped.</p>

        <div class="form-group">
          <label>Mode</label>
          <select name="pulseMode">
            <option value="start" selected>Start</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="form-group">
          <label>Colour</label>
          <div class="fxbus-inline">
            <input type="color" name="pulseColourPicker" value="#ff0000" style="width:48px; height:28px; padding:0;"/>
            <input type="text" name="pulseColour" value="#ff0000" style="flex:1;" />
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Min alpha (0-1)</label>
            <input type="number" name="pulseMinAlpha" value="0" step="0.05" min="0" max="1"/>
          </div>
          <div class="form-group">
            <label>Max alpha (0-1)</label>
            <input type="number" name="pulseMaxAlpha" value="0.35" step="0.05" min="0" max="1"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Frequency (Hz)</label>
            <input type="number" name="pulseFreqHz" value="2" step="0.1" min="0.1" max="30"/>
          </div>
          <div class="form-group">
            <label>Shape</label>
            <select name="pulseShape">
              <option value="sine" selected>Sine</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="fxbus-inline">
            <input type="checkbox" name="pulseUntilStopped"/>
            Run until stopped
          </label>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Duration (ms)</label>
            <input type="number" name="pulseDurationMs" value="1500" step="50" min="1" max="60000"/>
          </div>
          <div class="form-group">
            <label>Envelope</label>
            <select name="pulseEase">
              <option value="inOut" selected>In-out</option>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="linear">Linear</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>Blend mode</label>
          <select name="pulseBlendMode">
            <option value="SCREEN" selected>Screen</option>
            <option value="MULTIPLY">Multiply</option>
            <option value="ADD">Add</option>
            <option value="NORMAL">Normal</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="pulseApply">Apply</button>
          <button type="button" class="fxbus-do fxbus-smallbtn" data-do="pulseStop">Stop</button>
        </div>
      </section>
    `,
    wire(root, runtime) {
      syncColourPair(root, "pulseColourPicker", "pulseColour", "#ff0000");

      const until = root.querySelector('input[name="pulseUntilStopped"]');
      const dur = root.querySelector('input[name="pulseDurationMs"]');

      if (until && dur) {
        const apply = () => setDisabled(dur, until.checked);
        until.addEventListener("change", apply);
        apply();
      }

      function stop() {
        runtime.emit({ action: "fx.screenPulse.stop" });
      }

      function apply() {
        const mode = String(root.querySelector('select[name="pulseMode"]')?.value ?? "start");
        if (mode === "stop") {
          stop();
          return;
        }

        const untilStopped = !!until?.checked;
        const durationMs = untilStopped ? 0 : num(dur?.value, 1500);

        runtime.emit({
          action: "fx.screenPulse.start",
          colour: normaliseHex(root.querySelector('input[name="pulseColour"]')?.value ?? "#ff0000", "#ff0000"),
          durationMs,
          freqHz: num(root.querySelector('input[name="pulseFreqHz"]')?.value, 2),
          minAlpha: num(root.querySelector('input[name="pulseMinAlpha"]')?.value, 0),
          maxAlpha: num(root.querySelector('input[name="pulseMaxAlpha"]')?.value, 0.35),
          shape: String(root.querySelector('select[name="pulseShape"]')?.value ?? "sine"),
          ease: String(root.querySelector('select[name="pulseEase"]')?.value ?? "inOut"),
          blendMode: String(root.querySelector('select[name="pulseBlendMode"]')?.value ?? "SCREEN")
        });
      }

      root.querySelector('button[data-do="pulseStop"]')?.addEventListener("click", stop);
      root.querySelector('button[data-do="pulseApply"]')?.addEventListener("click", apply);
    }
  };
}
