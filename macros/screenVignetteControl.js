/**
 * FX Bus - Screen Vignette Control (GM Macro)
 *
 * Purpose:
 * - GM-side controller for screen vignette FX.
 * - Uses runtime.emit() to apply locally and broadcast.
 *
 * Actions:
 * - fx.screenVignette.start
 * - fx.screenVignette.stop
 */

(() => {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  const ACTION_START = "fx.screenVignette.start";
  const ACTION_STOP = "fx.screenVignette.stop";

  function normaliseHex(value) {
    if (typeof value !== "string") return "#000000";
    const s = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    return "#000000";
  }

  const content = `
    <form class="fxbus-vignette-form">
      <div class="form-group">
        <label>Action</label>
        <select name="mode">
          <option value="start">Start</option>
          <option value="stop">Stop</option>
        </select>
      </div>

      <hr/>

      <div class="form-group">
        <label>Colour</label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="color" name="colourPicker" value="#000000" style="width:48px; height:28px; padding:0;"/>
          <input type="text" name="colour" value="#000000" style="flex:1;" />
        </div>
      </div>

      <div class="form-group">
        <label>Inner radius (0-1)</label>
        <input type="number" name="innerRadius" value="0.6" step="0.05" min="0" max="1"/>
      </div>

      <div class="form-group">
        <label>Outer radius (0-1)</label>
        <input type="number" name="outerRadius" value="0.95" step="0.05" min="0" max="1"/>
      </div>

      <hr/>

      <div class="form-group">
        <label>Max alpha (0-1)</label>
        <input type="number" name="maxAlpha" value="0.6" step="0.05" min="0" max="1"/>
      </div>

      <div class="form-group">
        <label>Min alpha (0-1)</label>
        <input type="number" name="minAlpha" value="0.0" step="0.05" min="0" max="1"/>
        <p class="notes">Used only when frequency is greater than 0.</p>
      </div>

      <div class="form-group">
        <label>Breathing frequency (Hz)</label>
        <input type="number" name="freqHz" value="0" step="0.1" min="0" max="30"/>
        <p class="notes">0 = static vignette.</p>
      </div>

      <div class="form-group">
        <label>Breathing shape</label>
        <select name="shape">
          <option value="sine">Sine</option>
          <option value="triangle">Triangle</option>
        </select>
      </div>

      <hr/>

      <div class="form-group">
        <label>
          <input type="checkbox" name="untilStopped"/>
          Run until stopped
        </label>
      </div>

      <div class="form-group">
        <label>Duration (ms)</label>
        <input type="number" name="durationMs" value="1200" step="50" min="1" max="60000"/>
      </div>

      <div class="form-group">
        <label>Envelope</label>
        <select name="ease">
          <option value="inOut">In-out</option>
          <option value="in">In</option>
          <option value="out">Out</option>
          <option value="linear">Linear</option>
        </select>
      </div>

      <div class="form-group">
        <label>Blend mode</label>
        <select name="blendMode">
          <option value="MULTIPLY">Multiply</option>
          <option value="SCREEN">Screen</option>
          <option value="ADD">Add</option>
          <option value="NORMAL">Normal</option>
        </select>
      </div>
    </form>
  `;

  const dlg = new Dialog(
    {
      title: "FX Bus: Screen Vignette",
      content,
      buttons: {
        ok: {
          label: "Apply",
          callback: (html) => {
            const form = html[0].querySelector("form.fxbus-vignette-form");
            const data = new FormData(form);

            const mode = String(data.get("mode"));

            if (mode === "stop") {
              runtime.emit({ action: ACTION_STOP });
              return;
            }

            const untilStopped = data.get("untilStopped") === "on";
            const durationMs = untilStopped ? 0 : Number(data.get("durationMs"));

            runtime.emit({
              action: ACTION_START,
              colour: normaliseHex(String(data.get("colour"))),
              innerRadius: Number(data.get("innerRadius")),
              outerRadius: Number(data.get("outerRadius")),
              maxAlpha: Number(data.get("maxAlpha")),
              minAlpha: Number(data.get("minAlpha")),
              freqHz: Number(data.get("freqHz")),
              shape: String(data.get("shape")),
              durationMs,
              ease: String(data.get("ease")),
              blendMode: String(data.get("blendMode"))
            });
          }
        }
      },
      default: "ok",
      render: (html) => {
        const root = html[0].querySelector("form.fxbus-vignette-form");
        if (!root) return;

        const picker = root.querySelector('input[name="colourPicker"]');
        const text = root.querySelector('input[name="colour"]');
        const until = root.querySelector('input[name="untilStopped"]');
        const duration = root.querySelector('input[name="durationMs"]');
        const freq = root.querySelector('input[name="freqHz"]');
        const minA = root.querySelector('input[name="minAlpha"]');
        const shape = root.querySelector('select[name="shape"]');

        if (picker && text) {
          const initial = normaliseHex(text.value);
          text.value = initial;
          picker.value = initial;

          picker.addEventListener("input", () => {
            text.value = picker.value;
          });

          text.addEventListener("input", () => {
            picker.value = normaliseHex(text.value);
          });
        }

        if (until && duration) {
          const applyDisabled = () => {
            duration.disabled = until.checked;
            duration.style.opacity = until.checked ? "0.6" : "1";
          };
          until.addEventListener("change", applyDisabled);
          applyDisabled();
        }

        // If freqHz == 0, breathing controls are irrelevant.
        if (freq && minA && shape) {
          const applyBreathingState = () => {
            const f = Number(freq.value);
            const enabled = Number.isFinite(f) && f > 0;
            minA.disabled = !enabled;
            shape.disabled = !enabled;
            minA.style.opacity = enabled ? "1" : "0.6";
            shape.style.opacity = enabled ? "1" : "0.6";
          };
          freq.addEventListener("input", applyBreathingState);
          applyBreathingState();
        }
      }
    },
    { width: 440 }
  );

  dlg.render(true);
})();
