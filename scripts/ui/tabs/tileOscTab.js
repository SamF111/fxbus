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
 * - Apply retains native tile selection so Stop can address the same tiles.
 * - Stop requires currently selected tiles and never falls back to another scope.
 * - Stop All is a separate explicit action.
 *
 * Selection-layer metadata:
 * - selectionLayer: "tiles" tells the GM panel to activate Foundry's native
 *   Tiles selector when this tab is opened or clicked.
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

import { num, selectedTileIds, setDisabled } from "./shared/panelUtils.js";

const TAB_ID = "tileOsc";
const EFFECT_NAME = "tileOscillation";

const ACTION_START = "fx.tileOscillation.start";
const ACTION_UPDATE = "fx.tileOscillation.update";
const ACTION_STOP = "fx.tileOscillation.stop";
const ACTION_STOP_ALL = "fx.tileOscillation.stopAll";

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

function getMotionSyncParams(panel) {
  const enabled =
    panel.querySelector('input[name="tileOscMotionSync"]')?.checked === true;

  const syncGroup = enabled
    ? String(panel.querySelector('input[name="tileOscSyncGroup"]')?.value ?? "").trim()
    : "";

  const syncPhaseDeg = enabled
    ? num(panel.querySelector('input[name="tileOscSyncPhaseDeg"]')?.value, 0)
    : 0;

  return {
    enabled,
    syncGroup,
    syncPhaseDeg
  };
}

function syncMotionSyncControls(panel) {
  const motionSync = panel.querySelector('input[name="tileOscMotionSync"]');
  const syncGroup = panel.querySelector('input[name="tileOscSyncGroup"]');
  const syncPhaseDeg = panel.querySelector('input[name="tileOscSyncPhaseDeg"]');
  const randomPhase = panel.querySelector('input[name="tileOscRandomPhase"]');

  const enabled = motionSync?.checked === true;

  setDisabled(syncGroup, !enabled);
  setDisabled(syncPhaseDeg, !enabled);
  setDisabled(randomPhase, enabled);
}

function buildParams(panel, motionSyncEnabled = false) {
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
    randomPhase: motionSyncEnabled
      ? false
      : Boolean(panel.querySelector('input[name="tileOscRandomPhase"]')?.checked)
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

  const motionSync = getMotionSyncParams(panel);
  const motionSyncActive = motionSync.enabled && motionSync.syncGroup.length > 0;

  const payload = {
    action,
    tileIds,
    ...buildParams(panel, motionSyncActive)
  };

  if (motionSyncActive) {
    payload.syncGroup = motionSync.syncGroup;
    payload.syncPhaseDeg = motionSync.syncPhaseDeg;
  }

  return payload;
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

      syncMotionSyncControls(panel);

      panel
        .querySelector('input[name="tileOscMotionSync"]')
        ?.addEventListener(
          "change",
          () => syncMotionSyncControls(panel),
          { signal }
        );

      panel
        .querySelector('input[name="tileOscMotionSync"]')
        ?.addEventListener(
          "input",
          () => syncMotionSyncControls(panel),
          { signal }
        );

      const stop = () => {
        const tileIds = selectedTileIds();
        if (tileIds.length === 0) {
          ui.notifications.warn("Select one or more tiles to stop Tile Oscillation.");
          return;
        }

        runtime.emit({
          action: ACTION_STOP,
          tileIds
        });
      };

      const stopAll = () => {
        runtime.emit({ action: ACTION_STOP_ALL });
      };

      const apply = () => {
        try {
          const payload = buildPayload(root, runtime);
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
        .querySelector('button[type="button"][data-do="tileOscStopAll"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            stopAll();
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
