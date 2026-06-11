// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tileRotationTab.js

/**
 * FX Bus - Tile Rotation Tab (Foundry v13+ ApplicationV2)
 *
 * Behaviour:
 * - Uses native Foundry tile selection.
 * - Emits the internal fx.tileRotation.* action namespace.
 * - Apply starts or updates indefinite visual-only tile rotation.
 * - Stop Selected removes rotation from currently selected tiles.
 * - Stop All removes all Tile Rotation effects.
 *
 * Selection-layer metadata:
 * - selectionLayer: "tiles" tells the GM panel to activate Foundry's native
 *   Tile selector when this tab is opened or clicked.
 *
 * v13/v14 stability:
 * - No MutationObserver.
 * - No live tile Hooks from this tab.
 * - No continuous canvas.tiles.controlled reads for tab text.
 * - Tile IDs are read only when Apply, Stop Selected, or Copy Macro builds a payload.
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) for the generic macro path.
 * - The selected tile ids are baked into the copied macro.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import {
  num,
  setDisabled
} from "./shared/panelUtils.js";

const TAB_ID = "tileRotation";

function getPanel(root) {
  const panel = root.querySelector(
    `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
  );

  if (!panel) throw new Error("TileRotation: panel not found");

  return panel;
}

function getOptionalPanel(root) {
  return root.querySelector(
    `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
  );
}

function readChecked(panel, name, fallback = false) {
  const el = panel.querySelector(`input[name="${name}"]`);
  if (!el) return fallback;

  return Boolean(el.checked);
}

function readSelect(panel, name, fallback) {
  const el = panel.querySelector(`select[name="${name}"]`);
  const value = String(el?.value ?? "").trim();

  return value.length > 0 ? value : fallback;
}

function readNumber(panel, name, fallback) {
  return num(panel.querySelector(`input[name="${name}"]`)?.value, fallback);
}

function selectedTileIds() {
  /**
   * Large comment:
   * Read selected tile IDs only when a user action actually needs a payload.
   *
   * This mirrors the newer token-tab pattern, but keeps the tile-selection helper
   * local so panelUtils.js does not need another shared helper just for this tab.
   */
  const controlled = Array.from(canvas?.tiles?.controlled ?? []);
  const fromControlled = controlled
    .map((tile) => tile?.id)
    .filter((id) => typeof id === "string" && id.length > 0);

  if (fromControlled.length > 0) return fromControlled;

  return Array.from(canvas?.tiles?.placeables ?? [])
    .filter((tile) => tile?.controlled)
    .map((tile) => tile?.id)
    .filter((id) => typeof id === "string" && id.length > 0);
}

function getSelectedTilesForPayload() {
  const tileIds = selectedTileIds();

  if (!Array.isArray(tileIds) || tileIds.length < 1) {
    throw new Error("TileRotation: select at least one tile");
  }

  return tileIds;
}

function getRotationParams(panel) {
  /**
   * Large comment:
   * Convert compact UI controls into the runtime payload.
   *
   * The runtime accepts signed speedDegPerSec values. The UI can either provide
   * a direction select plus a positive speed, or an older/simple HBS can omit
   * the direction select and allow signed speeds directly.
   */
  const direction = readSelect(panel, "tileRotationDirection", "cw");
  const speedAbs = Math.abs(readNumber(panel, "tileRotationSpeedDegPerSec", 15));
  const signedSpeed = direction === "ccw" ? -speedAbs : speedAbs;

  return {
    speedDegPerSec: signedSpeed,
    startOffsetDeg: readNumber(panel, "tileRotationStartOffsetDeg", 0),
    randomStartOffset: readChecked(panel, "tileRotationRandomStartOffset", false),
    restoreOnStop: readChecked(panel, "tileRotationRestoreOnStop", true)
  };
}

function buildApplyPayload(root, action) {
  const panel = getPanel(root);
  const tileIds = getSelectedTilesForPayload();

  return {
    action,
    tileIds,
    ...getRotationParams(panel)
  };
}

function buildStopSelectedPayload() {
  return {
    action: "fx.tileRotation.stop",
    tileIds: getSelectedTilesForPayload()
  };
}

function updateSelectedTileSummary(panel) {
  /**
   * Large comment:
   * Keep the summary static.
   *
   * The actual tile ids are read only when the user presses Apply, Stop Selected,
   * or Copy Macro. This avoids passive tile-selection reads during tab rendering.
   */
  const el = panel.querySelector("[data-tile-rotation-selection-summary]");
  if (!el) return;

  el.textContent = "Select tiles with Foundry's native Tile tool, then apply rotation.";
}

function wireSelectionSummary(panel) {
  /**
   * Large comment:
   * Intentionally passive.
   *
   * No Hooks.
   * No MutationObserver.
   * No live tile reads.
   */
  updateSelectedTileSummary(panel);
}

function syncStartOffsetControls(panel, signal) {
  const random = panel.querySelector('input[name="tileRotationRandomStartOffset"]');
  const offset = panel.querySelector('input[name="tileRotationStartOffsetDeg"]');

  if (!random || !offset) return;

  const sync = () => setDisabled(offset, Boolean(random.checked));

  random.addEventListener("change", sync, { signal });
  sync();
}

export function tileRotationTabDef() {
  return {
    id: TAB_ID,
    label: "Tile Rotation",
    selectionLayer: "tiles",

    buildApplyPayload(root, _runtime) {
      return buildApplyPayload(root, "fx.tileRotation.start");
    },

    macroName(_root) {
      return "FX Bus - Tile Rotation";
    },

    wire(root, runtime, signal) {
      const panel = getOptionalPanel(root);
      if (!panel) return;

      syncStartOffsetControls(panel, signal);
      wireSelectionSummary(panel);

      const apply = () => {
        try {
          runtime.emit(buildApplyPayload(root, "fx.tileRotation.update"));
        } catch (err) {
          ui.notifications.warn("Select at least one tile for Tile Rotation.");
          console.warn("[FX Bus] Tile Rotation apply failed", err);
        }
      };

      const stopSelected = () => {
        try {
          runtime.emit(buildStopSelectedPayload());
        } catch (err) {
          ui.notifications.warn("Select at least one tile to stop Tile Rotation.");
          console.warn("[FX Bus] Tile Rotation stop selected failed", err);
        }
      };

      const stopAll = () => {
        runtime.emit({ action: "fx.tileRotation.stop" });
      };

      for (const button of Array.from(panel.querySelectorAll(".fxbus-do[data-do]"))) {
        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            const action = button.dataset.do;

            if (action === "tileRotationApply") apply();
            else if (action === "tileRotationStopSelected") stopSelected();
            else if (action === "tileRotationStopAll") stopAll();
          },
          { signal }
        );
      }
    }
  };
}