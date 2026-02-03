/**
 * FX Bus - Screen Shake Control (GM Macro)
 *
 * Purpose:
 * - GM-side controller for screen shake FX.
 * - Uses runtime.emit() to apply locally and broadcast.
 *
 * Actions:
 * - fx.screenShake.start
 * - fx.screenShake.stop
 *
 * Notes:
 * - durationMs = 0 means "run until stopped" (vehicle rumble mode).
 * - Sustained shakes are clamped in the effect to a low intensity cap.
 */

(() => {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  const ACTION_START = "fx.screenShake.start";
  const ACTION_STOP = "fx.screenShake.stop";

  const content = `
    <form class="fxbus-shake-form">
      <div class="form-group">
        <label>Action</label>
        <select name="mode">
          <option value="start">Start</option>
          <option value="stop">Stop</option>
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
        <input type="number" name="durationMs" value="600" step="50" min="1" max="60000"/>
        <p class="notes">Ignored when "Run until stopped" is enabled.</p>
      </div>

      <div class="form-group">
        <label>Intensity (px)</label>
        <input type="number" name="intensityPx" value="12" step="1" min="0" max="500"/>
        <p class="notes">Sustained mode clamps intensity to a low cap in the effect.</p>
      </div>

      <div class="form-group">
        <label>Frequency (Hz)</label>
        <input type="number" name="freqHz" value="24" step="1" min="1" max="120"/>
      </div>
    </form>
  `;

  const dlg = new Dialog(
    {
      title: "FX Bus: Screen Shake",
      content,
      buttons: {
        ok: {
          label: "Apply",
          callback: (html) => {
            const form = html[0].querySelector("form.fxbus-shake-form");
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
              intensityPx: Number(data.get("intensityPx")),
              durationMs,
              freqHz: Number(data.get("freqHz"))
            });
          }
        }
      },
      default: "ok",
      render: (html) => {
        const root = html[0].querySelector("form.fxbus-shake-form");
        if (!root) return;

        const until = root.querySelector('input[name="untilStopped"]');
        const duration = root.querySelector('input[name="durationMs"]');

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
