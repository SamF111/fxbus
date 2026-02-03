/**
 * FX Bus - GM Control Panel App (Foundry v13+)
 *
 * Purpose:
 * - Provide a stable GM control panel using ApplicationV2 + HandlebarsApplicationMixin.
 * - Avoid Dialog/DialogV2 (V1) deprecation warnings.
 * - Reliable tab switching via AppV2 actions (data-action).
 * - Persist last-used values per-client via game.settings.
 *
 * Requirements:
 * - Template file exists at: modules/fxbus/templates/fxbus-panel.hbs
 * - Each tab module exports a *TabDef() that returns:
 *     {
 *       id: string,
 *       label: string,
 *       contentHtml(): string,
 *       wire(root: HTMLElement, runtime: object): void
 *     }
 */

import { tokenOscTabDef } from "./tabs/tokenOscTab.js";
import { screenShakeTabDef } from "./tabs/screenShakeTab.js";
import { screenPulseTabDef } from "./tabs/screenPulseTab.js";
import { screenVignetteTabDef } from "./tabs/screenVignetteTab.js";
import { screenChromAbTabDef } from "./tabs/screenChromAbTab.js";
import { screenNoiseTabDef } from "./tabs/screenNoiseTab.js";

const MODULE_ID = "fxbus";
const UI_STATE_KEY = "uiState";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function buildTabs() {
  return [
    tokenOscTabDef(),
    screenShakeTabDef(),
    screenPulseTabDef(),
    screenVignetteTabDef(),
    screenChromAbTabDef(),
    screenNoiseTabDef()
  ];
}

function readState() {
  /** Large comment:
   * Read per-client UI state. Never throw.
   */
  try {
    return game.settings.get(MODULE_ID, UI_STATE_KEY) ?? {};
  } catch (err) {
    console.warn("[FX Bus] uiState read failed", err);
    return {};
  }
}

async function writeState(patch) {
  /** Large comment:
   * Patch-merge UI state and persist it. Never throw.
   */
  try {
    const current = readState();
    const next = { ...current, ...patch };
    await game.settings.set(MODULE_ID, UI_STATE_KEY, next);
  } catch (err) {
    console.warn("[FX Bus] uiState write failed", err);
  }
}

function applyStateToForm(root, state) {
  /** Large comment:
   * Rehydrate form inputs from uiState.
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
  /** Large comment:
   * Snapshot all [name] fields so reopen uses last values.
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
  /** Large comment:
   * Debounced persistence on edits.
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

class FxBusGmControlPanelApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "fxbus-gm-control-panel",
    tag: "div",
    classes: ["fxbus-panel-app"],
    window: {
      title: "FX Bus - GM Control Panel",
      resizable: true
    },
    position: {
      width: 560,
      height: "auto"
    },
    actions: {
      fxbusSelectTab: FxBusGmControlPanelApp._actionSelectTab,
      fxbusDoReset: FxBusGmControlPanelApp._actionDoReset
    }
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/fxbus-panel.hbs`
    }
  };

  constructor(options = {}) {
    super(options);
    this._tabs = buildTabs();
    this._state = {};
    this._activeTab = "osc";
    this._requestedStartTab = typeof options?.startTab === "string" ? options.startTab : null;
  }

  setRequestedStartTab(tabId) {
    /** Large comment:
     * Store a one-shot requested tab for the next render.
     * Do not mutate ApplicationV2 options (effectively read-only in v13).
     */
    this._requestedStartTab = typeof tabId === "string" && tabId.length ? tabId : null;
  }

  async _prepareContext(_options) {
    /** Large comment:
     * Provide template data (tabs + html fragments).
     */
    this._state = readState();

    const requestedTab = this._requestedStartTab;
    const rememberedTab = typeof this._state.__activeTab === "string" ? this._state.__activeTab : null;
    const fallbackTab = this._tabs[0]?.id ?? "osc";
    this._activeTab = requestedTab ?? rememberedTab ?? fallbackTab;

    // One-shot consume.
    this._requestedStartTab = null;

    return {
      tabs: this._tabs.map((t) => ({ id: t.id, label: t.label })),
      panels: this._tabs.map((t) => ({ id: t.id, html: t.contentHtml() }))
    };
  }

  _onRender(_context, _options) {
    /** Large comment:
     * Post-render DOM wiring.
     */
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
    this._applyTabVisibility(root, this._activeTab);
  }

  _applyTabVisibility(root, tabId) {
    /** Large comment:
     * Deterministic tab switching using inline display.
     */
    const buttons = Array.from(root.querySelectorAll(".fxbus-tab-btn"));
    for (const b of buttons) b.classList.toggle("is-active", b.dataset.tab === tabId);

    const panels = Array.from(root.querySelectorAll('.fxbus-panel-section[data-fxbus-panel="1"]'));
    for (const p of panels) p.style.display = p.dataset.panel === tabId ? "" : "none";
  }

  static async _actionSelectTab(event, target) {
    /** Large comment:
     * AppV2 action: tab click.
     */
    event.preventDefault();

    const tabId = target?.dataset?.tab;
    if (typeof tabId !== "string" || tabId.length === 0) return;

    this._activeTab = tabId;

    const root = this.element?.querySelector?.("form.fxbus-panel");
    if (root) this._applyTabVisibility(root, tabId);

    await writeState({ __activeTab: tabId });
  }

  static _actionDoReset(event, _target) {
    /** Large comment:
     * AppV2 action: global reset.
     */
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

  if (!panelSingleton) panelSingleton = new FxBusGmControlPanelApp({ startTab: options.startTab });
  panelSingleton.setRequestedStartTab(options.startTab);

  await panelSingleton.render(true);
}
