/**
 * FX Bus - GM Control Panel (Tabbed)
 *
 * Purpose:
 * - Single GM UI to control all FX Bus effects from one place.
 * - Uses globalThis.fxbus.emit() which applies locally on the GM and broadcasts to clients.
 *
 * Effects:
 * - Token Oscillation
 * - Screen Shake
 * - Screen Pulse
 * - Screen Vignette
 * - Global Reset
 *
 * Requirements:
 * - GM user
 * - FX Bus loaded (globalThis.fxbus.emit exists)
 * - For Token Oscillation: one or more tokens selected
 */

(() => {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;
  if (!runtime?.emit) {
    ui.notifications.error("FX Bus runtime not found. Enable fxbus and reload.");
    return;
  }

  const ACTIONS = {
    reset: "fx.bus.reset",

    tokenOscStart: "fx.tokenOsc.start",
    tokenOscUpdate: "fx.tokenOsc.update",
    tokenOscStop: "fx.tokenOsc.stop",

    screenShakeStart: "fx.screenShake.start",
    screenShakeStop: "fx.screenShake.stop",

    screenPulseStart: "fx.screenPulse.start",
    screenPulseStop: "fx.screenPulse.stop",

    screenVignetteStart: "fx.screenVignette.start",
    screenVignetteStop: "fx.screenVignette.stop"
  };

  function normaliseHex(value, fallback) {
    if (typeof value !== "string") return fallback;
    const s = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
    return fallback;
  }

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function bool(formData, name) {
    return formData.get(name) === "on";
  }

  function selectedTokenIds() {
    const tokens = canvas?.tokens?.controlled ?? [];
    return tokens.map((t) => t.id).filter((id) => typeof id === "string" && id.length > 0);
  }

  function setDisabled(el, disabled) {
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? "0.6" : "1";
  }

  function syncColourPair(root, pickerName, textName, fallback) {
    const picker = root.querySelector(`input[name="${pickerName}"]`);
    const text = root.querySelector(`input[name="${textName}"]`);
    if (!picker || !text) return;

    const initial = normaliseHex(text.value, fallback);
    text.value = initial;
    picker.value = initial;

    picker.addEventListener("input", () => {
      text.value = picker.value;
    });

    text.addEventListener("input", () => {
      picker.value = normaliseHex(text.value, fallback);
    });
  }

  const content = `
    <form class="fxbus-panel">
      <style>
        .fxbus-tabs { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
        .fxbus-tab-btn {
          border: 1px solid var(--color-border-light-primary);
          border-radius: 10px;
          padding: 6px 10px;
          cursor: pointer;
          background: var(--color-bg-option);
          user-select: none;
          font-weight: 650;
        }
        .fxbus-tab-btn.is-active {
          background: var(--color-bg-button);
          border-color: var(--color-border-highlight);
        }
        .fxbus-panel-section { display:none; }
        .fxbus-panel-section.is-active { display:block; }
        .fxbus-grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
        .fxbus-inline { display:flex; gap:8px; align-items:center; }
        .fxbus-muted { opacity: 0.8; font-size: 12px; line-height: 1.2; }
        .fxbus-divider { margin: 10px 0; }
        .fxbus-row { display:flex; gap:10px; align-items:center; justify-content:flex-start; flex-wrap:wrap; }
        .fxbus-row button { min-width: 120px; }
        .fxbus-smallbtn { min-width: 90px !important; }
      </style>

      <nav class="fxbus-tabs" aria-label="FX Bus tabs">
        <div class="fxbus-tab-btn is-active" data-tab="osc">Token Osc</div>
        <div class="fxbus-tab-btn" data-tab="shake">Screen Shake</div>
        <div class="fxbus-tab-btn" data-tab="pulse">Screen Pulse</div>
        <div class="fxbus-tab-btn" data-tab="vignette">Vignette</div>
        <div class="fxbus-tab-btn" data-tab="reset">Reset</div>
      </nav>

      <!-- Token Oscillation -->
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

      <!-- Screen Shake -->
      <section class="fxbus-panel-section" data-panel="shake">
        <p class="fxbus-muted">durationMs = 0 runs until stopped (vehicle rumble). Sustained mode is intensity-capped in the effect.</p>

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

      <!-- Screen Pulse -->
      <section class="fxbus-panel-section" data-panel="pulse">
        <p class="fxbus-muted">durationMs = 0 runs until stopped. Use SCREEN blend for warning lights.</p>

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

      <!-- Vignette -->
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

      <!-- Reset -->
      <section class="fxbus-panel-section" data-panel="reset">
        <p class="fxbus-muted">Global reset immediately stops all FX and restores transforms.</p>

        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="doReset" style="min-width:160px;">Execute Reset</button>
        </div>

        <hr class="fxbus-divider"/>

        <p class="fxbus-muted">If you need a hard stop during testing, this is the button.</p>
      </section>
    </form>
  `;

  function activateTab(root, tabId) {
    const buttons = Array.from(root.querySelectorAll(".fxbus-tab-btn"));
    const panels = Array.from(root.querySelectorAll(".fxbus-panel-section"));

    for (const b of buttons) b.classList.toggle("is-active", b.dataset.tab === tabId);
    for (const p of panels) p.classList.toggle("is-active", p.dataset.panel === tabId);
  }

  function wireTabs(root) {
    const buttons = Array.from(root.querySelectorAll(".fxbus-tab-btn"));
    for (const b of buttons) {
      b.addEventListener("click", () => activateTab(root, b.dataset.tab));
      b.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          activateTab(root, b.dataset.tab);
        }
      });
    }
  }

  function wireDisableRules(root) {
    // Pulse: untilStopped disables duration
    const pUntil = root.querySelector('input[name="pulseUntilStopped"]');
    const pDur = root.querySelector('input[name="pulseDurationMs"]');
    if (pUntil && pDur) {
      const apply = () => setDisabled(pDur, pUntil.checked);
      pUntil.addEventListener("change", apply);
      apply();
    }

    // Shake: untilStopped disables duration
    const sUntil = root.querySelector('input[name="shakeUntilStopped"]');
    const sDur = root.querySelector('input[name="shakeDurationMs"]');
    if (sUntil && sDur) {
      const apply = () => setDisabled(sDur, sUntil.checked);
      sUntil.addEventListener("change", apply);
      apply();
    }

    // Vignette: untilStopped disables duration
    const vUntil = root.querySelector('input[name="vigUntilStopped"]');
    const vDur = root.querySelector('input[name="vigDurationMs"]');
    if (vUntil && vDur) {
      const apply = () => setDisabled(vDur, vUntil.checked);
      vUntil.addEventListener("change", apply);
      apply();
    }

    // Vignette: breathing controls disabled when freqHz == 0
    const vFreq = root.querySelector('input[name="vigFreqHz"]');
    const vMin = root.querySelector('input[name="vigMinAlpha"]');
    const vShape = root.querySelector('select[name="vigShape"]');
    if (vFreq && vMin && vShape) {
      const apply = () => {
        const f = num(vFreq.value, 0);
        const enabled = f > 0;
        setDisabled(vMin, !enabled);
        setDisabled(vShape, !enabled);
      };
      vFreq.addEventListener("input", apply);
      apply();
    }
  }

  function wireActions(root) {
    const buttons = Array.from(root.querySelectorAll("button.fxbus-do"));

    for (const btn of buttons) {
      btn.addEventListener("click", () => {
        const which = btn.dataset.do;

        if (which === "doReset") {
          runtime.emit({ action: ACTIONS.reset });
          return;
        }

        if (which === "oscStop") {
          const tokenIds = selectedTokenIds();
          if (tokenIds.length === 0) {
            ui.notifications.warn("Select one or more tokens for Token Oscillation.");
            return;
          }
          runtime.emit({ action: ACTIONS.tokenOscStop, tokenIds });
          return;
        }

        if (which === "oscApply") {
          const tokenIds = selectedTokenIds();
          if (tokenIds.length === 0) {
            ui.notifications.warn("Select one or more tokens for Token Oscillation.");
            return;
          }

          const mode = String(root.querySelector('select[name="oscMode"]')?.value ?? "start");
          const action = mode === "update" ? ACTIONS.tokenOscUpdate : ACTIONS.tokenOscStart;

          if (mode === "stop") {
            runtime.emit({ action: ACTIONS.tokenOscStop, tokenIds });
            return;
          }

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
          return;
        }

        if (which === "shakeStop") {
          runtime.emit({ action: ACTIONS.screenShakeStop });
          return;
        }

        if (which === "shakeApply") {
          const mode = String(root.querySelector('select[name="shakeMode"]')?.value ?? "start");
          if (mode === "stop") {
            runtime.emit({ action: ACTIONS.screenShakeStop });
            return;
          }

          const untilStopped = !!root.querySelector('input[name="shakeUntilStopped"]')?.checked;
          const durationMs = untilStopped ? 0 : num(root.querySelector('input[name="shakeDurationMs"]')?.value, 600);

          runtime.emit({
            action: ACTIONS.screenShakeStart,
            intensityPx: num(root.querySelector('input[name="shakeIntensityPx"]')?.value, 12),
            durationMs,
            freqHz: num(root.querySelector('input[name="shakeFreqHz"]')?.value, 24)
          });
          return;
        }

        if (which === "pulseStop") {
          runtime.emit({ action: ACTIONS.screenPulseStop });
          return;
        }

        if (which === "pulseApply") {
          const mode = String(root.querySelector('select[name="pulseMode"]')?.value ?? "start");
          if (mode === "stop") {
            runtime.emit({ action: ACTIONS.screenPulseStop });
            return;
          }

          const untilStopped = !!root.querySelector('input[name="pulseUntilStopped"]')?.checked;
          const durationMs = untilStopped ? 0 : num(root.querySelector('input[name="pulseDurationMs"]')?.value, 1500);

          runtime.emit({
            action: ACTIONS.screenPulseStart,
            colour: normaliseHex(root.querySelector('input[name="pulseColour"]')?.value ?? "#ff0000", "#ff0000"),
            durationMs,
            freqHz: num(root.querySelector('input[name="pulseFreqHz"]')?.value, 2),
            minAlpha: num(root.querySelector('input[name="pulseMinAlpha"]')?.value, 0),
            maxAlpha: num(root.querySelector('input[name="pulseMaxAlpha"]')?.value, 0.35),
            shape: String(root.querySelector('select[name="pulseShape"]')?.value ?? "sine"),
            ease: String(root.querySelector('select[name="pulseEase"]')?.value ?? "inOut"),
            blendMode: String(root.querySelector('select[name="pulseBlendMode"]')?.value ?? "SCREEN")
          });
          return;
        }

        if (which === "vigStop") {
          runtime.emit({ action: ACTIONS.screenVignetteStop });
          return;
        }

        if (which === "vigApply") {
          const mode = String(root.querySelector('select[name="vigMode"]')?.value ?? "start");
          if (mode === "stop") {
            runtime.emit({ action: ACTIONS.screenVignetteStop });
            return;
          }

          const untilStopped = !!root.querySelector('input[name="vigUntilStopped"]')?.checked;
          const durationMs = untilStopped ? 0 : num(root.querySelector('input[name="vigDurationMs"]')?.value, 1200);

          runtime.emit({
            action: ACTIONS.screenVignetteStart,
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
          return;
        }
      });
    }
  }

  const dlg = new Dialog(
    {
      title: "FX Bus - GM Control Panel",
      content,
      buttons: {
        close: {
          label: "Close"
        }
      },
      default: "close",
      render: (html) => {
        const root = html[0].querySelector("form.fxbus-panel");
        if (!root) return;

        wireTabs(root);

        syncColourPair(root, "pulseColourPicker", "pulseColour", "#ff0000");
        syncColourPair(root, "vigColourPicker", "vigColour", "#000000");

        wireDisableRules(root);
        wireActions(root);
      }
    },
    { width: 520 }
  );

  dlg.render(true);
})();
