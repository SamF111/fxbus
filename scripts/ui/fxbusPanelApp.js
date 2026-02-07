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
 * Copy-to-macro support:
 * - Adds an Application action `fxbusCopyToMacro`.
 * - Expects the active tabDef to expose `buildApplyPayload(root, runtime)` returning a socket payload.
 * - Generates a macro script that emits that payload via the FX Bus runtime and copies it to clipboard.
 *
 * Notes:
 * - Ensure TAB_PARTIALS includes any new tab templates so partials are resolvable.
 * - Ensure buildTabs() includes the matching tabDef so wiring occurs.
 * - Add a button in your tab template with: data-action="fxbusCopyToMacro"
 * - Ensure each tabDef provides `buildApplyPayload` (and optionally `macroName`).
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
  `modules/${MODULE_ID}/templates/tabs/screenShakeTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenPulseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenVignetteTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenChromAbTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenNoiseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenBlurTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenSmearTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenStreakTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/resetTab.hbs`
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

    // Support both include styles:
    // - {{> "modules/fxbus/templates/tabs/whatever.hbs"}}
    // - {{> "whatever"}}
    // Some Foundry/template paths are resolved by full path, so register both keys.
    Handlebars.registerPartial(partialName, templateFn);
    Handlebars.registerPartial(path, templateFn);
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
    screenStreakTabDef(),
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

function getActiveTabDef(app) {
  const tabId = String(app?._activeTab ?? "");
  if (!tabId) return null;
  return app?._tabs?.find?.((t) => t?.id === tabId) ?? null;
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

async function copyActiveTabApplyToClipboard(app, root, runtime) {
  const tabDef = getActiveTabDef(app);
  if (!tabDef) {
    ui.notifications.error("FX Bus: active tab not found.");
    return;
  }

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
    console.error("[FX Bus] Invalid payload returned", { tab: tabDef.id, payload });
    return;
  }

  // Use date in the name, not just time. Keep filesystem-safe-ish for copy/paste.
  const iso = new Date().toISOString(); // 2026-02-07T13:56:32.123Z
  const dateTag = iso.slice(0, 10); // 2026-02-07
  const timeTag = iso.slice(11, 19).replace(/:/g, "-"); // 13-56-32

  const macroName =
    typeof tabDef.macroName === "function"
      ? String(tabDef.macroName(root) ?? `FX Bus - ${tabDef.label}`)
      : typeof tabDef.macroName === "string" && tabDef.macroName.length
        ? tabDef.macroName
        : `FX Bus - ${tabDef.label} - ${dateTag} ${timeTag}`;

  const macroSource = fxbusBuildMacroSource(macroName, payload, {
    requireGM: true,
    meta: getMacroMeta()
  });

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

    // Exclude "reset" from the normal tabs list (it is rendered as a separate red tab)
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
