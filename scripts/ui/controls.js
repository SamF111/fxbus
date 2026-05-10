// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\controls.js

/**
 * FX Bus - Scene Controls (Foundry v13)
 *
 * Purpose:
 * - Add one GM-only FX Bus control group.
 * - Open the FX Bus panel directly on a requested tab.
 * - Switch to native Foundry Token/Tiles selection through ui.controls.
 * - Expose the same tab-selection behaviour to the FX Bus panel.
 * - Provide a toolbar reset action.
 *
 * Behaviour:
 * - One FX Bus menu appears on the left.
 * - Token Oscillation activates Foundry's native Token select tool.
 * - Token Laser activates Foundry's native Token select tool.
 * - Tile Oscillation activates Foundry's native Tiles select tool.
 * - Screen FX leave the current selection mode alone.
 * - Token selection uses canvas.tokens.controlled.
 * - Tile selection uses canvas.tiles.controlled.
 *
 * Important:
 * - Do not call canvas.tokens.activate() or canvas.tiles.activate() directly.
 * - Do not register duplicate FX Bus controls on multiple layers.
 * - Do not fake tile selection with pointer interception.
 * - In Foundry v13, native selection should be entered through ui.controls.activate().
 */

import { openFxBusGmControlPanel } from "./fxbusPanelApp.js";

const CONTROL_NAME = "fxbus";
const LAYER_NAME = "token";
const HOOK_ID = "getSceneControlButtons";

const SAFE_TOOL = "select";

const TARGET_KIND_TOKEN = "token";
const TARGET_KIND_TILE = "tile";
const TARGET_KIND_NONE = "none";

const TOOL_DEFS = [
  {
    name: "fxbus-osc",
    title: "Token Oscillation",
    icon: "fas fa-ship",
    tab: "osc",
    targetKind: TARGET_KIND_TOKEN
  },
  {
    name: "fxbus-laser",
    title: "Token Laser",
    icon: "fas fa-link",
    tab: "laser",
    targetKind: TARGET_KIND_TOKEN
  },
  {
    name: "fxbus-tile-osc",
    title: "Tile Oscillation",
    icon: "fas fa-tree",
    tab: "tileOsc",
    targetKind: TARGET_KIND_TILE
  },
  {
    name: "fxbus-shake",
    title: "Screen Shake",
    icon: "fas fa-wave-square",
    tab: "shake",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-pulse",
    title: "Screen Pulse",
    icon: "fas fa-exclamation-triangle",
    tab: "pulse",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-vignette",
    title: "Vignette",
    icon: "fas fa-circle",
    tab: "vignette",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-chromab",
    title: "Chromatic Aberration",
    icon: "fas fa-adjust",
    tab: "chromab",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-noise",
    title: "Screen Noise",
    icon: "fas fa-braille",
    tab: "noise",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-blur",
    title: "Screen Blur",
    icon: "fas fa-eye-slash",
    tab: "blur",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-smear",
    title: "Screen Smear",
    icon: "fas fa-water",
    tab: "smear",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-streak",
    title: "Screen Streak",
    icon: "fas fa-wind",
    tab: "streak",
    targetKind: TARGET_KIND_NONE
  },
  {
    name: "fxbus-monochrome",
    title: "Monochrome",
    icon: "fas fa-film",
    tab: "monochrome",
    targetKind: TARGET_KIND_NONE
  }
];

const TAB_TARGET_KIND = {
  osc: TARGET_KIND_TOKEN,
  laser: TARGET_KIND_TOKEN,
  tileOsc: TARGET_KIND_TILE,

  shake: TARGET_KIND_NONE,
  pulse: TARGET_KIND_NONE,
  vignette: TARGET_KIND_NONE,
  chromab: TARGET_KIND_NONE,
  noise: TARGET_KIND_NONE,
  blur: TARGET_KIND_NONE,
  smear: TARGET_KIND_NONE,
  streak: TARGET_KIND_NONE,
  monochrome: TARGET_KIND_NONE,
  reset: TARGET_KIND_NONE
};

function openTab(startTab) {
  openFxBusGmControlPanel({ startTab });
}

function resetAll() {
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  runtime.emit({ action: "fx.bus.reset" });
}

function getControlsCollection() {
  /**
   * Large comment:
   * Return Foundry's current scene-control collection.
   *
   * Depending on Foundry/core/module state, this may be represented as an array
   * or an object map.
   */
  return ui?.controls?.controls ?? null;
}

function controlsToArray(controls) {
  if (!controls) return [];

  if (Array.isArray(controls)) return controls;

  if (typeof controls === "object") {
    return Object.values(controls);
  }

  return [];
}

function getControlTools(control) {
  const tools = control?.tools;
  if (!tools) return [];

  if (Array.isArray(tools)) return tools;

  if (typeof tools === "object") {
    return Object.values(tools);
  }

  return [];
}

function findControlByName(names) {
  /**
   * Large comment:
   * Find a scene-control group by one of several likely control names.
   *
   * Foundry v13 core usually uses:
   * - "token" for Tokens
   * - "tiles" for Tiles
   */
  const wanted = new Set(names);
  const controls = controlsToArray(getControlsCollection());

  return controls.find((control) => wanted.has(control?.name)) ?? null;
}

function findControlByLayer(layerNames) {
  /**
   * Large comment:
   * Fallback lookup by layer key.
   *
   * This handles minor naming variation while still avoiding direct canvas layer
   * activation.
   */
  const wanted = new Set(layerNames);
  const controls = controlsToArray(getControlsCollection());

  return controls.find((control) => wanted.has(control?.layer)) ?? null;
}

function findToolName(control, preferredNames = ["select"]) {
  /**
   * Large comment:
   * Resolve a valid tool name on a Foundry scene-control group.
   *
   * Prefer the normal select tool. If that is unavailable, use the control's
   * configured activeTool. If that is unavailable, fall back to the first tool.
   */
  const tools = getControlTools(control);

  for (const preferredName of preferredNames) {
    if (tools.some((tool) => tool?.name === preferredName)) {
      return preferredName;
    }
  }

  if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
    return control.activeTool;
  }

  return tools.find((tool) => typeof tool?.name === "string" && tool.name.length > 0)?.name ?? "select";
}

function getNativeControlForTarget(targetKind) {
  /**
   * Large comment:
   * Resolve the native Foundry control group needed for real selection.
   *
   * Token and Tile selection must be entered through ui.controls.activate(...),
   * not through canvas layer activation.
   */
  if (targetKind === TARGET_KIND_TOKEN) {
    return (
      findControlByName(["token", "tokens"]) ??
      findControlByLayer(["token", "tokens"])
    );
  }

  if (targetKind === TARGET_KIND_TILE) {
    return (
      findControlByName(["tiles", "tile"]) ??
      findControlByLayer(["tiles", "tile"])
    );
  }

  return null;
}

async function activateControlTool(controlName, toolName) {
  /**
   * Large comment:
   * Activate a Foundry scene-control group/tool pair.
   *
   * Foundry v13 uses ui.controls.activate(...). Legacy fallbacks are retained
   * only as best-effort compatibility.
   */
  const controlsUi = ui?.controls;
  if (!controlsUi) return false;

  try {
    if (typeof controlsUi.activate === "function") {
      await controlsUi.activate({ control: controlName, tool: toolName });
      return true;
    }

    if (typeof controlsUi.activateControl === "function") {
      controlsUi.activateControl(controlName);
    }

    if (typeof controlsUi.activateTool === "function") {
      controlsUi.activateTool(toolName);
    }

    return true;
  } catch (err) {
    console.warn("[FX Bus] Failed to activate control tool.", {
      controlName,
      toolName,
      err
    });

    return false;
  }
}

async function activateNativeSelectionForTarget(targetKind) {
  /**
   * Large comment:
   * Activate Foundry's native selection mode for the requested target.
   *
   * This is the important crash fix:
   * - No canvas.tiles.activate()
   * - No canvas.tokens.activate()
   * - Only ui.controls.activate({ control, tool })
   *
   * This keeps Foundry's active control/tool state valid, preventing
   * Tile._refreshState from reading undefined.active.
   */
  if (targetKind === TARGET_KIND_NONE) return true;

  const control = getNativeControlForTarget(targetKind);

  if (!control?.name) {
    console.warn("[FX Bus] Native selection control not found.", { targetKind });
    return false;
  }

  const toolName = findToolName(control, ["select"]);
  const ok = await activateControlTool(control.name, toolName);

  if (!ok) return false;

  if (targetKind === TARGET_KIND_TOKEN) {
    ui.notifications.info("FX Bus: token selection mode enabled.");
  }

  if (targetKind === TARGET_KIND_TILE) {
    ui.notifications.info("FX Bus: tile selection mode enabled.");
  }

  return true;
}

export async function activateFxBusSelectionModeForTab(tabId) {
  /**
   * Large comment:
   * Activate the Foundry selection mode required by an FX Bus panel tab.
   *
   * This is used by both:
   * - the left scene-control FX Bus buttons
   * - the tab buttons inside the FX Bus control panel
   *
   * Keeping both paths routed through the same function prevents inconsistent
   * behaviour where toolbar buttons switch Token/Tiles selection correctly but
   * panel tab clicks only change the visible form.
   */
  const targetKind = TAB_TARGET_KIND[tabId] ?? TARGET_KIND_NONE;

  return activateNativeSelectionForTarget(targetKind);
}

function makeSafeTool() {
  return {
    name: SAFE_TOOL,
    title: "Select",
    icon: "fas fa-mouse-pointer",
    button: false,
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
    onChange: async (_event, active) => {
      if (!active) return;

      await run();
    }
  };
}

function makePanelTool(def) {
  return makeTool(
    def.name,
    def.title,
    def.icon,
    async () => {
      openTab(def.tab);
      await activateFxBusSelectionModeForTab(def.tab);
    }
  );
}

function makeResetTool() {
  return makeTool(
    "fxbus-reset",
    "Reset All FX",
    "fas fa-ban",
    async () => {
      resetAll();
    }
  );
}

function makeFxbusToolsArray() {
  return [
    makeSafeTool(),
    ...TOOL_DEFS.map((def) => makePanelTool(def)),
    makeResetTool()
  ];
}

function makeFxbusToolsObject() {
  const tools = {
    [SAFE_TOOL]: makeSafeTool()
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

function removeDuplicateFxBusControls(controls) {
  /**
   * Large comment:
   * Remove stale duplicate FX Bus controls left by previous development builds.
   *
   * Earlier attempts registered controls such as fxbus-token and fxbus-tile.
   * They must not persist alongside the single canonical fxbus control.
   */
  const staleNames = new Set([
    "fxbus-token",
    "fxbus-tile"
  ]);

  if (Array.isArray(controls)) {
    for (let i = controls.length - 1; i >= 0; i -= 1) {
      if (staleNames.has(controls[i]?.name)) {
        controls.splice(i, 1);
      }
    }
    return;
  }

  if (controls && typeof controls === "object") {
    for (const staleName of staleNames) {
      if (controls[staleName]) delete controls[staleName];
    }
  }
}

export function registerFxBusSceneControls() {
  /**
   * Large comment:
   * Register exactly one FX Bus scene-control group.
   *
   * The FX Bus group opens panels and then hands native selection back to
   * Foundry's own Token/Tiles controls where required.
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

    removeDuplicateFxBusControls(controls);

    if (Array.isArray(controls)) {
      if (controls.some((control) => control?.name === CONTROL_NAME)) return;

      controls.push(makeFxbusControlArrayShape());
      return;
    }

    if (controls[CONTROL_NAME]) return;

    controls[CONTROL_NAME] = makeFxbusControlObjectShape();
  };

  globalThis[key] = fn;
  Hooks.on(HOOK_ID, fn);
}