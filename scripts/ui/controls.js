// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\controls.js

/**
 * FX Bus - Scene Controls (Foundry v13)
 *
 * What this version fixes (based on your last result: lightning bolt OK, but tools do nothing):
 * - Removes the brittle “only run on DOM click target” gating - in v13 the tool onChange
 *   often fires with an event shape that does not contain the clicked <li>.
 * - Prevents the FX Bus control itself from auto-opening the popout by using an inert
 *   dummy activeTool.
 * - Avoids the “double lightning bolt” look by giving the dummy tool a NON-bolt icon.
 * - Keeps the “no undefined.onChange” guarantee: activeTool always points to a real tool.
 * - Prevents duplicate injection across hot reloads by replacing the existing hook.
 *
 * Behaviour:
 * - Clicking the lightning bolt shows the FX Bus tool palette only (no popout).
 * - Clicking an FX Bus tool opens the popout focused on that tab.
 * - Switching away (Token controls etc.) does not throw.
 */

import { openFxBusGmControlPanel } from "./fxbusPanelApp.js";

const CONTROL_NAME = "fxbus";
const LAYER_NAME = "token";
const HOOK_ID = "getSceneControlButtons";

const DUMMY_TOOL = "fxbus-dummy";

function openTab(startTab) {
  openFxBusGmControlPanel({ startTab });
}

function resetAll() {
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;
  runtime.emit({ action: "fx.bus.reset" });
}

function makeDummyTool() {
  return {
    name: DUMMY_TOOL,
    title: "FX Bus",
    // Important: NOT a bolt, otherwise you visually get “two lightning bolts” when this becomes active.
    icon: "fas fa-circle",
    button: false, // keep it out of the palette
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
      // In v13, tool selection may call onChange with a non-DOM event or undefined.
      // Rely only on the boolean.
      if (!active) return;
      run();
    }
  };
}

function makeFxbusControlArrayShape() {
  const tools = [
    makeDummyTool(),

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
    // Keep it inert so the popout never opens from clicking the lightning bolt.
    activeTool: DUMMY_TOOL,

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
    activeTool: DUMMY_TOOL,
    tools: {
      [DUMMY_TOOL]: makeDummyTool(),

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
