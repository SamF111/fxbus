/**
 * FX Bus - Screen Shake Tab
 */

import { num, setDisabled } from "../shared/panelUtils.js";

export function screenShakeTabDef() {
  return {
    id: "shake",
    label: "Screen Shake",
    contentHtml: () => `
      <section class="fxbus-panel-section" data-panel="shake">
        <p class="fxbus-muted">durationMs = 0 runs until stopped.</p>

        <div class="form-group">
          <label>Mode</label>
          <select name="shakeMode">
            <option value="start" selected>Start</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="form-group">
          <label class="fxbus-inline">
            <input type="checkbox" name="shakeUntilStopped"/>
            Run until stopped
          </label>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Duration (ms)</label>
            <input type="number" name="shakeDurationMs" value="600" step="50" min="1" max="60000"/>
          </div>
          <div class="form-group">
            <label>Frequency (Hz)</label>
            <input type="number" name="shakeFreqHz" value="24" step="1" min="0.1" max="120"/>
          </div>
        </div>

        <div class="form-group">
          <label>Intensity (px)</label>
          <input type="number" name="shakeIntensityPx" value="12" step="1" min="0" max="500"/>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="shakeApply">Apply</button>
          <button type="button" class="fxbus-do fxbus-smallbtn" data-do="shakeStop">Stop</button>
        </div>
      </section>
    `,
    wire(root, runtime) {
      const until = root.querySelector('input[name="shakeUntilStopped"]');
      const dur = root.querySelector('input[name="shakeDurationMs"]');

      if (until && dur) {
        const apply = () => setDisabled(dur, until.checked);
        until.addEventListener("change", apply);
        apply();
      }

      function stop() {
        runtime.emit({ action: "fx.screenShake.stop" });
      }

      function apply() {
        const mode = String(root.querySelector('select[name="shakeMode"]')?.value ?? "start");
        if (mode === "stop") {
          stop();
          return;
        }

        const untilStopped = !!until?.checked;
        const durationMs = untilStopped ? 0 : num(dur?.value, 600);

        runtime.emit({
          action: "fx.screenShake.start",
          intensityPx: num(root.querySelector('input[name="shakeIntensityPx"]')?.value, 12),
          durationMs,
          freqHz: num(root.querySelector('input[name="shakeFreqHz"]')?.value, 24)
        });
      }

      root.querySelector('button[data-do="shakeStop"]')?.addEventListener("click", stop);
      root.querySelector('button[data-do="shakeApply"]')?.addEventListener("click", apply);
    }
  };
}
