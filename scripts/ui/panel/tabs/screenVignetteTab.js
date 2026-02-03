/**
 * FX Bus - Screen Vignette Tab
 */

import { num, normaliseHex, setDisabled, syncColourPair } from "../shared/panelUtils.js";

export function screenVignetteTabDef() {
  return {
    id: "vignette",
    label: "Vignette",
    contentHtml: () => `
      <section class="fxbus-panel-section" data-panel="vignette">
        <p class="fxbus-muted">Static when freqHz = 0. Breathing when freqHz &gt; 0.</p>

        <div class="form-group">
          <label>Mode</label>
          <select name="vigMode">
            <option value="start" selected>Start</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="form-group">
          <label>Colour</label>
          <div class="fxbus-inline">
            <input type="color" name="vigColourPicker" value="#000000" style="width:48px; height:28px; padding:0;"/>
            <input type="text" name="vigColour" value="#000000" style="flex:1;" />
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Inner radius (0-1)</label>
            <input type="number" name="vigInnerRadius" value="0.6" step="0.05" min="0" max="1"/>
          </div>
          <div class="form-group">
            <label>Outer radius (0-1)</label>
            <input type="number" name="vigOuterRadius" value="0.95" step="0.05" min="0" max="1"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Max alpha (0-1)</label>
            <input type="number" name="vigMaxAlpha" value="0.6" step="0.05" min="0" max="1"/>
          </div>
          <div class="form-group">
            <label>Min alpha (0-1)</label>
            <input type="number" name="vigMinAlpha" value="0.0" step="0.05" min="0" max="1"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Breathing frequency (Hz)</label>
            <input type="number" name="vigFreqHz" value="0" step="0.1" min="0" max="30"/>
          </div>
          <div class="form-group">
            <label>Breathing shape</label>
            <select name="vigShape">
              <option value="sine" selected>Sine</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="fxbus-inline">
            <input type="checkbox" name="vigUntilStopped"/>
            Run until stopped
          </label>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Duration (ms)</label>
            <input type="number" name="vigDurationMs" value="1200" step="50" min="1" max="60000"/>
          </div>
          <div class="form-group">
            <label>Envelope</label>
            <select name="vigEase">
              <option value="inOut" selected>In-out</option>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="linear">Linear</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label>Blend mode</label>
          <select name="vigBlendMode">
            <option value="MULTIPLY" selected>Multiply</option>
            <option value="SCREEN">Screen</option>
            <option value="ADD">Add</option>
            <option value="NORMAL">Normal</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="vigApply">Apply</button>
          <button type="button" class="fxbus-do fxbus-smallbtn" data-do="vigStop">Stop</button>
        </div>
      </section>
    `,
    wire(root, runtime) {
      syncColourPair(root, "vigColourPicker", "vigColour", "#000000");

      const until = root.querySelector('input[name="vigUntilStopped"]');
      const dur = root.querySelector('input[name="vigDurationMs"]');
      if (until && dur) {
        const apply = () => setDisabled(dur, until.checked);
        until.addEventListener("change", apply);
        apply();
      }

      function stop() {
        runtime.emit({ action: "fx.screenVignette.stop" });
      }

      function apply() {
        const mode = String(root.querySelector('select[name="vigMode"]')?.value ?? "start");
        if (mode === "stop") {
          stop();
          return;
        }

        const untilStopped = !!until?.checked;
        const durationMs = untilStopped ? 0 : num(dur?.value, 1200);

        runtime.emit({
          action: "fx.screenVignette.start",
          colour: normaliseHex(root.querySelector('input[name="vigColour"]')?.value ?? "#000000", "#000000"),
          innerRadius: num(root.querySelector('input[name="vigInnerRadius"]')?.value, 0.6),
          outerRadius: num(root.querySelector('input[name="vigOuterRadius"]')?.value, 0.95),
          maxAlpha: num(root.querySelector('input[name="vigMaxAlpha"]')?.value, 0.6),
          minAlpha: num(root.querySelector('input[name="vigMinAlpha"]')?.value, 0),
          freqHz: num(root.querySelector('input[name="vigFreqHz"]')?.value, 0),
          shape: String(root.querySelector('select[name="vigShape"]')?.value ?? "sine"),
          durationMs,
          ease: String(root.querySelector('select[name="vigEase"]')?.value ?? "inOut"),
          blendMode: String(root.querySelector('select[name="vigBlendMode"]')?.value ?? "MULTIPLY")
        });
      }

      root.querySelector('button[data-do="vigStop"]')?.addEventListener("click", stop);
      root.querySelector('button[data-do="vigApply"]')?.addEventListener("click", apply);
    }
  };
}
