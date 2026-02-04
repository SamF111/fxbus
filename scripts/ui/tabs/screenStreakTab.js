// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\screenStreakTab.js

/**
 * FX Bus - Screen Streak UI Tab (Foundry v13+)
 *
 * Update:
 * - Keeps the strict scoping to the streak tab panel.
 * - Ensures "run until stopped" reliably forces durationMs = 0.
 * - Disables (and visually locks) the duration input while run-until-stopped is checked.
 * - Adds Ramp (ms) control support:
 *   - Reads streak_rampMs (with fallbacks)
 *   - Clamps to 0..1000ms
 *   - Always emitted; FX decides how to use it (indefinite mode uses it)
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) so the panel-level Copy to Macro action can work.
 * - Payload is identical to Apply (start/update).
 */

const TAB_ID = "streak";
const RAMP_MS_MAX = 1000;

function getElByNames(scope, names) {
  for (const name of names) {
    const el = scope.querySelector(`[name="${CSS.escape(name)}"]`);
    if (el) return el;
  }
  return null;
}

function num(scope, names, fallback) {
  const el = getElByNames(scope, Array.isArray(names) ? names : [names]);
  const v = Number(el?.value);
  return Number.isFinite(v) ? v : fallback;
}

function bool(scope, names, fallback = false) {
  const el = getElByNames(scope, Array.isArray(names) ? names : [names]);
  return el ? Boolean(el.checked) : fallback;
}

function str(scope, names, fallback) {
  const el = getElByNames(scope, Array.isArray(names) ? names : [names]);
  const v = el?.value;
  return typeof v === "string" && v.length ? v : fallback;
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function buildApplyPayload(panel) {
  const RUN_NAMES = [
    "streak_runUntilStopped",
    "runUntilStopped",
    "streak_run_until_stopped",
    "streak_infinite",
    "streak_indefinite"
  ];

  const DURATION_NAMES = ["streak_durationMs", "durationMs", "streak_duration", "duration"];

  const RAMP_NAMES = [
    "streak_rampMs",
    "rampMs",
    "streak_ramp",
    "ramp",
    "streak_ramp_ms"
  ];

  const runUntilStopped = bool(panel, RUN_NAMES, false);

  const durationMs = runUntilStopped ? 0 : num(panel, DURATION_NAMES, 600);

  const rampMs = clamp(num(panel, RAMP_NAMES, 250), 0, RAMP_MS_MAX);

  return {
    action: "fx.screenStreak.start",
    strength: num(panel, ["streak_strength", "strength"], 0.6),
    persistence: num(panel, ["streak_persistence", "persistence"], 0.9),
    lengthPx: num(panel, ["streak_lengthPx", "lengthPx"], 60),
    angleDeg: num(panel, ["streak_angleDeg", "angleDeg"], 0),
    jitterPx: num(panel, ["streak_jitterPx", "jitterPx"], 0),
    freqHz: num(panel, ["streak_freqHz", "freqHz"], 0),
    durationMs,
    rampMs,
    ease: str(panel, ["streak_ease", "ease"], "inOut"),
    additive: bool(panel, ["streak_additive", "additive"], false)
  };
}

function wireTab(root, runtime) {
  if (!root || !runtime?.emit) return;

  // Kill any previous listeners for this tab on re-render.
  try {
    root.__fxbusStreakAbort?.abort?.();
  } catch {
    // ignore
  }
  const ac = new AbortController();
  root.__fxbusStreakAbort = ac;

  const panel =
    root.querySelector('.tab[data-group="fxbus"][data-tab="streak"]') ??
    root.querySelector('[data-fxbus-tab="streak"]');

  if (!panel) return;

  const applyBtn =
    panel.querySelector('[data-action="apply"]') ??
    panel.querySelector('[data-action="streakApply"]') ??
    panel.querySelector('[data-action="start"]') ??
    panel.querySelector('[data-action="streakStart"]');

  const stopBtn =
    panel.querySelector('[data-action="stop"]') ??
    panel.querySelector('[data-action="streakStop"]');

  // Name fallbacks (handles template drift).
  const RUN_NAMES = [
    "streak_runUntilStopped",
    "runUntilStopped",
    "streak_run_until_stopped",
    "streak_infinite",
    "streak_indefinite"
  ];

  const DURATION_NAMES = ["streak_durationMs", "durationMs", "streak_duration", "duration"];

  function applyRunToggleUi() {
    const runEl = getElByNames(panel, RUN_NAMES);
    const durEl = getElByNames(panel, DURATION_NAMES);
    if (!durEl) return;

    const run = runEl ? Boolean(runEl.checked) : false;

    // Disable duration input when running indefinitely.
    durEl.disabled = run;
    durEl.classList.toggle("fxbus-disabled", run);

    const fg = durEl.closest?.(".form-group");
    if (fg) fg.classList.toggle("disabled", run);
  }

  // React to checkbox toggles (and also update once immediately).
  for (const name of RUN_NAMES) {
    const el = panel.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) continue;

    el.addEventListener(
      "change",
      () => applyRunToggleUi(),
      { signal: ac.signal, capture: true }
    );
  }
  applyRunToggleUi();

  if (applyBtn) {
    applyBtn.addEventListener(
      "click",
      (event) => {
        event.preventDefault();

        const payload = buildApplyPayload(panel);
        console.debug("[FX Bus] screenStreak.start payload", payload);
        runtime.emit(payload);
      },
      { signal: ac.signal }
    );
  }

  if (stopBtn) {
    stopBtn.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        runtime.emit({ action: "fx.screenStreak.stop" });
      },
      { signal: ac.signal }
    );
  }
}

export function screenStreakTabDef() {
  return {
    id: TAB_ID,
    label: "Streak",

    /**
     * Build the socket payload for "Apply" / Copy-to-Macro.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      const panel =
        root.querySelector('.tab[data-group="fxbus"][data-tab="streak"]') ??
        root.querySelector('[data-fxbus-tab="streak"]');

      if (!panel) throw new Error("ScreenStreak: panel not found");

      return buildApplyPayload(panel);
    },

    wire: (root, runtime) => wireTab(root, runtime)
  };
}
