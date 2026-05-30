// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\controls.js

/**
 * FX Bus - Scene Controls
 *
 * Purpose:
 * - Add one GM-only FX Bus control group.
 * - Keep the Foundry scene toolbar compact.
 * - Open the FX Bus panel directly on a requested category.
 * - Provide a toolbar reset action.
 *
 * v13/v14 compatibility:
 * - Uses compat.js for array/object scene-control handling.
 * - Keeps a hidden inert select tool so Foundry has a valid activeTool.
 * - Does not expose every FX Bus effect as a toolbar button.
 * - Does not call canvas.tokens.activate() or canvas.tiles.activate().
 *
 * Toolbar model:
 * - Toolbar opens categories.
 * - Panel contains the detailed effect list.
 *
 * Selection model:
 * - Token FX, Tile FX, Screen FX, and Canvas FX only open the panel category.
 * - Panel tabs may activate their declared native selection layer where appropriate.
 * - Screen FX and Canvas FX leave the current selection mode alone.
 *
 * GUI category rule:
 * - Canvas is the user-facing category for render/canvas/view transforms.
 * - Internal implementation names may remain screenRotate, rotate, etc.
 * - The toolbar says Canvas FX, not Screen Rotate.
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

const CATEGORY_TOOL_DEFS = [
  {
    name: "fxbus-token",
    title: "Token FX",
    icon: "fas fa-user-circle",
    startCategory: "token"
  },
  {
    name: "fxbus-tile",
    title: "Tile FX",
    icon: "fas fa-layer-group",
    startCategory: "tile"
  },
  {
    name: "fxbus-screen",
    title: "Screen FX",
    icon: "fas fa-desktop",
    startCategory: "screen"
  },
  {
    name: "fxbus-canvas",
    title: "Canvas FX",
    icon: "fas fa-vector-square",
    startCategory: "canvas"
  }
];

const OLD_TOOL_NAMES = [
  "fxbus-open",
  "fxbus-select-tokens",
  "fxbus-select-tiles",
  "fxbus-osc",
  "fxbus-laser",
  "fxbus-recoil",
  "fxbus-tile-osc",
  "fxbus-shake",
  "fxbus-rotate",
  "fxbus-pulse",
  "fxbus-vignette",
  "fxbus-chromab",
  "fxbus-noise",
  "fxbus-blur",
  "fxbus-smear",
  "fxbus-streak",
  "fxbus-monochrome"
];

function openPanel(options = {}) {
  openFxBusGmControlPanel(options);
}

function resetAll() {
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  runtime.emit({ action: "fx.bus.reset" });
}

function makeCategoryTool(def) {
  return makePassiveSceneTool({
    name: def.name,
    title: def.title,
    icon: def.icon,
    onActivate: () => {
      openPanel({
        startCategory: def.startCategory
      });
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
    ...CATEGORY_TOOL_DEFS.map((def) => makeCategoryTool(def)),
    makeResetTool()
  ];
}

function makeFxbusToolsObject() {
  const tools = {
    [SAFE_TOOL]: makeHiddenSafeSceneTool()
  };

  for (const def of CATEGORY_TOOL_DEFS) {
    tools[def.name] = makeCategoryTool(def);
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
   * This group is passive:
   * - category buttons open the FX Bus panel
   * - detailed effect selection lives inside the panel
   * - reset broadcasts fx.bus.reset
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
      "fxbus-tile",
      ...OLD_TOOL_NAMES
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