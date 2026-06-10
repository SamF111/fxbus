// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tileOscTab.js

/**
 * FX Bus - Tile Oscillation Tab (Foundry v13+ ApplicationV2)
 *
 * Purpose:
 * - Apply visual-only oscillation to selected tiles.
 * - Intended for environmental animation: trees, hanging signs, cables, cloth,
 *   vents, loose machinery, lamps, foliage, banners, suspended debris.
 *
 * Behaviour:
 * - Requires native Tiles selection mode.
 * - Apply reads selected native Foundry tiles.
 * - Apply stores those tile IDs.
 * - Apply releases native tile selection before emitting start/update.
 * - Stop uses selected tiles if present.
 * - If no tiles are currently selected, Stop falls back to the last tile IDs used by Apply.
 * - If no tile IDs are available, Stop emits a stop-all payload for tile oscillation.
 *
 * Selection-layer metadata:
 * - selectionLayer: "tiles" tells the GM panel to activate Foundry's native
 *   Tiles selector when this tab is opened or clicked.
 *
 * Reason for releasing selection:
 * - Foundry refreshes selected Tile state during render ticks.
 * - Oscillating a selected tile's render object can trigger Tile._refreshState errors.
 * - FX Bus only needs stable tile IDs after Apply has been pressed.
 *
 * Runtime state:
 * - Expected shape:
 *     runtime.tileFx: Map(effectName -> Map(tileId -> state))
 *
 * Copy-to-macro support:
 * - buildApplyPayload(root, runtime) returns the same payload used by Apply.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import { num, selectedTileIds } from "./shared/panelUtils.js";

const TAB_ID = "tileOsc";
const EFFECT_NAME = "tileOscillation";

const ACTION_START = "fx.tileOscillation.start";
const ACTION_UPDATE = "fx.tileOscillation.update";
const ACTION_STOP = "fx.tileOscillation.stop";

function getFxBusUiState(runtime) {
  /**
   * Large comment:
   * Resolve a small client-side UI state bag on the FX Bus runtime.
   *
   * This does not store world data. It only remembers the last tile IDs used by
   * the Tile Osc tab so Stop can still work after Apply releases native tile
   * selection.
   */
  const rt = runtime ?? globalThis.fxbus;
  if (!rt) return null;

  if (!rt.ui) rt.ui = {};

  if (!Array.isArray(rt.ui.lastTileOscTileIds)) {
    rt.ui.lastTileOscTileIds = [];
  }

  return rt.ui;
}

function rememberTileIds(runtime, tileIds) {
  /**
   * Large comment:
   * Store the last tile IDs used by this tab.
   *
   * This allows Stop to operate after Apply has deliberately released native
   * tile selection.
   */
  const uiState = getFxBusUiState(runtime);
  if (!uiState) return;

  uiState.lastTileOscTileIds = Array.isArray(tileIds)
    ? tileIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];
}

function getRememberedTileIds(runtime) {
  const uiState = getFxBusUiState(runtime);
  if (!uiState) return [];

  return Array.isArray(uiState.lastTileOscTileIds)
    ? uiState.lastTileOscTileIds.filter((id) => typeof id === "string" && id.length > 0)
    : [];
}

function releaseNativeSelectedTiles() {
  /**
   * Large comment:
   * Release native Foundry tile selection after FX Bus has read tile IDs.
   *
   * This prevents selected Tile refresh state from fighting the visual-only
   * oscillation transform while the effect is running.
   *
   * This function belongs in the UI layer, not the effect layer. The effect layer
   * should only consume tileIds and animate render objects.
   */
  const tiles = canvas?.tiles?.controlled ?? [];

  for (const tile of tiles) {
    try {
      tile.release?.();
    } catch {
      // ignore
    }
  }
}

function getTileOscStateMap(runtime) {
  /**
   * Large comment:
   * Resolve the tile oscillation state map from the FX Bus runtime.
   *
   * Preferred shape:
   *   runtime.tileFx.get("tileOscillation") -> Map(tileId -> state)
   *
   * Narrow compatibility fallbacks:
   * - runtime.tileFx as a direct Map(tileId -> state)
   * - runtime.tileFx as a plain object
   */
  const tileFx = runtime?.tileFx;
  if (!tileFx) return null;

  if (typeof tileFx.get === "function") {
    const nested = tileFx.get(EFFECT_NAME);
    if (nested) return nested;

    return tileFx;
  }

  if (typeof tileFx === "object") {
    return tileFx[EFFECT_NAME] ?? tileFx;
  }

  return null;
}

function hasTileState(stateMap, tileId) {
  /**
   * Large comment:
   * Check whether a selected tile already has oscillation state.
   *
   * Supports:
   * - Map.has(tileId)
   * - plain object lookup by tileId
   */
  if (!stateMap || !tileId) return false;

  if (typeof stateMap.has === "function") {
    return stateMap.has(tileId);
  }

  if (typeof stateMap === "object") {
    return Object.prototype.hasOwnProperty.call(stateMap, tileId);
  }

  return false;
}

function shouldUpdate(runtime, tileIds) {
  /**
   * Large comment:
   * Decide whether Apply should start or update tile oscillation.
   *
   * If any selected tile is already in the tile oscillation state map, emit
   * update. Otherwise emit start.
   */
  if (!Array.isArray(tileIds) || tileIds.length === 0) return false;

  const stateMap = getTileOscStateMap(runtime);
  if (!stateMap) return false;

  return tileIds.some((tileId) => hasTileState(stateMap, tileId));
}

function getTileOscPanel(root) {
  const panel = root.querySelector(
    `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
  );

  if (!panel) throw new Error("TileOsc: panel not found");

  return panel;
}

function buildParams(panel) {
  /**
   * Large comment:
   * Read tile oscillation parameters from tileOscTab.hbs.
   *
   * Expected field names:
   * - tileOscRotationDeg
   * - tileOscBobPx
   * - tileOscSwayPx
   * - tileOscScalePct
   * - tileOscFreqHz
   * - tileOscRandomPhase
   */
  return {
    rotationDeg: num(panel.querySelector('input[name="tileOscRotationDeg"]')?.value, 1.5),
    bobPx: num(panel.querySelector('input[name="tileOscBobPx"]')?.value, 0),
    swayPx: num(panel.querySelector('input[name="tileOscSwayPx"]')?.value, 3),
    scalePct: num(panel.querySelector('input[name="tileOscScalePct"]')?.value, 0),
    freqHz: num(panel.querySelector('input[name="tileOscFreqHz"]')?.value, 0.25),
    randomPhase: Boolean(
      panel.querySelector('input[name="tileOscRandomPhase"]')?.checked
    )
  };
}

function buildPayload(root, runtime) {
  const panel = getTileOscPanel(root);

  const tileIds = selectedTileIds();
  if (!Array.isArray(tileIds) || tileIds.length === 0) {
    throw new Error("TileOsc: no tiles selected");
  }

  const action = shouldUpdate(runtime, tileIds)
    ? ACTION_UPDATE
    : ACTION_START;

  return {
    action,
    tileIds,
    ...buildParams(panel)
  };
}

export function tileOscTabDef() {
  return {
    id: TAB_ID,
    label: "Tile Osc",
    selectionLayer: "tiles",

    /**
     * Build the socket payload for Apply / Copy-to-Macro.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @returns {object}
     */
    buildApplyPayload(root, runtime) {
      return buildPayload(root, runtime);
    },

    wire(root, runtime, signal) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      const stop = () => {
        /**
         * Large comment:
         * Stop selected tiles if any are currently selected.
         *
         * If Apply already released native tile selection, fall back to the last
         * tile IDs used by this tab. If that is also empty, emit a stop with no
         * tileIds, which the effect handler treats as stop-all.
         */
        const selectedIds = selectedTileIds();
        const rememberedIds = getRememberedTileIds(runtime);

        const tileIds = selectedIds.length > 0
          ? selectedIds
          : rememberedIds;

        if (tileIds.length > 0) {
          runtime.emit({
            action: ACTION_STOP,
            tileIds
          });
        } else {
          runtime.emit({
            action: ACTION_STOP
          });
        }

        releaseNativeSelectedTiles();
      };

      const apply = () => {
        try {
          const payload = buildPayload(root, runtime);

          rememberTileIds(runtime, payload.tileIds);

          // Critical: do not leave tiles natively selected while their render
          // transforms are being animated every ticker.
          releaseNativeSelectedTiles();

          runtime.emit(payload);
        } catch (err) {
          ui.notifications.warn("Select one or more tiles for Tile Oscillation.");
          console.warn("[FX Bus] Tile Osc apply failed", err);
        }
      };

      panel
        .querySelector('button[type="button"][data-do="tileOscStop"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            stop();
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-do="tileOscApply"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            apply();
          },
          { signal }
        );
    }
  };
}