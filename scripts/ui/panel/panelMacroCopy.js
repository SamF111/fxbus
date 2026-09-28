// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelMacroCopy.js

/**
 * FX Bus - Panel Macro Copy
 *
 * Purpose:
 * - Build clipboard macro source for the currently active GM panel tab.
 * - Support standard static payload macros through buildApplyPayload(root, runtime).
 * - Support custom tab macro source through buildMacroSource(root, runtime, options).
 * - Keep macro metadata, macro naming, payload validation, and clipboard handling
 *   out of the main ApplicationV2 class.
 */

import {
  fxbusBuildMacroSource,
  fxbusCopyTextToClipboard
} from "../../util/fxbusMacroUtils.js";

import {
  MODULE_ID
} from "../../constants.js";

import {
  getTabDefById,
  getTabDefInCategory
} from "./panelRegistry.js";

import {
  errorMessageForNotification,
  logPanelBuildError
} from "./panelErrors.js";

import {
  addAudienceToPayload,
  buildStopAllPayload,
  closeAudienceMenus,
  getPanelAudience
} from "./panelAudience.js";

const MACRO_KIND_APPLY = "apply";
const MACRO_KIND_STOP = "stop";
const MACRO_KIND_STOP_ALL = "stopAll";
const VALID_MACRO_KINDS = new Set([
  MACRO_KIND_APPLY,
  MACRO_KIND_STOP,
  MACRO_KIND_STOP_ALL
]);

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

function buildDefaultMacroName(tabDef, root, dateTag, timeTag, kind = MACRO_KIND_APPLY) {
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
  let baseName;

  if (typeof tabDef?.macroName === "function") {
    baseName = String(tabDef.macroName(root) ?? `FX Bus - ${tabDef.label}`);
  } else if (typeof tabDef?.macroName === "string" && tabDef.macroName.length) {
    baseName = tabDef.macroName;
  } else {
    baseName = `FX Bus - ${tabDef.label} - ${dateTag} ${timeTag}`;
  }

  if (kind === MACRO_KIND_STOP) return `${baseName} - Stop`;
  if (kind === MACRO_KIND_STOP_ALL) return `${baseName} - Stop All`;
  return baseName;
}

function getActivePanelSection(app, root) {
  const categoryId = String(app?._activeCategory ?? "");
  const tabId = String(app?._activeTab ?? "");

  return root?.querySelector?.(
    `.fxbus-panel-section[data-category="${categoryId}"][data-tab="${tabId}"]`
  ) ?? null;
}

function buildDefaultStopPayload(app, root, tabDef, runtime, kind) {
  if (kind === MACRO_KIND_STOP && typeof tabDef?.buildStopPayload === "function") {
    return tabDef.buildStopPayload(root, runtime);
  }

  const section = getActivePanelSection(app, root);
  const stopAllButton = section?.querySelector?.(
    "button[data-fxbus-stop-all-action]"
  );

  if (!stopAllButton) {
    throw new Error(`Tab '${tabDef?.id ?? "unknown"}' does not define Stop All.`);
  }

  const payload = buildStopAllPayload(stopAllButton);
  if (kind === MACRO_KIND_STOP_ALL) return payload;

  return {
    ...payload,
    action: payload.action.replace(/\.stopAll$/, ".stop")
  };
}

export async function copyActiveTabMacroToClipboard(
  app,
  root,
  runtime,
  kind = MACRO_KIND_APPLY
) {
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
  const macroKind = String(kind ?? MACRO_KIND_APPLY);
  if (!VALID_MACRO_KINDS.has(macroKind)) {
    ui.notifications.error("FX Bus: unknown macro action.");
    return;
  }

  const tabDef = getActiveTabDef(app);

  if (!tabDef) {
    ui.notifications.error("FX Bus: active tab not found.");
    return;
  }

  const iso = new Date().toISOString();
  const dateTag = iso.slice(0, 10);
  const timeTag = iso.slice(11, 19).replace(/:/g, "-");
  const meta = getMacroMeta();

  if (tabDef.id === "reset" && macroKind !== MACRO_KIND_APPLY) {
    ui.notifications.warn("FX Bus: Reset only supports its global reset macro.");
    return;
  }

  const macroName = buildDefaultMacroName(
    tabDef,
    root,
    dateTag,
    timeTag,
    macroKind
  );

  let macroSource = null;
  let audience;

  try {
    audience = tabDef.id === "reset" || macroKind === MACRO_KIND_STOP_ALL
      ? undefined
      : getPanelAudience(app, globalThis.game, { requireConnected: false });
  } catch (err) {
    ui.notifications.warn(`FX Bus: ${err?.message ?? "Choose valid recipients and try again."}`);
    return;
  }

  if (
    macroKind === MACRO_KIND_APPLY &&
    typeof tabDef.buildMacroSource === "function"
  ) {
    try {
      macroSource = tabDef.buildMacroSource(root, runtime, {
        macroName,
        meta,
        dateTag,
        timeTag,
        audience
      });
    } catch (err) {
      ui.notifications.warn(
        errorMessageForNotification(err, "FX Bus: failed to build custom macro.")
      );

      logPanelBuildError("[FX Bus] buildMacroSource failed", app, tabDef, err);
      return;
    }

    if (typeof macroSource !== "string" || macroSource.trim().length === 0) {
      ui.notifications.error("FX Bus: invalid custom macro source.");

      console.error("[FX Bus] Invalid macro source returned", {
        tab: tabDef?.id,
        label: tabDef?.label,
        activeCategory: app?._activeCategory,
        activeTab: app?._activeTab,
        macroSource
      });

      return;
    }
  } else {
    const builder = macroKind === MACRO_KIND_APPLY
      ? tabDef.buildApplyPayload
      : null;

    if (macroKind === MACRO_KIND_APPLY && typeof builder !== "function") {
      ui.notifications.error(
        `FX Bus: tab '${tabDef.id}' does not support Copy Macro yet.`
      );

      console.error("[FX Bus] Missing buildApplyPayload on tabDef", {
        tab: tabDef?.id,
        label: tabDef?.label,
        activeCategory: app?._activeCategory,
        activeTab: app?._activeTab,
        tabDef
      });

      return;
    }

    let payload = null;

    try {
      payload = macroKind === MACRO_KIND_APPLY
        ? builder(root, runtime)
        : buildDefaultStopPayload(app, root, tabDef, runtime, macroKind);
    } catch (err) {
      ui.notifications.warn(
        errorMessageForNotification(err, "FX Bus: failed to build macro payload.")
      );

      logPanelBuildError("[FX Bus] macro payload build failed", app, tabDef, err);
      return;
    }

    if (!payload || typeof payload !== "object") {
      ui.notifications.error("FX Bus: invalid macro payload.");

      console.error("[FX Bus] Invalid payload returned", {
        tab: tabDef?.id,
        label: tabDef?.label,
        activeCategory: app?._activeCategory,
        activeTab: app?._activeTab,
        payload
      });

      return;
    }

    const audiencePayload = addAudienceToPayload(payload, audience);

    macroSource = fxbusBuildMacroSource(macroName, audiencePayload, {
      requireGM: true,
      meta
    });
  }

  try {
    await fxbusCopyTextToClipboard(macroSource);
    ui.notifications.info("FX Bus: macro copied to clipboard.");
  } catch (err) {
    ui.notifications.error("FX Bus: clipboard copy blocked. See console.");

    console.error("[FX Bus] Clipboard copy failed", {
      activeCategory: app?._activeCategory,
      activeTab: app?._activeTab,
      errorName: err?.name,
      errorMessage: err?.message,
      errorStack: err?.stack,
      err
    });
  }
}

export async function copyActiveTabApplyToClipboard(app, root, runtime) {
  return copyActiveTabMacroToClipboard(
    app,
    root,
    runtime,
    MACRO_KIND_APPLY
  );
}

export function closeMacroCopyMenus(root, options = {}) {
  const restoreFocus = options.restoreFocus === true;
  const openMenus = Array.from(
    root?.querySelectorAll?.(".fxbus-macro-menu") ?? []
  ).filter((menu) => menu.hidden !== true);
  const focusTarget = restoreFocus
    ? Array.from(root?.querySelectorAll?.(".fxbus-macro-toggle") ?? [])
      .find((toggle) =>
        openMenus.some((menu) => toggle.getAttribute("aria-controls") === menu.id)
      ) ?? null
    : null;

  for (const menu of root?.querySelectorAll?.(".fxbus-macro-menu") ?? []) {
    menu.hidden = true;
  }

  for (const toggle of root?.querySelectorAll?.(".fxbus-macro-toggle") ?? []) {
    toggle.setAttribute("aria-expanded", "false");
  }

  focusTarget?.focus?.();
}

function buildMacroCopyMenu(app, root, runtime, documentRef, menuId, signal) {
  const menu = documentRef.createElement("div");
  menu.className = "fxbus-macro-menu";
  menu.id = menuId;
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Copy FX macro");

  const options = [
    [MACRO_KIND_APPLY, "Copy Apply Macro"],
    [MACRO_KIND_STOP, "Copy Stop Macro"],
    [MACRO_KIND_STOP_ALL, "Copy Stop All Macro"]
  ];

  for (const [macroKind, label] of options) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "fxbus-macro-option";
    button.dataset.fxbusMacroKind = macroKind;
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeMacroCopyMenus(root, { restoreFocus: true });
      await copyActiveTabMacroToClipboard(app, root, runtime, macroKind);
    }, { signal });
    menu.append(button);
  }

  menu.addEventListener("click", (event) => event.stopPropagation(), { signal });
  menu.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const buttons = Array.from(menu.querySelectorAll("button[role=\"menuitem\"]"));
    if (buttons.length === 0) return;

    event.preventDefault();
    event.stopPropagation();

    const currentIndex = buttons.indexOf(documentRef.activeElement);
    let nextIndex;

    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1;
    } else {
      nextIndex = currentIndex < 0 || currentIndex === buttons.length - 1
        ? 0
        : currentIndex + 1;
    }

    buttons[nextIndex]?.focus?.();
  }, { signal });
  return menu;
}

export function wireMacroCopyControls(app, root, runtime, signal) {
  const documentRef = root?.ownerDocument ?? globalThis.document;
  if (!documentRef?.createElement) return;

  for (const section of root.querySelectorAll(
    '.fxbus-panel-section:not([data-category="reset"])'
  )) {
    const copy = section.querySelector('[data-action="fxbusCopyToMacro"]');
    if (!copy || copy.closest(".fxbus-macro-split")) continue;

    copy.textContent = "Copy Macro";

    const wrapper = documentRef.createElement("span");
    wrapper.className = "fxbus-macro-split";
    copy.parentNode.insertBefore(wrapper, copy);
    wrapper.append(copy);

    const categoryId = String(section.dataset.category ?? "effect");
    const tabId = String(section.dataset.tab ?? "panel");
    const menuId = `fxbus-macro-${categoryId}-${tabId}`;

    const toggle = documentRef.createElement("button");
    toggle.type = "button";
    toggle.className = "fxbus-macro-toggle";
    toggle.title = "Choose macro action";
    toggle.setAttribute("aria-label", "Choose macro action");
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", menuId);
    toggle.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i>';

    const menu = buildMacroCopyMenu(
      app,
      root,
      runtime,
      documentRef,
      menuId,
      signal
    );
    wrapper.append(toggle, menu);

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden;
      closeAudienceMenus(root);
      closeMacroCopyMenus(root);
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("button")?.focus?.();
    }, { signal });
  }

  documentRef.addEventListener("click", () => closeMacroCopyMenus(root), { signal });
  documentRef.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    const hasOpenMenu = Array.from(root.querySelectorAll(".fxbus-macro-menu"))
      .some((menu) => menu.hidden !== true);
    if (!hasOpenMenu) return;

    event.preventDefault();
    event.stopPropagation();
    closeMacroCopyMenus(root, { restoreFocus: true });
  }, { signal });
}
