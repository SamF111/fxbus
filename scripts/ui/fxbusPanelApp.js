// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\fxbusPanelApp.js

/**
 * FX Bus - GM Control Panel App (Foundry v13+)
 * Option A: tab HTML is Handlebars partials inside fxbus-panel.hbs
 *
 * Manual tab controller (no TabsUx).
 *
 * Reopen fix:
 * - Foundry destroys DOM on close; next render gets a new DOM.
 * - Re-bind tab handlers on every render.
 * - Use AbortController to prevent stacked listeners across re-renders.
 *
 * Notes:
 * - Ensure TAB_PARTIALS includes any new tab templates so partials are resolvable.
 * - Ensure buildTabs() includes the matching tabDef so wiring occurs.
 */

import { tokenOscTabDef } from "./tabs/tokenOscTab.js";
import { screenShakeTabDef } from "./tabs/screenShakeTab.js";
import { screenPulseTabDef } from "./tabs/screenPulseTab.js";
import { screenVignetteTabDef } from "./tabs/screenVignetteTab.js";
import { screenChromAbTabDef } from "./tabs/screenChromAbTab.js";
import { screenNoiseTabDef } from "./tabs/screenNoiseTab.js";
import { screenBlurTabDef } from "./tabs/screenBlurTab.js";
import { screenSmearTabDef } from "./tabs/screenSmearTab.js";
import { screenStreakTabDef } from "./tabs/screenStreakTab.js";

const MODULE_ID = "fxbus";
const UI_STATE_KEY = "uiState";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { loadTemplates, getTemplate } = foundry.applications.handlebars;

const TAB_PARTIALS = [
  `modules/${MODULE_ID}/templates/tabs/tokenOscTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenShakeTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenPulseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenVignetteTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenChromAbTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenNoiseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenBlurTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenSmearTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenStreakTab.hbs`
];

let TEMPLATES_PRELOADED = false;

function templatePathToPartialName(path) {
  const file = String(path).split("/").pop() ?? "";
  return file.replace(/\.hbs$/i, "");
}

async function preloadFxBusTemplates() {
  if (TEMPLATES_PRELOADED) return;

  await loadTemplates(TAB_PARTIALS);

  for (const path of TAB_PARTIALS) {
    const partialName = templatePathToPartialName(path);
    const templateFn = await getTemplate(path);
    Handlebars.registerPartial(partialName, templateFn);
  }

  TEMPLATES_PRELOADED = true;
}

function buildTabs() {
  return [
    tokenOscTabDef(),
    screenShakeTabDef(),
    screenPulseTabDef(),
    screenVignetteTabDef(),
    screenChromAbTabDef(),
    screenNoiseTabDef(),
    screenBlurTabDef(),
    screenSmearTabDef(),
    screenStreakTabDef()
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

/**
 * Manual tab controller - toggles both nav and content.
 * Visibility is ultimately enforced by CSS (tab.active), but we also set display
 * to be robust against theme variance.
 */
function setActiveTab(root, tabId) {
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

/**
 * Bind tab clicks to the current DOM root.
 * AbortController prevents stacking listeners across re-renders.
 */
function wireTabClicks(app, root, abortSignal) {
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
      await writeState({ __activeTab: tabId });
    },
    { capture: true, signal: abortSignal }
  );
}

class FxBusGmControlPanelApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fxbus-gm-control-panel",
    tag: "div",
    classes: ["fxbus-panel-app"],
    window: { title: "FX Bus - GM Control Panel", resizable: true },
    position: { width: 560, height: "auto" },
    actions: { fxbusDoReset: FxBusGmControlPanelApp._actionDoReset }
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
    const fallbackTab = this._tabs[0]?.id ?? "osc";
    this._activeTab = requestedTab ?? rememberedTab ?? fallbackTab;

    this._requestedStartTab = null;

    return {
      tabs: this._tabs.map((t) => ({ id: t.id, label: t.label })),
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
