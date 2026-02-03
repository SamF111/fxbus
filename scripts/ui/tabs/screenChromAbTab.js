/**
 * FX Bus - Chromatic Aberration Tab
 */

import { num, setDisabled } from "./shared/panelUtils.js";

export function screenChromAbTabDef() {
  return {
    id: "chromab",
    label: "Chrom Ab",
    contentHtml: () => `
      <section class="fxbus-panel-section" data-panel="chromab">
        <p class="fxbus-muted">RGB split. Set freqHz to 0 for static.</p>

        <div class="form-group">
          <label>Mode</label>
          <select name="chromAbMode">
            <option value="start" selected>Start / Update</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr class="fxbus-divider"/>

        <div class="form-group">
          <label class="fxbus-inline">
            <input type="checkbox" name="chromAbUntilStopped" checked/>
            Run until stopped
          </label>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Duration (ms)</label>
            <input type="number" name="chromAbDurationMs" value="0" step="50" min="0" max="600000"/>
          </div>
          <div class="form-group">
            <label>Envelope</label>
            <select name="chromAbEase">
              <option value="inOut" selected>In-out</option>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="linear">Linear</option>
            </select>
          </div>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Base amount (px)</label>
            <input type="number" name="chromAbAmountPx" value="1.2" step="0.1" min="0" max="30"/>
          </div>
          <div class="form-group">
            <label>Angle (deg)</label>
            <input type="number" name="chromAbAngleDeg" value="0" step="1"/>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>freqHz (0 = static)</label>
            <input type="number" name="chromAbFreqHz" value="0" step="0.1" min="0" max="30"/>
          </div>
          <div class="form-group">
            <label>Shape</label>
            <select name="chromAbShape">
              <option value="sine" selected>Sine</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>
        </div>

        <div class="fxbus-grid-2">
          <div class="form-group">
            <label>Min amount (px)</label>
            <input type="number" name="chromAbMinAmountPx" value="1.2" step="0.1" min="0" max="30"/>
          </div>
          <div class="form-group">
            <label>Max amount (px)</label>
            <input type="number" name="chromAbMaxAmountPx" value="1.2" step="0.1" min="0" max="30"/>
          </div>
        </div>

        <div class="form-group">
          <label>Rotate (deg/sec)</label>
          <input type="number" name="chromAbRotateDegPerSec" value="0" step="5" min="-720" max="720"/>
        </div>

        <hr class="fxbus-divider"/>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="chromAbApply">Apply</button>
          <button type="button" class="fxbus-do fxbus-smallbtn" data-do="chromAbStop">Stop</button>
        </div>
      </section>
    `,
    wire(root, runtime) {
      const until = root.querySelector('input[name="chromAbUntilStopped"]');
      const dur = root.querySelector('input[name="chromAbDurationMs"]');

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
        runtime.emit({ action: "fx.chromAb.stop" });
      }

      function apply() {
        const mode = String(root.querySelector('select[name="chromAbMode"]')?.value ?? "start");
        if (mode === "stop") {
          stop();
          return;
        }

        const durationMs = until?.checked ? 0 : num(dur?.value, 0);

        const amountPx = num(root.querySelector('input[name="chromAbAmountPx"]')?.value, 1.2);
        const minAmountPx = num(root.querySelector('input[name="chromAbMinAmountPx"]')?.value, amountPx);
        const maxAmountPx = num(root.querySelector('input[name="chromAbMaxAmountPx"]')?.value, amountPx);

        runtime.emit({
          action: "fx.chromAb.start",
          amountPx,
          angleDeg: num(root.querySelector('input[name="chromAbAngleDeg"]')?.value, 0),

          durationMs,
          ease: String(root.querySelector('select[name="chromAbEase"]')?.value ?? "inOut"),

          freqHz: num(root.querySelector('input[name="chromAbFreqHz"]')?.value, 0),
          shape: String(root.querySelector('select[name="chromAbShape"]')?.value ?? "sine"),
          minAmountPx,
          maxAmountPx,

          rotateDegPerSec: num(root.querySelector('input[name="chromAbRotateDegPerSec"]')?.value, 0)
        });
      }

      root.querySelector('button[data-do="chromAbStop"]')?.addEventListener("click", stop);
      root.querySelector('button[data-do="chromAbApply"]')?.addEventListener("click", apply);
    }
  };
}
