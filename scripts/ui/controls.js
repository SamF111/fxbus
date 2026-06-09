// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\controls.js

/**
 * FX Bus - Scene Controls
 *
 * Purpose:
 * - Add one FX Bus lightning-bolt button to the native Token controls.
 * - Add one FX Bus lightning-bolt button to the native Tiles controls.
 * - Add one standalone FX Bus launcher control.
 * - Add one standalone Reset All FX launcher control directly below FX Bus.
 *
 * Toolbar model:
 * - Token toolbar bolt opens Token FX and keeps Foundry in Token Select.
 * - Tiles toolbar bolt opens Tile FX and keeps Foundry in Tiles Select.
 * - Standalone FX Bus top-level icon is a contextual launcher.
 * - Standalone Reset All FX top-level icon is a passive reset launcher.
 *
 * Contextual standalone FX Bus behaviour:
 * - If clicked while native Tokens is active:
 *   - open Token FX
 *   - keep Foundry in Tokens / Select
 *
 * - If clicked while native Tiles is active:
 *   - open Tile FX
 *   - keep Foundry in Tiles / Select
 *
 * - If clicked from any other control:
 *   - open Screen FX
 *   - restore a safe native Token / Select state
 *
 * Important:
 * - The standalone FX Bus icon must not be allowed to activate as a real scene
 *   control when coming from Tiles.
 * - Foundry can crash in Tile._refreshState during the Tiles -> custom-control
 *   transition.
 * - Therefore a capture-phase launcher guard intercepts the top-level FX Bus
 *   and Reset clicks before Foundry handles them.
 *
 * Reset model:
 * - Reset All FX is available as its own top-level launcher below FX Bus.
 * - Reset is not duplicated in Token or Tile controls because it is global, not
 *   layer-specific.
 *
 * Safety model:
 * - FX Bus toolbar entries are action buttons, not persistent scene tools.
 * - FX Bus does not register or enter a custom canvas layer.
 * - Standalone top-level controls use the native Token layer only as a harmless
 *   fallback for Foundry's control data model.
 * - The capture guard prevents these standalone launchers from becoming active
 *   canvas modes during normal use.
 */

import { openFxBusGmControlPanel } from "./fxbusPanelApp.js";

const HOOK_ID = "getSceneControlButtons";

const FXBUS_LAUNCHER_CONTROL_NAME = "fxbus";
const RESET_LAUNCHER_CONTROL_NAME = "fxbus-reset-all";

// Do not register a custom FX Bus canvas layer. This is only a safe fallback
// layer for Foundry's top-level control data shape. The click is intercepted.
const FALLBACK_LAYER_NAME = "token";

const SELECT_TOOL = "select";
const FXBUS_IDLE_TOOL = "fxbus-idle";
const RESET_IDLE_TOOL = "fxbus-reset-idle";

const TOKEN_CONTROL_NAMES = ["token", "tokens"];
const TILE_CONTROL_NAMES = ["tiles", "tile"];

const STALE_TOP_LEVEL_CONTROL_NAMES = [
  "fxbus",
  "fxbus-screen-canvas",
  "fxbus-reset-all"
];

const FXBUS_TOOL_NAMES = [
  "fxbus-idle",
  "fxbus-reset-idle",
  "fxbus-token",
  "fxbus-tile",
  "fxbus-screen",
  "fxbus-canvas",
  "fxbus-reset",
  "fxbus-reset-token",
  "fxbus-reset-tile",

  // Previous custom-control migration names.
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

let lastNativeControlSnapshot = {
  control: "token",
  tool: SELECT_TOOL
};

let lastStandaloneLaunchAt = 0;

function normaliseControlName(value) {
  /**
   * Large comment:
   * Normalise likely Foundry control names across v13/v14 and common module
   * conventions.
   */
  const name = String(value ?? "").trim();

  if (name === "tokens") return "token";
  if (name === "tile") return "tiles";

  return name;
}

function getControlEntries(controls) {
  /**
   * Large comment:
   * Return scene controls as mutable [name, control] pairs regardless of whether
   * Foundry passed an array-shaped or object-shaped controls payload.
   */
  if (!controls || typeof controls !== "object") return [];

  if (Array.isArray(controls)) {
    return controls
      .map((control) => [normaliseControlName(control?.name), control])
      .filter((entry) => entry[0] && entry[1]);
  }

  return Object.entries(controls).map(([name, control]) => [
    normaliseControlName(control?.name ?? name),
    control
  ]);
}

function findControl(controls, names) {
  /**
   * Large comment:
   * Find a native Foundry scene control by any accepted name.
   */
  const wanted = new Set(names.map((name) => normaliseControlName(name)));

  for (const [name, control] of getControlEntries(controls)) {
    if (wanted.has(name)) return control;
  }

  return null;
}

function removeTopLevelControlsNamed(controls, names) {
  /**
   * Large comment:
   * Remove stale top-level controls left by earlier FX Bus toolbar versions.
   */
  const wanted = new Set(names);

  if (!controls || typeof controls !== "object") return;

  if (Array.isArray(controls)) {
    for (let i = controls.length - 1; i >= 0; i -= 1) {
      if (wanted.has(controls[i]?.name)) controls.splice(i, 1);
    }

    return;
  }

  for (const name of Object.keys(controls)) {
    if (wanted.has(name) || wanted.has(controls[name]?.name)) {
      delete controls[name];
    }
  }
}

function getToolsContainer(control) {
  if (!control || typeof control !== "object") return null;
  if (!control.tools) control.tools = [];

  return control.tools;
}

function removeToolsNamed(control, names) {
  /**
   * Large comment:
   * Remove stale FX Bus tools from a native Foundry control.
   */
  const tools = getToolsContainer(control);
  if (!tools) return;

  const wanted = new Set(names);

  if (Array.isArray(tools)) {
    for (let i = tools.length - 1; i >= 0; i -= 1) {
      if (wanted.has(tools[i]?.name)) tools.splice(i, 1);
    }

    return;
  }

  for (const name of Object.keys(tools)) {
    if (wanted.has(name) || wanted.has(tools[name]?.name)) {
      delete tools[name];
    }
  }
}

function addTool(control, tool) {
  /**
   * Large comment:
   * Add a tool to a Foundry control while preserving the current array/object
   * tool shape.
   */
  const tools = getToolsContainer(control);
  if (!tools || !tool?.name) return;

  removeToolsNamed(control, [tool.name]);

  if (Array.isArray(tools)) {
    tools.push(tool);
    return;
  }

  tools[tool.name] = tool;
}

function addTopLevelControl(controls, control) {
  /**
   * Large comment:
   * Add a top-level scene control while preserving Foundry's current controls
   * shape.
   */
  if (!controls || typeof controls !== "object" || !control?.name) return;

  removeTopLevelControlsNamed(controls, [control.name]);

  if (Array.isArray(controls)) {
    controls.push(control);
    return;
  }

  controls[control.name] = control;
}

function getCurrentControlName() {
  /**
   * Large comment:
   * Read the current active scene control name across Foundry control UI shapes.
   */
  const raw =
    ui?.controls?.control?.name ??
    ui?.controls?.activeControl ??
    "";

  return normaliseControlName(raw);
}

function isNativeControlName(controlName) {
  /**
   * Large comment:
   * Return true for native Foundry controls that FX Bus should preserve when
   * used as a contextual launcher.
   */
  return controlName === "token" || controlName === "tiles";
}

function captureCurrentNativeControlSnapshot() {
  /**
   * Large comment:
   * Remember the current native Foundry control before a possible contextual
   * launcher click.
   */
  const control = getCurrentControlName();

  if (!isNativeControlName(control)) return lastNativeControlSnapshot;

  lastNativeControlSnapshot = {
    control,
    tool: SELECT_TOOL
  };

  return lastNativeControlSnapshot;
}

function getContextualLaunchSnapshot() {
  /**
   * Large comment:
   * Determine which native Foundry control should be preserved when a standalone
   * FX Bus launcher icon is clicked.
   */
  const current = getCurrentControlName();

  if (isNativeControlName(current)) {
    return {
      control: current,
      tool: SELECT_TOOL
    };
  }

  return {
    ...lastNativeControlSnapshot,
    tool: SELECT_TOOL
  };
}

function getCategoryForControl(controlName) {
  /**
   * Large comment:
   * Convert the currently active native Foundry control into the panel category
   * FX Bus should open.
   */
  const control = normaliseControlName(controlName);

  if (control === "tiles") return "tile";
  if (control === "token") return "token";

  return "screen";
}

async function activateControlTool(controlName, toolName) {
  /**
   * Large comment:
   * Restore a real Foundry control/tool pair after a passive FX Bus button is
   * clicked.
   */
  const controlsUi = ui?.controls;
  if (!controlsUi) return false;

  const control = normaliseControlName(controlName);
  const tool = String(toolName ?? "").trim();

  if (!control || !tool) return false;

  try {
    if (typeof controlsUi.activate === "function") {
      await controlsUi.activate({ control, tool });
      return true;
    }

    if (typeof controlsUi.activateControl === "function") {
      controlsUi.activateControl(control);
    }

    if (typeof controlsUi.activateTool === "function") {
      controlsUi.activateTool(tool);
    }

    return true;
  } catch (err) {
    console.warn("[FX Bus] Failed to restore Foundry control/tool.", {
      control,
      tool,
      err
    });
    return false;
  }
}

function restoreControlToolSoon(controlName, toolName) {
  /**
   * Large comment:
   * Restore a stable control/tool after Foundry has finished processing the
   * toolbar button activation.
   *
   * Foundry can apply scene-control state across more than one frame. The
   * repeated restores are deliberate.
   */
  const restore = () => {
    void activateControlTool(controlName, toolName);
  };

  try {
    queueMicrotask(restore);
    setTimeout(restore, 0);
    setTimeout(restore, 50);
    setTimeout(restore, 150);
  } catch {
    restore();
  }
}

function openPanel(options = {}) {
  openFxBusGmControlPanel(options);
}

function resetAll() {
  const runtime = globalThis.fxbus;
  if (!runtime?.emit) return;

  runtime.emit({ action: "fx.bus.reset" });
}

function isLikelyTopLevelSceneControlElement(element) {
  /**
   * Large comment:
   * Detect the nearest likely top-level scene-control DOM element.
   *
   * Foundry toolbar markup changes between core versions and themes, so this is
   * intentionally broad.
   */
  return element?.closest?.(
    [
      "button",
      "a",
      "li",
      ".scene-control",
      ".control-tool",
      "[data-control]",
      "[data-tool]",
      "[data-action]",
      "[data-control-id]",
      "[data-tooltip]",
      "[aria-label]",
      "[title]"
    ].join(",")
  ) ?? null;
}

function readElementCandidateValues(element) {
  /**
   * Large comment:
   * Read common Foundry toolbar attributes from a candidate scene-control DOM
   * element.
   */
  return [
    element.dataset?.control,
    element.dataset?.tool,
    element.dataset?.action,
    element.dataset?.controlId,
    element.dataset?.name,
    element.getAttribute?.("data-control"),
    element.getAttribute?.("data-tool"),
    element.getAttribute?.("data-action"),
    element.getAttribute?.("data-control-id"),
    element.getAttribute?.("data-name"),
    element.getAttribute?.("data-tooltip"),
    element.getAttribute?.("aria-label"),
    element.getAttribute?.("title"),
    element.textContent
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function getStandaloneLauncherKind(element) {
  /**
   * Large comment:
   * Determine whether a DOM event target belongs to one of FX Bus's standalone
   * top-level launcher controls.
   *
   * This intentionally avoids matching native Token/Tile FX Bus buttons such as
   * "FX Bus - Token FX" or "FX Bus - Tile FX". Those are handled through normal
   * tool callbacks.
   */
  const el = isLikelyTopLevelSceneControlElement(element);
  if (!el) return null;

  const candidates = readElementCandidateValues(el).map((value) => value.toLowerCase());

  const isFxBusLauncher = candidates.some((value) => {
    return (
      value === FXBUS_LAUNCHER_CONTROL_NAME ||
      value === "fx bus"
    );
  });

  if (isFxBusLauncher) return "fxbus";

  const isResetLauncher = candidates.some((value) => {
    return (
      value === RESET_LAUNCHER_CONTROL_NAME ||
      value === "reset all fx" ||
      value === "fx bus - reset all fx"
    );
  });

  if (isResetLauncher) return "reset";

  return null;
}

function shouldIgnoreRepeatedStandaloneLaunch() {
  /**
   * Large comment:
   * Pointer, mouse, and click events can all fire for the same toolbar
   * interaction. Debounce them so the FX Bus panel opens or resets only once.
   */
  const now = performance.now();

  if (now - lastStandaloneLaunchAt < 200) return true;

  lastStandaloneLaunchAt = now;
  return false;
}

function restoreSnapshotControl(snapshot) {
  /**
   * Large comment:
   * Restore the native Foundry control that was active when the standalone
   * launcher was clicked.
   */
  if (snapshot?.control === "tiles") {
    restoreControlToolSoon("tiles", SELECT_TOOL);
    return;
  }

  if (snapshot?.control === "token") {
    restoreControlToolSoon("token", SELECT_TOOL);
    return;
  }

  restoreControlToolSoon("token", SELECT_TOOL);
}

function handleStandaloneLauncherEvent(event) {
  /**
   * Large comment:
   * Intercept clicks on FX Bus standalone top-level icons before Foundry changes
   * active canvas control.
   *
   * This is the main Tile._refreshState fix:
   * - do not let Foundry activate a custom FX Bus control from Tiles
   * - retain the current native control
   * - open the matching FX Bus panel category or reset all FX
   */
  if (!game?.user?.isGM) return false;

  const kind = getStandaloneLauncherKind(event.target);
  if (!kind) return false;

  const snapshot = getContextualLaunchSnapshot();

  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();

  if (shouldIgnoreRepeatedStandaloneLaunch()) return true;

  if (kind === "fxbus") {
    const category = getCategoryForControl(snapshot.control);

    try {
      console.debug("[FX Bus] Contextual standalone launcher", {
        fromControl: snapshot.control,
        openCategory: category
      });
    } catch {
      // ignore
    }

    try {
      openPanel({ startCategory: category });
    } catch (err) {
      console.error("[FX Bus] Failed to open contextual standalone launcher.", err);
    }

    restoreSnapshotControl(snapshot);
    return true;
  }

  if (kind === "reset") {
    try {
      console.debug("[FX Bus] Standalone Reset All FX launcher", {
        fromControl: snapshot.control
      });
    } catch {
      // ignore
    }

    try {
      resetAll();
    } catch (err) {
      console.error("[FX Bus] Failed to run standalone Reset All FX.", err);
    }

    restoreSnapshotControl(snapshot);
    return true;
  }

  return false;
}

function installStandaloneLauncherGuard() {
  /**
   * Large comment:
   * Install capture-phase document listeners which convert FX Bus standalone
   * icons into launchers instead of Foundry layer switches.
   *
   * This lets users click FX Bus or Reset All FX from Tokens or Tiles while
   * preserving the current native selection tool.
   */
  const key = "__fxbusStandaloneLauncherGuard";
  const prev = globalThis[key];

  if (prev) {
    try {
      document.removeEventListener("pointerdown", prev, true);
      document.removeEventListener("mousedown", prev, true);
      document.removeEventListener("click", prev, true);
    } catch {
      // ignore
    }
  }

  const guard = (event) => {
    try {
      captureCurrentNativeControlSnapshot();
      handleStandaloneLauncherEvent(event);
    } catch (err) {
      console.warn("[FX Bus] Standalone launcher guard failed.", err);
    }
  };

  globalThis[key] = guard;

  document.addEventListener("pointerdown", guard, true);
  document.addEventListener("mousedown", guard, true);
  document.addEventListener("click", guard, true);
}

function makeHiddenSafeTool(name, title, icon) {
  /**
   * Large comment:
   * Provide an inert hidden tool for a standalone launcher control.
   *
   * Ideally this tool is never reached when clicking the top-level standalone
   * icon because the capture guard intercepts that click first. It remains here
   * as a defensive valid activeTool for Foundry's controls model.
   */
  return {
    name,
    title,
    icon,
    button: false,
    visible: true,
    toggle: false,

    onClick: () => {
      // intentionally inert
    },

    onChange: () => {
      // intentionally inert
    }
  };
}

function makePassiveButtonTool({
  name,
  title,
  icon = "fas fa-bolt",
  restoreControl,
  restoreTool,
  run
}) {
  /**
   * Large comment:
   * Create a passive toolbar button.
   *
   * Prefer onClick so Foundry treats this as a button action rather than a
   * persistent active scene tool. Keep onChange as a compatibility fallback for
   * Foundry/control payloads that still invoke scene-control buttons through
   * activation.
   */
  let handledAt = 0;

  const handle = () => {
    const now = performance.now();

    if (now - handledAt < 100) return;
    handledAt = now;

    try {
      run();
    } finally {
      if (restoreControl && restoreTool) {
        restoreControlToolSoon(restoreControl, restoreTool);
      }
    }
  };

  return {
    name,
    title,
    icon,
    button: true,
    visible: true,
    toggle: false,

    onClick: (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      handle();
    },

    onChange: (_event, active) => {
      if (!active) return;
      handle();
    }
  };
}

function makeLauncherToolsArray(idleToolName, title, icon) {
  return [
    makeHiddenSafeTool(idleToolName, title, icon)
  ];
}

function makeLauncherToolsObject(idleToolName, title, icon) {
  const tool = makeHiddenSafeTool(idleToolName, title, icon);

  return {
    [tool.name]: tool
  };
}

function makeStandaloneLauncherControlForCurrentShape({
  controls,
  name,
  title,
  icon,
  idleTool
}) {
  /**
   * Large comment:
   * Create a standalone left-toolbar launcher control.
   *
   * The top-level icon is intercepted by the capture guard before Foundry
   * changes layers. The fallback layer remains Token because it is a real native
   * layer and avoids requiring any custom FX Bus canvas layer registration.
   */
  const arrayShape = Array.isArray(controls);

  return {
    name,
    title,
    icon,
    layer: FALLBACK_LAYER_NAME,
    visible: true,
    activeTool: idleTool,
    tools: arrayShape
      ? makeLauncherToolsArray(idleTool, title, icon)
      : makeLauncherToolsObject(idleTool, title, icon)
  };
}

function addTokenControlTools(controls) {
  /**
   * Large comment:
   * Add one FX Bus lightning-bolt button to the native Token controls.
   */
  const control = findControl(controls, TOKEN_CONTROL_NAMES);
  if (!control) return;

  removeToolsNamed(control, FXBUS_TOOL_NAMES);

  addTool(
    control,
    makePassiveButtonTool({
      name: "fxbus-token",
      title: "FX Bus - Token FX",
      icon: "fas fa-bolt",
      restoreControl: "token",
      restoreTool: SELECT_TOOL,
      run: () => {
        openPanel({ startCategory: "token" });
      }
    })
  );
}

function addTileControlTools(controls) {
  /**
   * Large comment:
   * Add one FX Bus lightning-bolt button to the native Tiles controls.
   */
  const control = findControl(controls, TILE_CONTROL_NAMES);
  if (!control) return;

  removeToolsNamed(control, FXBUS_TOOL_NAMES);

  addTool(
    control,
    makePassiveButtonTool({
      name: "fxbus-tile",
      title: "FX Bus - Tile FX",
      icon: "fas fa-bolt",
      restoreControl: "tiles",
      restoreTool: SELECT_TOOL,
      run: () => {
        openPanel({ startCategory: "tile" });
      }
    })
  );
}

function addStandaloneLauncherControls(controls) {
  /**
   * Large comment:
   * Add standalone FX Bus launchers to the left toolbar.
   *
   * Order matters for array-shaped controls: Reset All FX is added immediately
   * after FX Bus so it appears below it in the toolbar.
   */
  addTopLevelControl(
    controls,
    makeStandaloneLauncherControlForCurrentShape({
      controls,
      name: FXBUS_LAUNCHER_CONTROL_NAME,
      title: "FX Bus",
      icon: "fas fa-bolt",
      idleTool: FXBUS_IDLE_TOOL
    })
  );

  addTopLevelControl(
    controls,
    makeStandaloneLauncherControlForCurrentShape({
      controls,
      name: RESET_LAUNCHER_CONTROL_NAME,
      title: "Reset All FX",
      icon: "fas fa-ban",
      idleTool: RESET_IDLE_TOOL
    })
  );
}

export function registerFxBusSceneControls() {
  /**
   * Large comment:
   * Register FX Bus toolbar controls.
   *
   * Final layout:
   * - Native Token controls get one FX Bus bolt for Token FX.
   * - Native Tiles controls get one FX Bus bolt for Tile FX.
   * - Standalone FX Bus icon acts as a contextual launcher and preserves the
   *   current native Foundry control.
   * - Standalone Reset All FX icon sits below FX Bus and resets all active FX.
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

    removeTopLevelControlsNamed(controls, STALE_TOP_LEVEL_CONTROL_NAMES);

    addTokenControlTools(controls);
    addTileControlTools(controls);
    addStandaloneLauncherControls(controls);
  };

  globalThis[key] = fn;
  Hooks.on(HOOK_ID, fn);

  installStandaloneLauncherGuard();
}