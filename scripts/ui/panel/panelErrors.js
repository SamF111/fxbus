/**
 * FX Bus - Panel Errors
 *
 * Purpose:
 * - Keep panel notification messages and structured console diagnostics out of
 *   the main ApplicationV2 class.
 * - Preserve existing user-facing error behaviour while allowing the panel app
 *   to shrink safely.
 */

export function errorMessageForNotification(err, fallback) {
  const message = String(err?.message ?? "").trim();
  return message.length ? `FX Bus: ${message}` : fallback;
}

export function logPanelBuildError(prefix, app, tabDef, err, extra = {}) {
  console.error(prefix, {
    tab: tabDef?.id,
    label: tabDef?.label,
    activeCategory: app?._activeCategory,
    activeTab: app?._activeTab,
    errorName: err?.name,
    errorMessage: err?.message,
    errorStack: err?.stack,
    err,
    ...extra
  });
}