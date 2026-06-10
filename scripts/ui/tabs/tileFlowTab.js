// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tileFlowTab.js

/**
 * FX Bus - Tile Flow Tab
 *
 * Purpose:
 * - UI wiring for visual-only tile texture flow.
 * - Reads selected tile ids through the FX Bus private tile-selection model.
 * - Emits socket payloads only; no PIXI/canvas mutation happens here.
 *
 * Actions:
 * - Apply: fx.tileFlow.start
 * - Stop Selected: fx.tileFlow.stop with selected tileIds
 * - Stop All: fx.tileFlow.stop without tileIds
 *
 * Copy Macro:
 * - buildApplyPayload(root, runtime) returns the same payload used by Apply.
 * - Static macro copying requires selected tiles, because tileIds are baked into the payload.
 */

import {
  num,
  selectedTileIds
} from "./shared/panelUtils.js";

const TAB_ID = "tileFlow";

function checked(panel, name, fallback = false) {
  const el = panel.querySelector(`input[name="${name}"]`);

  if (!el) return fallback;

  return el.checked === true;
}

function selectValue(panel, name, fallback) {
  const el = panel.querySelector(`select[name="${name}"]`);
  const value = String(el?.value ?? "").trim();

  return value.length > 0 ? value : fallback;
}

function getSelectedTileIdsOrThrow() {
  /**
   * Large comment:
   * Resolve the currently selected tile ids for static payload construction.
   *
   * Tile Flow macros are intentionally static. Copy Macro must therefore bake
   * the selected tile ids into the generated payload. If no tiles are selected,
   * this is a validation error rather than a silent empty-target macro.
   */
  const tileIds = selectedTileIds();

  if (tileIds.length === 0) {
    throw new Error("Tile Flow: no tiles selected");
  }

  return tileIds;
}

function getSelectedTileIdsOrWarn() {
  /**
   * Large comment:
   * Resolve selected tile ids for live Apply / Stop Selected button actions.
   *
   * Button actions should warn and stop without throwing because these are normal
   * user interactions rather than macro-build validation paths.
   */
  try {
    return getSelectedTileIdsOrThrow();
  } catch (err) {
    ui.notifications.warn(`FX Bus: ${err?.message ?? "select one or more tiles"}`);
    return [];
  }
}

function normaliseAccelerationMode(value) {
  const mode = String(value ?? "none").trim();

  if (mode === "linear") return "linear";
  if (mode === "easeInOut") return "easeInOut";
  if (mode === "none") return "none";

  return "none";
}

function normaliseCompletionMode(value) {
  const mode = String(value ?? "retain").trim();

  if (mode === "reset") return "reset";
  if (mode === "retain") return "retain";

  return "retain";
}

function normaliseStopMode(value) {
  const mode = String(value ?? "reset").trim();

  if (mode === "reset") return "reset";
  if (mode === "retain") return "retain";

  return "reset";
}

function buildPayload(panel, tileIds) {
  /**
   * Large comment:
   * Build the shared Tile Flow start payload.
   *
   * This helper is used by both Apply and Copy Macro, so those workflows stay
   * mechanically identical. The caller is responsible for deciding how tile
   * selection validation is surfaced.
   */
  const accelerationMode = normaliseAccelerationMode(
    selectValue(panel, "tileFlowAccelerationMode", "none")
  );

  return {
    action: "fx.tileFlow.start",
    tileIds,

    angleDeg: num(
      panel.querySelector('input[name="tileFlowAngleDeg"]')?.value,
      0
    ),

    startSpeedPxPerSec: num(
      panel.querySelector('input[name="tileFlowStartSpeedPxPerSec"]')?.value,
      160
    ),

    accelerationMode,

    accelerationPxPerSec2: accelerationMode === "none"
      ? 0
      : num(
          panel.querySelector('input[name="tileFlowAccelerationPxPerSec2"]')?.value,
          0
        ),

    accelerationDurationMs: accelerationMode === "none"
      ? 0
      : num(
          panel.querySelector('input[name="tileFlowAccelerationDurationMs"]')?.value,
          2000
        ),

    durationMs: num(
      panel.querySelector('input[name="tileFlowDurationMs"]')?.value,
      0
    ),

    completionMode: normaliseCompletionMode(
      selectValue(panel, "tileFlowCompletionMode", "retain")
    ),

    stopMode: normaliseStopMode(
      selectValue(panel, "tileFlowStopMode", "reset")
    ),

    randomPhase: checked(panel, "tileFlowRandomPhase", false),

    overlayAlpha: num(
      panel.querySelector('input[name="tileFlowOverlayAlpha"]')?.value,
      1
    ),

    repeatScale: num(
      panel.querySelector('input[name="tileFlowRepeatScale"]')?.value,
      1
    ),

    blendMode: selectValue(panel, "tileFlowBlendMode", "NORMAL")
  };
}

export function tileFlowTabDef() {
  return {
    id: TAB_ID,
    label: "Tile Flow",

    /**
     * Build the socket payload for Apply / Copy Macro.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) throw new Error("Tile Flow: panel not found");

      const tileIds = getSelectedTileIdsOrThrow();

      return buildPayload(panel, tileIds);
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      function apply() {
        const tileIds = getSelectedTileIdsOrWarn();
        if (tileIds.length === 0) return;

        const payload = buildPayload(panel, tileIds);

        runtime.emit(payload);
      }

      function stopSelected() {
        const tileIds = getSelectedTileIdsOrWarn();
        if (tileIds.length === 0) return;

        runtime.emit({
          action: "fx.tileFlow.stop",
          tileIds,
          stopMode: normaliseStopMode(
            selectValue(panel, "tileFlowStopMode", "reset")
          )
        });
      }

      function stopAll() {
        runtime.emit({
          action: "fx.tileFlow.stop",
          stopMode: normaliseStopMode(
            selectValue(panel, "tileFlowStopMode", "reset")
          )
        });
      }

      panel
        .querySelector('button[type="button"][data-action="tileFlowApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });

      panel
        .querySelector('button[type="button"][data-action="tileFlowStopSelected"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stopSelected();
        });

      panel
        .querySelector('button[type="button"][data-action="tileFlowStopAll"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stopAll();
        });
    }
  };
}