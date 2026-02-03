/**
 * FX Bus - Screen Noise Tab
 */

import { num, setDisabled } from "./shared/panelUtils.js";

export function screenNoiseTabDef() {
  return {
    id: "noise",
    label: "Noise",
    contentHtml: () => `
      <section class="fxbus-panel-section" data-panel="noise">
        <p class="fxbus-muted">TV static overlay. durationMs = 0 runs until stopped.</p>

        <div class="form-group">
          <label>Mode</label>
          <select name="noiseMode">
            <option value="start" selected>Start / Update</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="form-group">
          <label class="fxbus-inline">
            <input type="checkbox" name="noiseUntilStopped" checked/>
            Run until stopped
          </label>
        </div>

        <div class="form-group">
          <label>Duration (ms)</label>
          <input type="number" name="noiseDurationMs" value="0" step="50" min="0" max="600000"/>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Intensity (0-1)</label>
            <input type="number" name="noiseIntensity" value="0.25" step="0.05" min="0" max="1"/>
          </div>
          <div class="form-group">
            <label>Alpha (0-1)</label>
            <input type="number" name="noiseAlpha" value="0.35" step="0.05" min="0" max="1"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Grain size (px)</label>
            <input type="number" name="noiseGrainPx" value="2" step="1" min="1" max="24"/>
          </div>
          <div class="form-group">
            <label>FPS</label>
            <input type="number" name="noiseFps" value="20" step="1" min="1" max="60"/>
          </div>
        </div>

        <div class="form-group">
          <label class="fxbus-inline">
            <input type="checkbox" name="noiseMonochrome" checked/>
            Monochrome
          </label>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="noiseApply">Apply</button>
          <button type="button" class="fxbus-do fxbus-smallbtn" data-do="noiseStop">Stop</button>
        </div>
      </section>
    `,
    wire(root, runtime) {
      const until = root.querySelector('input[name="noiseUntilStopped"]');
      const dur = root.querySelector('input[name="noiseDurationMs"]');

      if (until && dur) {
        const apply = () => {
          const on = !!until.checked;
          setDisabled(dur, on);
          if (on) dur.value = "0";
        };
        until.addEventListener("change", apply);
        apply();
      }

      function stop() {
        runtime.emit({ action: "fx.noise.stop" });
      }

      function apply() {
        const mode = String(root.querySelector('select[name="noiseMode"]')?.value ?? "start");
        if (mode === "stop") {
          stop();
          return;
        }

        const durationMs = until?.checked ? 0 : num(dur?.value, 0);

        runtime.emit({
          action: "fx.noise.start",
          intensity: num(root.querySelector('input[name="noiseIntensity"]')?.value, 0.25),
          alpha: num(root.querySelector('input[name="noiseAlpha"]')?.value, 0.35),
          grainPx: num(root.querySelector('input[name="noiseGrainPx"]')?.value, 2),
          fps: num(root.querySelector('input[name="noiseFps"]')?.value, 20),
          monochrome: !!root.querySelector('input[name="noiseMonochrome"]')?.checked,
          durationMs
        });
      }

      root.querySelector('button[data-do="noiseStop"]')?.addEventListener("click", stop);
      root.querySelector('button[data-do="noiseApply"]')?.addEventListener("click", apply);
    }
  };
}
