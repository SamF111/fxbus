// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\fxbusPanelApp.js

/**
 * FX Bus - GM Control Panel App (Foundry v13+)
 *
 * Purpose:
 * - Render the GM-only FX Bus control panel.
 * - Load tab templates as Handlebars partials.
 * - Wire each tab definition to the rendered form.
 * - Persist panel field values per client.
 * - Support Copy to Macro through each tab's buildApplyPayload(root, runtime).
 * - Support custom tab macro source through buildMacroSource(root, runtime, options).
 * - Keep panel tab selection consistent with FX Bus panel navigation.
 *
 * Selection-layer behaviour:
 * - Each tab may declare selectionLayer: "tokens", "tiles", or null.
 * - Token Oscillation should declare "tokens".
 * - Token Tether should declare "tokens".
 * - Token Recoil should declare "tokens".
 * - Tile Oscillation should declare "tiles".
 * - Screen FX tabs omit selectionLayer or set it to null.
 * - The panel activates the declared native Foundry selection layer when opened
 *   directly onto a tab or when a tab is clicked inside the panel.
 *
 * Current v14 stability decision:
 * - Token Tether is enabled.
 * - Token Tether does not use live token-summary hooks or MutationObserver logic.
 * - Token/tile targeting is read only when Apply, Toggle, or macro generation runs.
 *
 * Tab requirements:
 * - Add the tab definition import.
 * - Add the tab template path to TAB_PARTIALS.
 * - Add the tab definition to buildTabs().
 * - Add the tab section to fxbus-panel.hbs.
 * - Add data-action="fxbusCopyToMacro" in the tab template when macro export is wanted.
 * - Add selectionLayer to the tab definition when the tab needs a native selection layer.
 *
 * DOM lifecycle:
 * - Foundry destroys the panel DOM on close.
 * - Tab handlers are rebound on every render.
 * - AbortController prevents stacked tab-navigation listeners across re-renders.
 */

import { tokenOscTabDef } from "./tabs/tokenOscTab.js";
import { tokenLaserTabDef } from "./tabs/tokenLaserTab.js";
import { tokenRecoilTabDef } from "./tabs/tokenRecoilTab.js";
import { tileOscTabDef } from "./tabs/tileOscTab.js";
import { screenShakeTabDef } from "./tabs/screenShakeTab.js";
import { screenRotateTabDef } from "./tabs/screenRotateTab.js";
import { screenPulseTabDef } from "./tabs/screenPulseTab.js";
import { screenVignetteTabDef } from "./tabs/screenVignetteTab.js";
import { screenChromAbTabDef } from "./tabs/screenChromAbTab.js";
import { screenNoiseTabDef } from "./tabs/screenNoiseTab.js";
import { screenBlurTabDef } from "./tabs/screenBlurTab.js";
import { screenSmearTabDef } from "./tabs/screenSmearTab.js";
import { screenStreakTabDef } from "./tabs/screenStreakTab.js";
import { screenMonochromeTabDef } from "./tabs/screenMonochromeTab.js";
import { resetTabDef } from "./tabs/resetTab.js";

import {
  fxbusBuildMacroSource,
  fxbusCopyTextToClipboard
} from "../util/fxbusMacroUtils.js";

const MODULE_ID = "fxbus";
const UI_STATE_KEY = "uiState";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { loadTemplates, getTemplate } = foundry.applications.handlebars;

const TAB_PARTIALS = [
  `modules/${MODULE_ID}/templates/tabs/tokenOscTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tokenLaserTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tokenRecoilTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tileOscTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenShakeTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenRotateTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenPulseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenVignetteTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenChromAbTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenNoiseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenBlurTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenSmearTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenStreakTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenMonochromeTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/resetTab.hbs`
];

let TEMPLATES_PRELOADED = false;

function templatePathToPartialName(path) {
  const file = String(path).split("/").pop() ?? "";
  return file.replace(/\.hbs$/i, "");
}

async function preloadFxBusTemplates() {
  /**
   * Large comment:
   * Preload every enabled tab template and register each one as a Handlebars partial.
   *
   * Both names are registered:
   * - Short partial name, for example "tileOscTab"
   * - Full module path, for example "modules/fxbus/templates/tabs/tileOscTab.hbs"
   *
   * This lets fxbus-panel.hbs use either include style safely.
   */
  if (TEMPLATES_PRELOADED) return;

  await loadTemplates(TAB_PARTIALS);

  for (const path of TAB_PARTIALS) {
    const partialName = templatePathToPartialName(path);
    const templateFn = await getTemplate(path);

    Handlebars.registerPartial(partialName, templateFn);
    Handlebars.registerPartial(path, templateFn);
  }

  TEMPLATES_PRELOADED = true;
}

function buildTabs() {
  /**
   * Large comment:
   * Build the enabled tab definition list used by the GM panel.
   *
   * Each tab definition is responsible for:
   * - id
   * - label
   * - wire(root, runtime)
   * - optional selectionLayer: "tokens", "tiles", or null
   * - optional buildApplyPayload(root, runtime) for generic Copy to Macro
   * - optional buildMacroSource(root, runtime, options) for custom Copy to Macro
   */
  return [
    tokenOscTabDef(),
    tokenLaserTabDef(),
    tokenRecoilTabDef(),
    tileOscTabDef(),
    screenShakeTabDef(),
    screenRotateTabDef(),
    screenPulseTabDef(),
    screenVignetteTabDef(),
    screenChromAbTabDef(),
    screenNoiseTabDef(),
    screenBlurTabDef(),
    screenSmearTabDef(),
    screenStreakTabDef(),
    screenMonochromeTabDef(),
    resetTabDef()
  ];
}

function readState() {
  try {
    return game.settings.get(MODULE_ID, UI_STATE_KEY) ?? {};
  } catch (err) {
    console.warn("[FX Bus] uiState read failed", err);
    return {};
  }
}

async function writeState(patch) {
  try {
    const current = readState();
    const next = { ...current, ...patch };
    await game.settings.set(MODULE_ID, UI_STATE_KEY, next);
  } catch (err) {
    console.warn("[FX Bus] uiState write failed", err);
  }
}

function applyStateToForm(root, state) {
  /**
   * Large comment:
   * Reapply saved per-client form state after Foundry renders a fresh panel DOM.
   *
   * Values are matched by input name. This keeps field persistence generic and
   * avoids tab-specific persistence logic.
   */
  for (const [name, value] of Object.entries(state ?? {})) {
    const el = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) continue;

    if (el.type === "checkbox") {
      el.checked = Boolean(value);
      continue;
    }

    if (el.tagName === "SELECT") {
      el.value = String(value);
      continue;
    }

    el.value = String(value);
  }
}

function captureStateFromForm(root) {
  /**
   * Large comment:
   * Capture all named controls in the panel form into a plain settings object.
   *
   * This intentionally captures every tab, not just the active one, because
   * inactive tab panels are still present in the form DOM.
   */
  const elements = Array.from(root.querySelectorAll("[name]"));
  const state = {};

  for (const el of elements) {
    const name = el.getAttribute("name");
    if (!name) continue;

    if (el.type === "checkbox") {
      state[name] = Boolean(el.checked);
      continue;
    }

    if (el.type === "number") {
      const n = Number(el.value);
      state[name] = Number.isFinite(n) ? n : el.value;
      continue;
    }

    state[name] = el.value;
  }

  return state;
}

function wireStatePersistence(root) {
  /**
   * Large comment:
   * Debounce form-state writes so sliders, typing, and number edits do not spam
   * game.settings. This listener is attached to the current rendered form only.
   */
  let timer = null;

  const scheduleSave = () => {
    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      writeState(captureStateFromForm(root));
      timer = null;
    }, 150);
  };

  root.addEventListener("input", scheduleSave, true);
  root.addEventListener("change", scheduleSave, true);
}

function setActiveTab(root, tabId) {
  /**
   * Large comment:
   * Manual tab controller.
   *
   * Foundry's ApplicationV2 tab helpers are intentionally avoided here. The panel
   * owns tab selection by toggling active classes and deterministic display state.
   */
  const navItems = Array.from(
    root.querySelectorAll(".tabs[data-group='fxbus'] .item[data-tab]")
  );
  const panels = Array.from(
    root.querySelectorAll(".tab[data-group='fxbus'][data-tab]")
  );

  for (const a of navItems) {
    const isActive = a.dataset.tab === tabId;
    a.classList.toggle("active", isActive);
    a.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const s of panels) {
    const isActive = s.dataset.tab === tabId;
    s.classList.toggle("active", isActive);
    s.style.display = isActive ? "" : "none";
  }
}

function getSceneControlsCollection() {
  return ui?.controls?.controls ?? null;
}

function getNativeControl(controlNames) {
  /**
   * Large comment:
   * Resolve a native Foundry control group by likely names.
   *
   * Foundry versions may expose controls as either arrays or object maps. This
   * helper supports both without depending on controls.js exports.
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

    return Object.values(controls).find((control) => {
      return controlNames.includes(control?.name);
    }) ?? null;
  }

  return null;
}

function getNativeSelectToolName(control) {
  /**
   * Large comment:
   * Resolve the best native selection tool for a control group.
   *
   * Prefer "select". Fall back to the control's active tool. Fall back again to
   * the first named tool.
   */
  const tools = control?.tools;

  if (!tools) return "select";

  if (Array.isArray(tools)) {
    if (tools.some((tool) => tool?.name === "select")) return "select";

    if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
      return control.activeTool;
    }

    return tools.find((tool) => {
      return typeof tool?.name === "string" && tool.name.length > 0;
    })?.name ?? "select";
  }

  if (typeof tools === "object") {
    if (tools.select) return "select";

    if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
      return control.activeTool;
    }

    return Object.values(tools).find((tool) => {
      return typeof tool?.name === "string" && tool.name.length > 0;
    })?.name ?? "select";
  }

  return "select";
}

async function activateNativeSelectionLayer(selectionLayer) {
  /**
   * Large comment:
   * Activate native Foundry Token/Tiles selection from the panel without relying
   * on controls.js.
   *
   * This intentionally uses Foundry's native SceneControls activation. It may
   * move the left toolbar to Tokens or Tiles; that is the accepted workflow for
   * real token/tile selection.
   */
  const layer = String(selectionLayer ?? "");
  if (!layer) return false;

  const controlsUi = ui?.controls;

  if (!controlsUi || typeof controlsUi.activate !== "function") {
    ui.notifications.warn("FX Bus: native controls API unavailable.");
    return false;
  }

  const control =
    layer === "tokens"
      ? getNativeControl(["tokens", "token"])
      : layer === "tiles"
        ? getNativeControl(["tiles", "tile"])
        : null;

  if (!control?.name) {
    ui.notifications.warn(`FX Bus: could not find native ${layer} controls.`);
    return false;
  }

  const toolName = getNativeSelectToolName(control);

  try {
    await controlsUi.activate({ control: control.name, tool: toolName });
    return true;
  } catch (err) {
    console.warn("[FX Bus] Native selection activation failed.", {
      selectionLayer: layer,
      controlName: control.name,
      toolName,
      err
    });

    ui.notifications.warn(`FX Bus: failed to activate ${layer} selection.`);
    return false;
  }
}

function getTabDefById(app, tabId) {
  /**
   * Large comment:
   * Resolve a tab definition from the app's tab list.
   *
   * This centralises tab lookup so selection-layer activation, macro export, and
   * any future tab-level metadata can share the same lookup logic.
   */
  const id = String(tabId ?? "");
  if (!id) return null;

  return app?._tabs?.find?.((t) => t?.id === id) ?? null;
}

async function activatePanelSelectionMode(app, tabId) {
  /**
   * Large comment:
   * Activate the native Foundry selection layer declared by the active tab.
   *
   * The tab owns this decision through tabDef.selectionLayer:
   * - "tokens" for token-based FX
   * - "tiles" for tile-based FX
   * - null/undefined for screen FX
   */
  const tabDef = getTabDefById(app, tabId);
  const selectionLayer = tabDef?.selectionLayer ?? null;

  if (!selectionLayer) return;

  await activateNativeSelectionLayer(selectionLayer);
}

function wireTabClicks(app, root, abortSignal) {
  /**
   * Large comment:
   * Wire panel tab navigation.
   *
   * Tab clicks change the visible panel tab and activate any native Foundry
   * selection layer declared by the clicked tab's metadata.
   */
  const nav = root.querySelector(".tabs[data-group='fxbus']");
  if (!nav) return;

  nav.addEventListener(
    "click",
    async (event) => {
      const a = event.target?.closest?.(".item[data-tab]");
      if (!a) return;

      event.preventDefault();

      const tabId = String(a.dataset.tab ?? "");
      if (!tabId) return;

      app._activeTab = tabId;
      setActiveTab(root, tabId);

      await activatePanelSelectionMode(app, tabId);
      await writeState({ __activeTab: tabId });
    },
    { capture: true, signal: abortSignal }
  );
}

function getActiveTabDef(app) {
  const tabId = String(app?._activeTab ?? "");
  if (!tabId) return null;

  return getTabDefById(app, tabId);
}

function getFxBusModuleVersion() {
  try {
    const mod = game.modules?.get?.(MODULE_ID);
    const v =
      mod?.version ??
      mod?.data?.version ??
      mod?.manifest?.version ??
      "";

    return String(v || "").trim() || null;
  } catch {
    return null;
  }
}

function getMacroMeta() {
  const generatedAt = new Date().toISOString();
  const generatedBy =
    String(game.user?.name ?? "").trim() ||
    String(game.user?.id ?? "").trim() ||
    null;

  const fxbusVersion = getFxBusModuleVersion();

  return {
    generatedAt,
    generatedBy,
    fxbusVersion
  };
}

function buildDefaultMacroName(tabDef, root, dateTag, timeTag) {
  /**
   * Large comment:
   * Resolve a useful macro name for both generic and custom macro builders.
   *
   * The tab may provide:
   * - macroName(root) function
   * - macroName string
   *
   * Otherwise a timestamped panel-derived name is used.
   */
  if (typeof tabDef?.macroName === "function") {
    return String(tabDef.macroName(root) ?? `FX Bus - ${tabDef.label}`);
  }

  if (typeof tabDef?.macroName === "string" && tabDef.macroName.length) {
    return tabDef.macroName;
  }

  return `FX Bus - ${tabDef.label} - ${dateTag} ${timeTag}`;
}

async function copyActiveTabApplyToClipboard(app, root, runtime) {
  /**
   * Large comment:
   * Build a macro from the active tab.
   *
   * Normal path:
   * - tabDef.buildApplyPayload(root, runtime)
   * - fxbusBuildMacroSource(...)
   *
   * Custom path:
   * - tabDef.buildMacroSource(root, runtime, options)
   *
   * The custom path exists for effects whose macro behaviour cannot safely be
   * represented by a static payload. Token Tether authoritative toggles are the
   * main example: the macro must decide start vs stop at run time using GM-local
   * state, then emit an explicit action to every client.
   */
  const tabDef = getActiveTabDef(app);

  if (!tabDef) {
    ui.notifications.error("FX Bus: active tab not found.");
    return;
  }

  const iso = new Date().toISOString();
  const dateTag = iso.slice(0, 10);
  const timeTag = iso.slice(11, 19).replace(/:/g, "-");
  const meta = getMacroMeta();

  const macroName = buildDefaultMacroName(tabDef, root, dateTag, timeTag);

  let macroSource = null;

  if (typeof tabDef.buildMacroSource === "function") {
    try {
      macroSource = tabDef.buildMacroSource(root, runtime, {
        macroName,
        meta,
        dateTag,
        timeTag
      });
    } catch (err) {
      ui.notifications.error("FX Bus: failed to build custom macro. See console.");
      console.error("[FX Bus] buildMacroSource failed", { tab: tabDef.id, err });
      return;
    }

    if (typeof macroSource !== "string" || macroSource.trim().length === 0) {
      ui.notifications.error("FX Bus: invalid custom macro source.");
      console.error("[FX Bus] Invalid macro source returned", {
        tab: tabDef.id,
        macroSource
      });
      return;
    }
  } else {
    const builder = tabDef.buildApplyPayload;

    if (typeof builder !== "function") {
      ui.notifications.error(
        `FX Bus: tab '${tabDef.id}' does not support Copy to Macro yet.`
      );
      console.error("[FX Bus] Missing buildApplyPayload on tabDef", tabDef);
      return;
    }

    let payload = null;

    try {
      payload = builder(root, runtime);
    } catch (err) {
      ui.notifications.error("FX Bus: failed to build macro payload. See console.");
      console.error("[FX Bus] buildApplyPayload failed", { tab: tabDef.id, err });
      return;
    }

    if (!payload || typeof payload !== "object") {
      ui.notifications.error("FX Bus: invalid macro payload.");
      console.error("[FX Bus] Invalid payload returned", {
        tab: tabDef.id,
        payload
      });
      return;
    }

    macroSource = fxbusBuildMacroSource(macroName, payload, {
      requireGM: true,
      meta
    });
  }

  try {
    await fxbusCopyTextToClipboard(macroSource);
    ui.notifications.info("FX Bus: macro copied to clipboard.");
  } catch (err) {
    ui.notifications.error("FX Bus: clipboard copy blocked. See console.");
    console.error("[FX Bus] Clipboard copy failed", err);
  }
}

class FxBusGmControlPanelApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fxbus-gm-control-panel",
    tag: "div",
    classes: ["fxbus-panel-app"],
    window: { title: "FX Bus - GM Control Panel", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      fxbusDoReset: FxBusGmControlPanelApp._actionDoReset,
      fxbusCopyToMacro: FxBusGmControlPanelApp._actionCopyToMacro
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/fxbus-panel.hbs` }
  };

  constructor(options = {}) {
    super(options);

    this._tabs = buildTabs();
    this._state = {};
    this._activeTab = "osc";
    this._requestedStartTab =
      typeof options?.startTab === "string" ? options.startTab : null;

    this._tabAbort = null;
  }

  setRequestedStartTab(tabId) {
    this._requestedStartTab =
      typeof tabId === "string" && tabId.length ? tabId : null;
  }

  async _prepareContext(_options) {
    await preloadFxBusTemplates();

    this._state = readState();

    const requestedTab = this._requestedStartTab;
    const rememberedTab =
      typeof this._state.__activeTab === "string" ? this._state.__activeTab : null;

    const normalTabs = this._tabs.filter((t) => t?.id !== "reset");
    const fallbackTab = normalTabs[0]?.id ?? "osc";

    this._activeTab = requestedTab ?? rememberedTab ?? fallbackTab;
    this._requestedStartTab = null;

    return {
      tabs: normalTabs.map((t) => ({ id: t.id, label: t.label })),
      activeTab: this._activeTab
    };
  }

  _onRender(_context, _options) {
    const runtime = globalThis.fxbus;
    const root = this.element?.querySelector?.("form.fxbus-panel");
    if (!root) return;

    applyStateToForm(root, this._state);

    for (const t of this._tabs) {
      try {
        t.wire(root, runtime);
      } catch (err) {
        console.error("[FX Bus] tab wire failed", { tab: t.id, err });
      }
    }

    wireStatePersistence(root);
    setActiveTab(root, this._activeTab);

    /**
     * Large comment:
     * Keep direct panel opens consistent with panel tab clicks.
     *
     * Direct opens from scene-control buttons set _requestedStartTab, which
     * becomes _activeTab during _prepareContext(). If that active tab declares a
     * native selectionLayer, activate it now.
     */
    activatePanelSelectionMode(this, this._activeTab).catch((err) => {
      console.warn("[FX Bus] Initial panel selection-layer activation failed.", {
        tabId: this._activeTab,
        err
      });
    });

    try {
      this._tabAbort?.abort?.();
    } catch {
      // ignore
    }

    this._tabAbort = new AbortController();
    wireTabClicks(this, root, this._tabAbort.signal);
  }

  async _onClose(_options) {
    try {
      this._tabAbort?.abort?.();
    } catch {
      // ignore
    }

    this._tabAbort = null;

    return super._onClose(_options);
  }

  static _actionDoReset(event, _target) {
    event.preventDefault();

    const runtime = globalThis.fxbus;
    if (!runtime?.emit) return;

    runtime.emit({ action: "fx.bus.reset" });
  }

  static async _actionCopyToMacro(event, _target) {
    event.preventDefault();

    const app = this;
    const runtime = globalThis.fxbus;
    const root = app.element?.querySelector?.("form.fxbus-panel");

    if (!root) return;

    if (!runtime?.emit) {
      ui.notifications.error("FX Bus runtime not found. Enable fxbus and reload.");
      return;
    }

    await copyActiveTabApplyToClipboard(app, root, runtime);
  }
}

let panelSingleton = null;

export async function openFxBusGmControlPanel(options = {}) {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;

  if (!runtime?.emit) {
    ui.notifications.error("FX Bus runtime not found. Enable fxbus and reload.");
    return;
  }

  if (!panelSingleton) {
    panelSingleton = new FxBusGmControlPanelApp({ startTab: options.startTab });
  }

  panelSingleton.setRequestedStartTab(options.startTab);

  await panelSingleton.render(true);
}