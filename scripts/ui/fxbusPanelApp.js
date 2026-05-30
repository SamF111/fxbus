// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\fxbusPanelApp.js

/**
 * FX Bus - GM Control Panel App (Foundry v13+)
 *
 * Purpose:
 * - Render the GM-only FX Bus control panel.
 * - Load tab templates as Handlebars partials.
 * - Present effects through grouped GUI categories.
 * - Wire each tab definition to the rendered form.
 * - Persist panel field values per client.
 * - Persist active category and active tab per client.
 * - Support Copy to Macro through each tab's buildApplyPayload(root, runtime).
 * - Support custom tab macro source through buildMacroSource(root, runtime, options).
 * - Keep panel tab selection consistent with FX Bus panel navigation.
 *
 * Category selection behaviour:
 * - Token category activates Foundry's native Token select tool.
 * - Tile category activates Foundry's native Tile select tool.
 * - Screen category leaves the current Foundry selection mode alone.
 * - Canvas category leaves the current Foundry selection mode alone.
 * - Reset category leaves the current Foundry selection mode alone.
 *
 * GUI category rule:
 * - GUI category and implementation name are separate concepts.
 * - Existing internal names and action strings are preserved.
 * - screenRotate remains internally named screenRotate/rotate.
 * - screenRotate is presented in the GUI as Canvas > Roll.
 *
 * Current v14 stability decision:
 * - Token Tether is enabled.
 * - Token Tether does not use live token-summary hooks or MutationObserver logic.
 * - Token/tile targeting is read only when Apply, Toggle, or macro generation runs.
 *
 * DOM lifecycle:
 * - Foundry destroys the panel DOM on close.
 * - Tab handlers are rebound on every render.
 * - AbortController prevents stacked navigation listeners across re-renders.
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

function relabelTab(tabDef, label) {
  /**
   * Large comment:
   * Return the same tab definition with a GUI-only label override.
   *
   * This does not rename tab ids, files, action strings, socket actions, or effect
   * implementation names. It only changes the label presented in the panel.
   */
  return {
    ...tabDef,
    label
  };
}

function buildGroups() {
  /**
   * Large comment:
   * Build the grouped GUI model used by the GM panel.
   *
   * Category ids are presentation ids:
   * - token
   * - tile
   * - screen
   * - canvas
   * - reset
   *
   * Tab ids remain implementation-facing ids so existing tab definitions, DOM
   * selectors, macro builders, and action strings stay stable.
   */
  const tokenOsc = tokenOscTabDef();
  const tokenLaser = tokenLaserTabDef();
  const tokenRecoil = tokenRecoilTabDef();
  const tileOsc = tileOscTabDef();

  const screenShake = screenShakeTabDef();
  const screenPulse = screenPulseTabDef();
  const screenVignette = screenVignetteTabDef();
  const screenChromAb = screenChromAbTabDef();
  const screenNoise = screenNoiseTabDef();
  const screenBlur = screenBlurTabDef();
  const screenSmear = screenSmearTabDef();
  const screenStreak = screenStreakTabDef();
  const screenMonochrome = screenMonochromeTabDef();

  const screenRotate = relabelTab(screenRotateTabDef(), "Roll");

  return [
    {
      id: "token",
      label: "Token",
      tabs: [
        tokenOsc,
        relabelTab(tokenLaser, "Tether"),
        tokenRecoil
      ]
    },
    {
      id: "tile",
      label: "Tile",
      tabs: [
        tileOsc
      ]
    },
    {
      id: "screen",
      label: "Screen",
      tabs: [
        screenShake,
        screenPulse,
        screenVignette,
        screenChromAb,
        screenNoise,
        screenBlur,
        screenSmear,
        screenStreak,
        screenMonochrome
      ]
    },
    {
      id: "canvas",
      label: "Canvas",
      tabs: [
        screenRotate
      ]
    },
    {
      id: "reset",
      label: "Reset",
      tabs: [
        resetTabDef()
      ]
    }
  ];
}

function flattenGroups(groups) {
  /**
   * Large comment:
   * Flatten all grouped tab definitions into a single list for legacy operations.
   *
   * Existing code paths such as tab wiring and tab-id lookup are still easier and
   * safer against current tab implementations when backed by a flat list.
   */
  return groups.flatMap((group) => group.tabs);
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
   *
   * Internal navigation state keys are ignored because they are not form fields.
   */
  for (const [name, value] of Object.entries(state ?? {})) {
    if (String(name).startsWith("__")) continue;

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

function getGroupById(groups, categoryId) {
  const id = String(categoryId ?? "");
  if (!id) return null;
  return groups.find((group) => group?.id === id) ?? null;
}

function getTabDefById(app, tabId) {
  /**
   * Large comment:
   * Resolve a tab definition from the app's flattened tab list.
   *
   * This centralises tab lookup so macro export and any future tab-level metadata
   * can share the same lookup logic.
   */
  const id = String(tabId ?? "");
  if (!id) return null;

  return app?._tabs?.find?.((t) => t?.id === id) ?? null;
}

function getTabDefInCategory(app, categoryId, tabId) {
  /**
   * Large comment:
   * Resolve a tab definition from one category.
   *
   * This prevents duplicate tab ids in future categories from accidentally
   * targeting the wrong tab. Current tab ids are unique, but the grouped model
   * should still be category-aware.
   */
  const group = getGroupById(app?._groups ?? [], categoryId);
  if (!group) return null;

  const id = String(tabId ?? "");
  if (!id) return null;

  return group.tabs.find((tab) => tab?.id === id) ?? null;
}

function getFirstTabIdForCategory(groups, categoryId) {
  const group = getGroupById(groups, categoryId);
  return group?.tabs?.[0]?.id ?? null;
}

function findCategoryForTab(groups, tabId) {
  /**
   * Large comment:
   * Resolve the first category containing a tab id.
   *
   * This maintains backward compatibility with old calls that only pass startTab.
   * For example:
   * - openFxBusGmControlPanel({ startTab: "pulse" })
   *
   * New calls should prefer:
   * - openFxBusGmControlPanel({ startCategory: "screen", startTab: "pulse" })
   */
  const id = String(tabId ?? "");
  if (!id) return null;

  for (const group of groups) {
    if (group.tabs.some((tab) => tab?.id === id)) return group.id;
  }

  return null;
}

function normaliseRequestedPanelState(groups, requestedCategory, requestedTab, rememberedCategory, rememberedTab) {
  /**
   * Large comment:
   * Resolve the active category and tab for a render.
   *
   * Priority:
   * 1. Explicit startCategory/startTab supplied by toolbar or caller.
   * 2. Remembered __activeCategory/__activeTab from client settings.
   * 3. Token category and its first tab.
   *
   * Invalid combinations are corrected by falling back to the first tab in the
   * selected category.
   */
  let category =
    typeof requestedCategory === "string" && requestedCategory.length
      ? requestedCategory
      : null;

  let tab =
    typeof requestedTab === "string" && requestedTab.length
      ? requestedTab
      : null;

  if (!category && tab) {
    category = findCategoryForTab(groups, tab);
  }

  if (!category) {
    category =
      typeof rememberedCategory === "string" && rememberedCategory.length
        ? rememberedCategory
        : null;
  }

  if (!tab) {
    tab =
      typeof rememberedTab === "string" && rememberedTab.length
        ? rememberedTab
        : null;
  }

  if (!getGroupById(groups, category)) {
    category = "token";
  }

  if (!getGroupById(groups, category)) {
    category = groups[0]?.id ?? null;
  }

  if (!category) {
    return {
      category: null,
      tab: null
    };
  }

  const group = getGroupById(groups, category);
  const tabExistsInCategory = group?.tabs?.some?.((entry) => entry?.id === tab);

  if (!tabExistsInCategory) {
    tab = getFirstTabIdForCategory(groups, category);
  }

  return {
    category,
    tab
  };
}

function decorateGroupsForContext(groups, activeCategory) {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    active: group.id === activeCategory
  }));
}

function decorateTabsForContext(group, activeTab) {
  return (group?.tabs ?? []).map((tab) => ({
    id: tab.id,
    label: tab.label,
    active: tab.id === activeTab
  }));
}

function setActivePanelState(root, categoryId, tabId) {
  /**
   * Large comment:
   * Manual grouped-tab controller.
   *
   * Foundry's ApplicationV2 tab helpers are intentionally avoided here. The panel
   * owns category and tab selection by toggling active classes and deterministic
   * display state.
   */
  const category = String(categoryId ?? "");
  const tab = String(tabId ?? "");

  const categoryItems = Array.from(
    root.querySelectorAll(".fxbus-category-tab[data-category]")
  );

  const navItems = Array.from(
    root.querySelectorAll(".tabs[data-group='fxbus'] .item[data-tab]")
  );

  const panels = Array.from(
    root.querySelectorAll(".tab[data-group='fxbus'][data-category][data-tab]")
  );

  for (const a of categoryItems) {
    const isActive = a.dataset.category === category;
    a.classList.toggle("active", isActive);
    a.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const a of navItems) {
    const isActive = a.dataset.category === category && a.dataset.tab === tab;
    a.classList.toggle("active", isActive);
    a.setAttribute("aria-selected", isActive ? "true" : "false");
  }

  for (const s of panels) {
    const isActive = s.dataset.category === category && s.dataset.tab === tab;
    s.classList.toggle("active", isActive);
    s.style.display = isActive ? "" : "none";
  }
}

function renderSubTabs(root, app) {
  /**
   * Large comment:
   * Rebuild the sub-tab row for the current category without forcing a full
   * ApplicationV2 render.
   *
   * The tab content sections are static in fxbus-panel.hbs; only the visible
   * sub-tab navigation needs to change when a category is clicked.
   */
  const nav = root.querySelector(".tabs[data-group='fxbus'].fxbus-subtabs");
  if (!nav) return;

  const group = getGroupById(app._groups, app._activeCategory);
  const tabs = group?.tabs ?? [];

  nav.innerHTML = "";

  for (const tab of tabs) {
    const a = document.createElement("a");
    a.className = "item fxbus-subtab";
    a.dataset.group = "fxbus";
    a.dataset.category = app._activeCategory;
    a.dataset.tab = tab.id;
    a.setAttribute("aria-selected", tab.id === app._activeTab ? "true" : "false");
    a.textContent = tab.label;

    if (tab.id === app._activeTab) a.classList.add("active");

    nav.appendChild(a);
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

function selectionLayerForCategory(categoryId) {
  /**
   * Large comment:
   * Resolve the native Foundry selection layer implied by a top-level FX Bus
   * category.
   *
   * This is intentionally category-level behaviour:
   * - Token category means token selection is appropriate.
   * - Tile category means tile selection is appropriate.
   * - Screen, Canvas, and Reset do not require native selection changes.
   */
  const id = String(categoryId ?? "");

  if (id === "token") return "tokens";
  if (id === "tile") return "tiles";

  return null;
}

async function activateCategorySelectionMode(categoryId) {
  /**
   * Large comment:
   * Activate native Foundry selection based on the active FX Bus category.
   *
   * Category-level switching is deliberate. Opening Token FX should prepare token
   * selection. Opening Tile FX should prepare tile selection. Screen and Canvas
   * effects should not steal native Foundry selection mode.
   */
  const selectionLayer = selectionLayerForCategory(categoryId);
  if (!selectionLayer) return;

  await activateNativeSelectionLayer(selectionLayer);
}

async function commitPanelNavigation(app, root, categoryId, tabId, options = {}) {
  /**
   * Large comment:
   * Commit a category/tab navigation change.
   *
   * This updates the app instance state, rebuilds sub-tabs if required, updates
   * visible panels, activates native category selection if needed, and persists
   * the new active category/tab pair.
   */
  const previousCategory = app._activeCategory;

  app._activeCategory = categoryId;
  app._activeTab = tabId;

  if (options.rebuildSubTabs || previousCategory !== categoryId) {
    renderSubTabs(root, app);
  }

  setActivePanelState(root, app._activeCategory, app._activeTab);

  await activateCategorySelectionMode(app._activeCategory);

  await writeState({
    __activeCategory: app._activeCategory,
    __activeTab: app._activeTab
  });
}

function wireCategoryClicks(app, root, abortSignal) {
  /**
   * Large comment:
   * Wire left-rail category navigation.
   *
   * A category click keeps the current active tab only if that tab exists in the
   * new category. Otherwise it switches to the first tab in the selected category.
   */
  const nav = root.querySelector(".fxbus-category-rail");
  if (!nav) return;

  nav.addEventListener(
    "click",
    async (event) => {
      const a = event.target?.closest?.(".fxbus-category-tab[data-category]");
      if (!a) return;

      event.preventDefault();

      const categoryId = String(a.dataset.category ?? "");
      if (!categoryId) return;

      const group = getGroupById(app._groups, categoryId);
      if (!group) return;

      const currentTabExists = group.tabs.some((tab) => tab?.id === app._activeTab);
      const tabId = currentTabExists
        ? app._activeTab
        : group.tabs[0]?.id;

      if (!tabId) return;

      await commitPanelNavigation(app, root, categoryId, tabId, {
        rebuildSubTabs: true
      });
    },
    { capture: true, signal: abortSignal }
  );
}

function wireSubTabClicks(app, root, abortSignal) {
  /**
   * Large comment:
   * Wire effect sub-tab navigation for the currently selected category.
   *
   * Because the sub-tab row is rebuilt when categories change, event delegation
   * is attached to the stable nav container rather than individual anchors.
   */
  const nav = root.querySelector(".tabs[data-group='fxbus'].fxbus-subtabs");
  if (!nav) return;

  nav.addEventListener(
    "click",
    async (event) => {
      const a = event.target?.closest?.(".item[data-tab]");
      if (!a) return;

      event.preventDefault();

      const categoryId = String(a.dataset.category ?? app._activeCategory ?? "");
      const tabId = String(a.dataset.tab ?? "");

      if (!categoryId || !tabId) return;

      const tabDef = getTabDefInCategory(app, categoryId, tabId);
      if (!tabDef) return;

      await commitPanelNavigation(app, root, categoryId, tabId, {
        rebuildSubTabs: false
      });
    },
    { capture: true, signal: abortSignal }
  );
}

function getActiveTabDef(app) {
  const categoryId = String(app?._activeCategory ?? "");
  const tabId = String(app?._activeTab ?? "");

  if (!categoryId || !tabId) return null;

  return getTabDefInCategory(app, categoryId, tabId) ?? getTabDefById(app, tabId);
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
    position: { width: 680, height: "auto" },
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

    this._groups = buildGroups();
    this._tabs = flattenGroups(this._groups);
    this._state = {};

    this._activeCategory = "token";
    this._activeTab = "osc";

    this._requestedStartCategory =
      typeof options?.startCategory === "string" ? options.startCategory : null;

    this._requestedStartTab =
      typeof options?.startTab === "string" ? options.startTab : null;

    this._tabAbort = null;
  }

  setRequestedStart(categoryId, tabId) {
    this._requestedStartCategory =
      typeof categoryId === "string" && categoryId.length ? categoryId : null;

    this._requestedStartTab =
      typeof tabId === "string" && tabId.length ? tabId : null;
  }

  setRequestedStartTab(tabId) {
    /**
     * Large comment:
     * Backward-compatible shim for older callers.
     *
     * Old controls.js called setRequestedStartTab(tabId). The grouped GUI now
     * prefers setRequestedStart(categoryId, tabId), but keeping this method makes
     * the panel tolerant while controls.js is refactored.
     */
    this.setRequestedStart(null, tabId);
  }

  async _prepareContext(_options) {
    await preloadFxBusTemplates();

    this._state = readState();

    const rememberedCategory =
      typeof this._state.__activeCategory === "string"
        ? this._state.__activeCategory
        : null;

    const rememberedTab =
      typeof this._state.__activeTab === "string"
        ? this._state.__activeTab
        : null;

    const resolved = normaliseRequestedPanelState(
      this._groups,
      this._requestedStartCategory,
      this._requestedStartTab,
      rememberedCategory,
      rememberedTab
    );

    this._activeCategory = resolved.category ?? "token";
    this._activeTab = resolved.tab ?? "osc";

    this._requestedStartCategory = null;
    this._requestedStartTab = null;

    const activeGroup = getGroupById(this._groups, this._activeCategory);

    return {
      groups: decorateGroupsForContext(this._groups, this._activeCategory),
      activeCategory: this._activeCategory,
      activeTabs: decorateTabsForContext(activeGroup, this._activeTab),
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
    renderSubTabs(root, this);
    setActivePanelState(root, this._activeCategory, this._activeTab);

    /**
     * Large comment:
     * Keep direct panel opens consistent with category behaviour.
     *
     * Direct opens from scene-control buttons set _requestedStartCategory and/or
     * _requestedStartTab, which become the active panel state during
     * _prepareContext(). Category-level selection then prepares Token or Tile
     * selection where appropriate.
     */
    activateCategorySelectionMode(this._activeCategory).catch((err) => {
      console.warn("[FX Bus] Initial category selection-layer activation failed.", {
        categoryId: this._activeCategory,
        err
      });
    });

    try {
      this._tabAbort?.abort?.();
    } catch {
      // ignore
    }

    this._tabAbort = new AbortController();
    wireCategoryClicks(this, root, this._tabAbort.signal);
    wireSubTabClicks(this, root, this._tabAbort.signal);
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
    panelSingleton = new FxBusGmControlPanelApp({
      startCategory: options.startCategory,
      startTab: options.startTab
    });
  }

  panelSingleton.setRequestedStart(options.startCategory, options.startTab);

  await panelSingleton.render(true);
}