// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\shared\panelUtils.js

/**
 * FX Bus - Panel Utilities
 *
 * Shared helpers for panel tabs.
 *
 * Selection model:
 * - Token-specific tabs call selectedTokenIds().
 * - Tile-specific tabs call selectedTileIds().
 * - Generic callers can use selectedPlaceableIdsForFxBusTab().
 * - Generic selection defaults to tokens unless the remembered active tab is tileOsc.
 *
 * Tile targeting:
 * - FX Bus can keep its own private tile selection in globalThis.fxbus.ui.selectedTileIds.
 * - This avoids activating the native Foundry Tiles toolbar just to target tile FX.
 * - selectedTileIds() reads the private FX Bus tile selection first, then falls back
 *   to native canvas.tiles.controlled.
 */

const MODULE_ID = "fxbus";
const UI_STATE_KEY = "uiState";

const SELECTION_KIND_TOKEN = "token";
const SELECTION_KIND_TILE = "tile";

const TILE_TAB_IDS = new Set([
  "tileOsc"
]);

export function normaliseHex(value, fallback) {
  if (typeof value !== "string") return fallback;

  const s = value.trim().toLowerCase();

  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;

  return fallback;
}

export function num(value, fallback) {
  const n = Number(value);

  return Number.isFinite(n) ? n : fallback;
}

export function setDisabled(el, disabled) {
  if (!el) return;

  el.disabled = disabled;
  el.style.opacity = disabled ? "0.6" : "1";
}

function validId(id) {
  return typeof id === "string" && id.length > 0;
}

function getFxBusPrivateTileIds() {
  /**
   * Large comment:
   * Return FX Bus's private tile selection.
   *
   * This is separate from Foundry's native canvas.tiles.controlled selection
   * because the native tile selection is tied to the Tiles layer and toolbar.
   * FX Bus deliberately avoids switching to that toolbar for tile oscillation.
   */
  const ids = globalThis.fxbus?.ui?.selectedTileIds;

  if (!(ids instanceof Set)) return [];

  return Array.from(ids).filter(validId);
}

export function selectedTokenIds() {
  /**
   * Large comment:
   * Return currently controlled token ids.
   *
   * This function remains token-specific so existing token tabs keep explicit
   * token-targeting behaviour.
   */
  const tokens = canvas?.tokens?.controlled ?? [];

  return tokens
    .map((token) => token?.id)
    .filter(validId);
}

export function selectedTileIds() {
  /**
   * Large comment:
   * Return tile ids selected for FX Bus tile effects.
   *
   * Priority:
   * 1. FX Bus private tile selection from globalThis.fxbus.ui.selectedTileIds.
   * 2. Native Foundry controlled tiles from canvas.tiles.controlled.
   *
   * This lets the Tile Osc tab target tiles without forcing the left toolbar
   * into Foundry's native tile creation/editing tools.
   */
  const privateIds = getFxBusPrivateTileIds();
  if (privateIds.length > 0) return privateIds;

  const tiles = canvas?.tiles?.controlled ?? [];

  return tiles
    .map((tile) => tile?.id)
    .filter(validId);
}

export function getRememberedFxBusTabId(fallback = "osc") {
  /**
   * Large comment:
   * Read the last active FX Bus tab from client-side panel settings.
   *
   * If settings are unavailable or the panel has never been opened, default to
   * the token oscillation tab. That preserves token-first behaviour.
   */
  try {
    const state = game.settings.get(MODULE_ID, UI_STATE_KEY) ?? {};
    const tabId = state.__activeTab;

    if (typeof tabId === "string" && tabId.length > 0) {
      return tabId;
    }
  } catch {
    // ignore
  }

  return fallback;
}

export function getSelectionKindForFxBusTab(tabId = getRememberedFxBusTabId()) {
  /**
   * Large comment:
   * Convert an FX Bus tab id into the placeable selection kind that should be read.
   *
   * Unknown tabs default to tokens. This avoids screen-effect tabs accidentally
   * changing target behaviour.
   */
  if (TILE_TAB_IDS.has(tabId)) return SELECTION_KIND_TILE;

  return SELECTION_KIND_TOKEN;
}

export function selectedPlaceableIdsForFxBusTab(tabId = getRememberedFxBusTabId()) {
  /**
   * Large comment:
   * Return selected placeable ids based on an FX Bus tab id.
   *
   * - tileOsc -> selected tile ids
   * - everything else -> selected token ids
   *
   * The returned payloadKey lets generic callers construct socket payloads
   * without hardcoding tokenIds vs tileIds.
   */
  const kind = getSelectionKindForFxBusTab(tabId);

  if (kind === SELECTION_KIND_TILE) {
    return {
      kind,
      ids: selectedTileIds(),
      payloadKey: "tileIds"
    };
  }

  return {
    kind,
    ids: selectedTokenIds(),
    payloadKey: "tokenIds"
  };
}

export function syncColourPair(root, pickerName, textName, fallback) {
  const picker = root.querySelector(`input[name="${pickerName}"]`);
  const text = root.querySelector(`input[name="${textName}"]`);

  if (!picker || !text) return;

  const initial = normaliseHex(text.value, fallback);

  text.value = initial;
  picker.value = initial;

  picker.addEventListener("input", () => {
    text.value = picker.value;
  });

  text.addEventListener("input", () => {
    picker.value = normaliseHex(text.value, fallback);
  });
}