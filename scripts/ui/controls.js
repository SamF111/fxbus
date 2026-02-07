// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\controls.js

/**
 * FX Bus - Scene Controls (Foundry v13)
 *
 * Fix:
 * - v13 removed/changed ui.controls.activateTool; use ui.controls.activate(...) instead.
 * - Keeps FX Bus control selected while forcing the active tool back to Token layer "select"
 *   so token selection/dragging remains functional.
 *
 * Behaviour:
 * - Clicking FX Bus tools opens the panel, then immediately restores SAFE_TOOL.
 * - SAFE_TOOL is hidden (button:false) so no duplicate bolt/tool appears.
 */

import { openFxBusGmControlPanel } from "./fxbusPanelApp.js";

const CONTROL_NAME = "fxbus";
const LAYER_NAME = "token";
const HOOK_ID = "getSceneControlButtons";

// Critical: use the Token layer's expected tool name so token interactions keep working.
const SAFE_TOOL = "select";

function openTab(startTab) {
  openFxBusGmControlPanel({ startTab });
}

function resetAll() {
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;
  runtime.emit({ action: "fx.bus.reset" });
}

/**
 * Activate a specific control+tool in a Foundry-v13-safe way.
 * Falls back to older APIs if present (best-effort).
 */
async function activateControlTool(controlName, toolName) {
  const controlsUi = ui?.controls;
  if (!controlsUi) return;

  // v13+ API
  if (typeof controlsUi.activate === "function") {
    await controlsUi.activate({ control: controlName, tool: toolName });
    return;
  }

  // Best-effort legacy fallbacks (if running under older core)
  if (typeof controlsUi.activateControl === "function") controlsUi.activateControl(controlName);
  if (typeof controlsUi.activateTool === "function") controlsUi.activateTool(toolName);
}

function restoreSafeTool() {
  try {
    queueMicrotask(() => {
      if (!ui?.controls) return;
      if (ui.controls.control?.name !== CONTROL_NAME) return;

      // Keep FX Bus control selected, but restore tool to SAFE_TOOL so token interaction remains normal.
      void activateControlTool(CONTROL_NAME, SAFE_TOOL);
    });
  } catch {
    // ignore
  }
}

function makeSafeTool() {
  return {
    name: SAFE_TOOL,
    title: "Select",
    icon: "fas fa-mouse-pointer", // not a bolt; also hidden anyway
    button: false, // hidden from palette
    visible: true,
    toggle: false,
    onChange: () => {
      // intentionally inert
    }
  };
}

function makeTool(name, title, icon, run) {
  return {
    name,
    title,
    icon,
    button: true,
    visible: true,
    toggle: false,
    onChange: (_event, active) => {
      if (!active) return;
      run();
      restoreSafeTool();
    }
  };
}

function makeFxbusControlArrayShape() {
  const tools = [
    makeSafeTool(),

    makeTool("fxbus-osc", "Token Oscillation", "fas fa-ship", () => openTab("osc")),
    makeTool("fxbus-shake", "Screen Shake", "fas fa-wave-square", () => openTab("shake")),
    makeTool("fxbus-pulse", "Screen Pulse", "fas fa-exclamation-triangle", () => openTab("pulse")),
    makeTool("fxbus-vignette", "Vignette", "fas fa-circle", () => openTab("vignette")),
    makeTool("fxbus-chromab", "Chromatic Aberration", "fas fa-adjust", () => openTab("chromab")),
    makeTool("fxbus-noise", "Screen Noise", "fas fa-braille", () => openTab("noise")),
    makeTool("fxbus-blur", "Screen Blur", "fas fa-eye-slash", () => openTab("blur")),
    makeTool("fxbus-smear", "Screen Smear", "fas fa-water", () => openTab("smear")),
    makeTool("fxbus-streak", "Screen Streak", "fas fa-wind", () => openTab("streak")),
    makeTool("fxbus-reset", "Reset All FX", "fas fa-ban", () => resetAll())
  ];

  return {
    name: CONTROL_NAME,
    title: "FX Bus",
    icon: "fas fa-bolt",
    layer: LAYER_NAME,
    visible: true,

    // Selecting the control auto-activates activeTool.
    // Use SAFE_TOOL so token selection/dragging keeps working and no popout opens.
    activeTool: SAFE_TOOL,

    tools
  };
}

function makeFxbusControlObjectShape() {
  return {
    name: CONTROL_NAME,
    title: "FX Bus",
    icon: "fas fa-bolt",
    layer: LAYER_NAME,
    visible: true,
    activeTool: SAFE_TOOL,
    tools: {
      [SAFE_TOOL]: makeSafeTool(),

      "fxbus-osc": makeTool("fxbus-osc", "Token Oscillation", "fas fa-ship", () => openTab("osc")),
      "fxbus-shake": makeTool("fxbus-shake", "Screen Shake", "fas fa-wave-square", () => openTab("shake")),
      "fxbus-pulse": makeTool("fxbus-pulse", "Screen Pulse", "fas fa-exclamation-triangle", () => openTab("pulse")),
      "fxbus-vignette": makeTool("fxbus-vignette", "Vignette", "fas fa-circle", () => openTab("vignette")),
      "fxbus-chromab": makeTool("fxbus-chromab", "Chromatic Aberration", "fas fa-adjust", () => openTab("chromab")),
      "fxbus-noise": makeTool("fxbus-noise", "Screen Noise", "fas fa-braille", () => openTab("noise")),
      "fxbus-blur": makeTool("fxbus-blur", "Screen Blur", "fas fa-eye-slash", () => openTab("blur")),
      "fxbus-smear": makeTool("fxbus-smear", "Screen Smear", "fas fa-water", () => openTab("smear")),
      "fxbus-streak": makeTool("fxbus-streak", "Screen Streak", "fas fa-wind", () => openTab("streak")),
      "fxbus-reset": makeTool("fxbus-reset", "Reset All FX", "fas fa-ban", () => resetAll())
    }
  };
}

export function registerFxBusSceneControls() {
  const key = "__fxbusSceneControlsHookFn";
  const prev = globalThis[key];

  if (prev) {
    try {
      Hooks.off(HOOK_ID, prev);
    } catch {
      // ignore
    }
  }

  const fn = (controls) => {
    if (!game.user.isGM) return;
    if (!controls || typeof controls !== "object") return;

    if (Array.isArray(controls)) {
      if (controls.some((c) => c?.name === CONTROL_NAME)) return;
      controls.push(makeFxbusControlArrayShape());
      return;
    }

    if (controls[CONTROL_NAME]) return;
    controls[CONTROL_NAME] = makeFxbusControlObjectShape();
  };

  globalThis[key] = fn;
  Hooks.on(HOOK_ID, fn);
}
