/**
 * FX Bus - Token Oscillation Control (GM Macro)
 *
 * Purpose:
 * - GM-side controller for token oscillation FX.
 * - Uses runtime.emit() to apply locally and broadcast.
 *
 * Requirements:
 * - FX Bus module enabled (globalThis.fxbus present).
 * - One or more tokens selected.
 */

(() => {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  const tokens = canvas.tokens.controlled ?? [];
  if (tokens.length === 0) {
    ui.notifications.warn("No tokens selected.");
    return;
  }

  const tokenIds = tokens.map((t) => t.id);

  const ACTION_START = "fx.tokenOsc.start";
  const ACTION_STOP = "fx.tokenOsc.stop";

  new Dialog({
    title: "FX Bus: Token Oscillation",
    content: `
      <form>
        <div class="form-group">
          <label>Action</label>
          <select name="mode">
            <option value="start">Start / Update</option>
            <option value="stop">Stop</option>
          </select>
        </div>

        <hr/>

        <div class="form-group">
          <label>Roll (degrees)</label>
          <input type="number" name="rollDeg" value="3" step="0.1"/>
        </div>

        <div class="form-group">
          <label>Bob (px)</label>
          <input type="number" name="bobPx" value="2" step="0.1"/>
        </div>

        <div class="form-group">
          <label>Sway (px)</label>
          <input type="number" name="swayPx" value="1" step="0.1"/>
        </div>

        <div class="form-group">
          <label>Frequency (Hz)</label>
          <input type="number" name="freqHz" value="0.7" step="0.1"/>
        </div>

        <div class="form-group">
          <label>Noise (0-0.5)</label>
          <input type="number" name="noise" value="0" step="0.05" min="0" max="0.5"/>
        </div>

        <div class="form-group">
          <label>
            <input type="checkbox" name="randomPhase" checked/>
            Random phase per token
          </label>
        </div>
      </form>
    `,
    buttons: {
      ok: {
        label: "Apply",
        callback: (html) => {
          const form = html[0].querySelector("form");
          const data = new FormData(form);

          const mode = String(data.get("mode"));

          if (mode === "stop") {
            runtime.emit({
              action: ACTION_STOP,
              tokenIds
            });
            return;
          }

          runtime.emit({
            action: ACTION_START,
            tokenIds,
            rollDeg: Number(data.get("rollDeg")),
            bobPx: Number(data.get("bobPx")),
            swayPx: Number(data.get("swayPx")),
            freqHz: Number(data.get("freqHz")),
            noise: Number(data.get("noise")),
            randomPhase: data.get("randomPhase") === "on"
          });
        }
      }
    },
    default: "ok"
  }).render(true);
})();
