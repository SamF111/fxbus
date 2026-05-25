// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\controls.js

/**
 * FX Bus - Scene Controls
 *
 * Purpose:
 * - Add one GM-only FX Bus control group.
 * - Open the FX Bus panel directly on a requested tab.
 * - Provide explicit Token/Tiles selection helper buttons.
 * - Provide a toolbar reset action.
 *
 * v13/v14 compatibility:
 * - Uses compat.js for array/object scene-control handling.
 * - Keeps a hidden inert select tool so Foundry has a valid activeTool.
 * - Does not automatically force native Token/Tiles selection when opening FX tabs.
 * - Does not call canvas.tokens.activate() or canvas.tiles.activate().
 *
 * Selection model:
 * - "Select Tokens" explicitly activates Foundry's native Token select tool.
 * - "Select Tiles" explicitly activates Foundry's native Tiles select tool.
 * - Token Oscillation, Token Tether, Token Recoil, and Tile Oscillation only open their tabs.
 * - Screen FX leave the current selection mode alone.
 *
 * Token Tether:
 * - Re-enabled after isolated macro testing.
 * - The toolbar button only opens the Token Tether tab.
 */

import { openFxBusGmControlPanel } from "./fxbusPanelApp.js";

import {
  addControlDefinition,
  makeHiddenSafeSceneTool,
  makePassiveSceneTool,
  removeControlsNamed
} from "../compat.js";

const CONTROL_NAME = "fxbus";
const LAYER_NAME = "token";
const HOOK_ID = "getSceneControlButtons";
const SAFE_TOOL = "select";

const TOOL_DEFS = [
  {
    name: "fxbus-select-tokens",
    title: "Select Tokens",
    icon: "fas fa-user-circle",
    tab: "osc",
    selectLayer: "tokens"
  },
  {
    name: "fxbus-select-tiles",
    title: "Select Tiles",
    icon: "fas fa-layer-group",
    tab: "tileOsc",
    selectLayer: "tiles"
  },
  {
    name: "fxbus-osc",
    title: "Token Oscillation",
    icon: "fas fa-ship",
    tab: "osc"
  },
  {
    name: "fxbus-laser",
    title: "Token Tether",
    icon: "fas fa-link",
    tab: "laser"
  },
  {
    name: "fxbus-recoil",
    title: "Token Recoil",
    icon: "fas fa-burst",
    tab: "recoil"
  },
  {
    name: "fxbus-tile-osc",
    title: "Tile Oscillation",
    icon: "fas fa-tree",
    tab: "tileOsc"
  },
  {
    name: "fxbus-shake",
    title: "Screen Shake",
    icon: "fas fa-wave-square",
    tab: "shake"
  },
  {
    name: "fxbus-rotate",
    title: "Screen Rotate",
    icon: "fas fa-sync-alt",
    tab: "rotate"
  },
  {
    name: "fxbus-pulse",
    title: "Screen Pulse",
    icon: "fas fa-exclamation-triangle",
    tab: "pulse"
  },
  {
    name: "fxbus-vignette",
    title: "Vignette",
    icon: "fas fa-circle",
    tab: "vignette"
  },
  {
    name: "fxbus-chromab",
    title: "Chromatic Aberration",
    icon: "fas fa-adjust",
    tab: "chromab"
  },
  {
    name: "fxbus-noise",
    title: "Screen Noise",
    icon: "fas fa-braille",
    tab: "noise"
  },
  {
    name: "fxbus-blur",
    title: "Screen Blur",
    icon: "fas fa-eye-slash",
    tab: "blur"
  },
  {
    name: "fxbus-smear",
    title: "Screen Smear",
    icon: "fas fa-water",
    tab: "smear"
  },
  {
    name: "fxbus-streak",
    title: "Screen Streak",
    icon: "fas fa-wind",
    tab: "streak"
  },
  {
    name: "fxbus-monochrome",
    title: "Monochrome",
    icon: "fas fa-film",
    tab: "monochrome"
  }
];

function openTab(startTab) {
  openFxBusGmControlPanel({ startTab });
}

function resetAll() {
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  runtime.emit({ action: "fx.bus.reset" });
}

function getSceneControlsCollection() {
  return ui?.controls?.controls ?? null;
}

function getNativeControl(controlNames) {
  /**
   * Large comment:
   * Resolve a native Foundry control group by likely names.
   *
   * Foundry versions and modules may expose control collections as either arrays
   * or object maps. v14 commonly uses object maps, while older/module-influenced
   * flows may still present arrays.
   */
  const controls = getSceneControlsCollection();
  if (!controls) return null;

  if (Array.isArray(controls)) {
    return controls.find((control) => controlNames.includes(control?.name)) ?? null;
  }

  if (typeof controls === "object") {
    for (const name of controlNames) {
      if (controls[name]) return controls[name];
    }

    const values = Object.values(controls);
    return values.find((control) => controlNames.includes(control?.name)) ?? null;
  }

  return null;
}

function getToolName(control, preferredName = "select") {
  /**
   * Large comment:
   * Resolve the safest selectable tool name for a native Foundry control group.
   *
   * Prefer "select". If unavailable, fall back to the control's activeTool. If
   * that is also unavailable, use the first named tool.
   */
  const tools = control?.tools;

  if (!tools) return preferredName;

  if (Array.isArray(tools)) {
    if (tools.some((tool) => tool?.name === preferredName)) return preferredName;

    if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
      return control.activeTool;
    }

    return tools.find((tool) => typeof tool?.name === "string" && tool.name.length > 0)?.name ?? preferredName;
  }

  if (typeof tools === "object") {
    if (tools[preferredName]) return preferredName;

    if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
      return control.activeTool;
    }

    return Object.values(tools).find((tool) => typeof tool?.name === "string" && tool.name.length > 0)?.name ?? preferredName;
  }

  return preferredName;
}

async function activateNativeSelectionLayer(selectLayer) {
  /**
   * Large comment:
   * Explicitly activate a native Foundry selection layer.
   *
   * This is only called from the dedicated "Select Tokens" and "Select Tiles"
   * FX Bus toolbar buttons. It is not called when opening normal FX tabs.
   */
  const controlsUi = ui?.controls;

  if (!controlsUi || typeof controlsUi.activate !== "function") {
    ui.notifications.warn("FX Bus: native controls API unavailable.");
    return false;
  }

  const control =
    selectLayer === "tokens"
      ? getNativeControl(["tokens", "token"])
      : selectLayer === "tiles"
        ? getNativeControl(["tiles", "tile"])
        : null;

  if (!control?.name) {
    ui.notifications.warn(`FX Bus: could not find native ${selectLayer} controls.`);
    return false;
  }

  const toolName = getToolName(control, SAFE_TOOL);

  try {
    await controlsUi.activate({ control: control.name, tool: toolName });

    ui.notifications.info(
      selectLayer === "tokens"
        ? "FX Bus: token selection enabled."
        : "FX Bus: tile selection enabled."
    );

    return true;
  } catch (err) {
    console.warn("[FX Bus] Native selection activation failed.", {
      selectLayer,
      controlName: control.name,
      toolName,
      err
    });

    ui.notifications.warn(`FX Bus: failed to activate ${selectLayer} selection.`);
    return false;
  }
}

function makePanelTool(def) {
  return makePassiveSceneTool({
    name: def.name,
    title: def.title,
    icon: def.icon,
    onActivate: async () => {
      openTab(def.tab);

      if (def.selectLayer) {
        await activateNativeSelectionLayer(def.selectLayer);
      }
    }
  });
}

function makeResetTool() {
  return makePassiveSceneTool({
    name: "fxbus-reset",
    title: "Reset All FX",
    icon: "fas fa-ban",
    onActivate: () => {
      resetAll();
    }
  });
}

function makeFxbusToolsArray() {
  return [
    makeHiddenSafeSceneTool(),
    ...TOOL_DEFS.map((def) => makePanelTool(def)),
    makeResetTool()
  ];
}

function makeFxbusToolsObject() {
  const tools = {
    [SAFE_TOOL]: makeHiddenSafeSceneTool()
  };

  for (const def of TOOL_DEFS) {
    tools[def.name] = makePanelTool(def);
  }

  tools["fxbus-reset"] = makeResetTool();

  return tools;
}

function makeFxbusControlArrayShape() {
  return {
    name: CONTROL_NAME,
    title: "FX Bus",
    icon: "fas fa-bolt",
    layer: LAYER_NAME,
    visible: true,
    activeTool: SAFE_TOOL,
    tools: makeFxbusToolsArray()
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
    tools: makeFxbusToolsObject()
  };
}

function makeFxbusControlForCurrentShape(controls) {
  /**
   * Large comment:
   * Return the FX Bus control in the same shape as Foundry's current
   * getSceneControlButtons payload.
   */
  if (Array.isArray(controls)) return makeFxbusControlArrayShape();

  return makeFxbusControlObjectShape();
}

export function registerFxBusSceneControls() {
  /**
   * Large comment:
   * Register exactly one FX Bus scene-control group.
   *
   * This group is mostly passive:
   * - normal FX buttons open the FX Bus panel
   * - screen FX leave native selection alone
   * - dedicated selection helper buttons explicitly activate native Token/Tiles select
   * - a hidden safe active tool keeps Foundry control-state valid
   */
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

    removeControlsNamed(controls, [
      "fxbus-token",
      "fxbus-tile"
    ]);

    addControlDefinition(
      controls,
      CONTROL_NAME,
      makeFxbusControlForCurrentShape(controls)
    );
  };

  globalThis[key] = fn;
  Hooks.on(HOOK_ID, fn);
}