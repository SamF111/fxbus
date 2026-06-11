// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\fxbusPanelApp.js

/**
 * FX Bus - GM Control Panel App (Foundry v13+)
 *
 * Purpose:
 * - Render the GM-only FX Bus control panel.
 * - Delegate panel registry, templates, state persistence, selection mode,
 *   navigation, macro copying, and diagnostics to focused panel modules.
 * - Wire each tab definition to the rendered form.
 * - Persist active category and active tab per client.
 *
 * DOM lifecycle:
 * - Foundry destroys the panel DOM on close.
 * - V13/V14 detached windows and PopOut-style DOM movement can cause re-renders.
 * - Every render owns one AbortController.
 * - Old render listeners are aborted before new listeners are attached.
 * - Every panel-level listener and every tab listener must use the current signal.
 */

import {
  MODULE_ID
} from "../constants.js";

import {
  TAB_PARTIALS,
  buildGroups,
  flattenGroups,
  getGroupById,
  decorateGroupsForContext,
  decorateTabsForContext
} from "./panel/panelRegistry.js";

import {
  readState,
  applyStateToForm,
  wireStatePersistence
} from "./panel/panelState.js";

import {
  preloadFxBusTemplates
} from "./panel/panelTemplates.js";

import {
  activateCategorySelectionMode
} from "./panel/panelSelection.js";

import {
  normaliseRequestedPanelState,
  renderSubTabs,
  setActivePanelState,
  wireCategoryClicks,
  wireSubTabClicks
} from "./panel/panelNavigation.js";

import {
  copyActiveTabApplyToClipboard
} from "./panel/panelMacroCopy.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    await preloadFxBusTemplates(TAB_PARTIALS);

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

    /**
     * Large comment:
     * Dispose every listener owned by the previous render before attaching any
     * new listener for this render.
     *
     * This prevents duplicate Apply/Stop handlers after Foundry re-renders the
     * ApplicationV2 panel, V14 moves it into a detached window, or PopOut-style
     * modules move the live DOM to a second browser document.
     */
    try {
      this._tabAbort?.abort?.();
    } catch {
      // ignore
    }

    this._tabAbort = new AbortController();
    const signal = this._tabAbort.signal;

    applyStateToForm(root, this._state);

    for (const tabDef of this._tabs) {
      try {
        tabDef.wire(root, runtime, signal);
      } catch (err) {
        console.error("[FX Bus] tab wire failed", {
          tab: tabDef?.id,
          label: tabDef?.label,
          activeCategory: this?._activeCategory,
          activeTab: this?._activeTab,
          errorName: err?.name,
          errorMessage: err?.message,
          errorStack: err?.stack,
          err
        });
      }
    }

    wireStatePersistence(root, signal);
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
        errorName: err?.name,
        errorMessage: err?.message,
        errorStack: err?.stack,
        err
      });
    });

    wireCategoryClicks(this, root, signal);
    wireSubTabClicks(this, root, signal);
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