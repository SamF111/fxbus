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

export async function copyActiveTabApplyToClipboard(app, root, runtime) {
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
    const builder = tabDef.buildApplyPayload;

    if (typeof builder !== "function") {
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
      payload = builder(root, runtime);
    } catch (err) {
      ui.notifications.warn(
        errorMessageForNotification(err, "FX Bus: failed to build macro payload.")
      );

      logPanelBuildError("[FX Bus] buildApplyPayload failed", app, tabDef, err);
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