/**
 * FX Bus - Screen Pulse Control (GM Macro)
 *
 * Purpose:
 * - GM-side controller for screen pulse FX.
 * - Uses runtime.emit() to apply locally and broadcast.
 *
 * Actions:
 * - fx.screenPulse.start
 * - fx.screenPulse.stop
 */

(() => {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  const ACTION_START = "fx.screenPulse.start";
  const ACTION_STOP = "fx.screenPulse.stop";

  function normaliseHex(value) {
    if (typeof value !== "string") return "#ff0000";
    const s = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    return "#ff0000";
  }

  const content = `
    <form class="fxbus-pulse-form">
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
          <input type="color" name="colourPicker" value="#ff0000" style="width:48px; height:28px; padding:0;"/>
          <input type="text" name="colour" value="#ff0000" style="flex:1;" />
        </div>
      </div>

      <div class="form-group">
        <label>
          <input type="checkbox" name="untilStopped"/>
          Run until stopped
        </label>
      </div>

      <div class="form-group">
        <label>Duration (ms)</label>
        <input type="number" name="durationMs" value="1500" step="50" min="1" max="60000"/>
      </div>

      <div class="form-group">
        <label>Pulse frequency (Hz)</label>
        <input type="number" name="freqHz" value="2" step="0.1" min="0.1" max="30"/>
      </div>

      <div class="form-group">
        <label>Min alpha (0-1)</label>
        <input type="number" name="minAlpha" value="0" step="0.05" min="0" max="1"/>
      </div>

      <div class="form-group">
        <label>Max alpha (0-1)</label>
        <input type="number" name="maxAlpha" value="0.35" step="0.05" min="0" max="1"/>
      </div>

      <div class="form-group">
        <label>Shape</label>
        <select name="shape">
          <option value="sine">Sine</option>
          <option value="triangle">Triangle</option>
        </select>
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
          <option value="SCREEN">Screen</option>
          <option value="MULTIPLY">Multiply</option>
          <option value="ADD">Add</option>
          <option value="NORMAL">Normal</option>
        </select>
      </div>
    </form>
  `;

  const dlg = new Dialog(
    {
      title: "FX Bus: Screen Pulse",
      content,
      buttons: {
        ok: {
          label: "Apply",
          callback: (html) => {
            const form = html[0].querySelector("form.fxbus-pulse-form");
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
              durationMs,
              freqHz: Number(data.get("freqHz")),
              minAlpha: Number(data.get("minAlpha")),
              maxAlpha: Number(data.get("maxAlpha")),
              shape: String(data.get("shape")),
              ease: String(data.get("ease")),
              blendMode: String(data.get("blendMode"))
            });
          }
        }
      },
      default: "ok",
      render: (html) => {
        const root = html[0].querySelector("form.fxbus-pulse-form");
        if (!root) return;

        const picker = root.querySelector('input[name="colourPicker"]');
        const text = root.querySelector('input[name="colour"]');
        const until = root.querySelector('input[name="untilStopped"]');
        const duration = root.querySelector('input[name="durationMs"]');

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
      }
    },
    { width: 420 }
  );

  dlg.render(true);
})();
