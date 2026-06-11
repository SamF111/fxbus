// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelNavigation.js

/**
 * FX Bus - Panel Navigation
 *
 * Purpose:
 * - Resolve the active category/tab pair for the GM control panel.
 * - Control visible category and tab state in the rendered panel DOM.
 * - Rebuild the sub-tab row when the active category changes.
 * - Wire category and sub-tab click handlers.
 * - Persist active category/tab changes.
 * - Trigger native Token/Tile selection mode through panelSelection.js.
 */

import {
  getGroupById,
  getTabDefInCategory,
  getFirstTabIdForCategory,
  findCategoryForTab
} from "./panelRegistry.js";

import {
  writeState
} from "./panelState.js";

import {
  activateCategorySelectionMode
} from "./panelSelection.js";

export function normaliseRequestedPanelState(
  groups,
  requestedCategory,
  requestedTab,
  rememberedCategory,
  rememberedTab
) {
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

export function setActivePanelState(root, categoryId, tabId) {
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

export function renderSubTabs(root, app) {
  /**
   * Large comment:
   * Rebuild the sub-tab row for the current category without forcing a full
   * ApplicationV2 render.
   *
   * The tab content sections are static in fxbus-panel.hbs; only the visible
   * sub-tab navigation needs to change when a category is clicked.
   *
   * Detached windows have their own document, so elements are created from the
   * root's owning document instead of the global document.
   */
  const nav = root.querySelector(".tabs[data-group='fxbus'].fxbus-subtabs");
  if (!nav) return;

  const doc = root.ownerDocument ?? document;
  const group = getGroupById(app._groups, app._activeCategory);
  const tabs = group?.tabs ?? [];

  nav.innerHTML = "";

  for (const tab of tabs) {
    const a = doc.createElement("a");
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

export function wireCategoryClicks(app, root, abortSignal) {
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

export function wireSubTabClicks(app, root, abortSignal) {
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