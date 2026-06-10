// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tileFlickerTab.js

/**
 * FX Bus - Tile Flicker Tab
 *
 * Purpose:
 * - UI wiring for visual-only tile flicker.
 * - Reads selected tile ids through the FX Bus private tile-selection model.
 * - Emits socket payloads only; no PIXI/canvas mutation happens here.
 *
 * Actions:
 * - Apply: fx.tileFlicker.start
 * - Stop Selected: fx.tileFlicker.stop with selected tileIds
 * - Stop All: fx.tileFlicker.stop without tileIds
 *
 * Copy Macro:
 * - buildApplyPayload(root, runtime) returns the same payload used by Apply.
 * - Static macro copying requires selected tiles, because tileIds are baked into the payload.
 */

import {
  normaliseHex,
  num,
  selectedTileIds,
  syncColourPair
} from "./shared/panelUtils.js";

const TAB_ID = "tileFlicker";

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
   * Tile Flicker macros are intentionally static. Copy Macro must therefore bake
   * the selected tile ids into the generated payload. If no tiles are selected,
   * this is a validation error rather than a silent empty-target macro.
   */
  const tileIds = selectedTileIds();

  if (tileIds.length === 0) {
    throw new Error("Tile Flicker: no tiles selected");
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

function buildPayload(panel, tileIds) {
  /**
   * Large comment:
   * Build the shared Tile Flicker start payload.
   *
   * This helper is used by both Apply and Copy Macro, so those two workflows
   * stay mechanically identical. The caller is responsible for deciding how tile
   * selection validation is surfaced.
   */
  return {
    action: "fx.tileFlicker.start",
    tileIds,
    minAlpha: num(
      panel.querySelector('input[name="tileFlickerMinAlpha"]')?.value,
      0.35
    ),
    maxAlpha: num(
      panel.querySelector('input[name="tileFlickerMaxAlpha"]')?.value,
      1.0
    ),
    freqHz: num(
      panel.querySelector('input[name="tileFlickerFreqHz"]')?.value,
      8
    ),
    jitter: num(
      panel.querySelector('input[name="tileFlickerJitter"]')?.value,
      0.25
    ),
    randomPhase: checked(panel, "tileFlickerRandomPhase", true),
    useTint: checked(panel, "tileFlickerUseTint", false),
    tint: normaliseHex(
      panel.querySelector('input[name="tileFlickerTint"]')?.value,
      "#ffffff"
    ),
    blendMode: selectValue(panel, "tileFlickerBlendMode", "NORMAL"),
    foregroundFadeAlpha: num(
      panel.querySelector('input[name="tileFlickerForegroundFadeAlpha"]')?.value,
      0.25
    )
  };
}

export function tileFlickerTabDef() {
  return {
    id: TAB_ID,
    label: "Tile Flicker",

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
      if (!panel) throw new Error("Tile Flicker: panel not found");

      const tileIds = getSelectedTileIdsOrThrow();

      return buildPayload(panel, tileIds);
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      syncColourPair(
        panel,
        "tileFlickerTintPicker",
        "tileFlickerTint",
        "#ffffff"
      );

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
          action: "fx.tileFlicker.stop",
          tileIds
        });
      }

      function stopAll() {
        runtime.emit({
          action: "fx.tileFlicker.stop"
        });
      }

      panel
        .querySelector('button[type="button"][data-action="tileFlickerApply"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          apply.call(this);
        });

      panel
        .querySelector('button[type="button"][data-action="tileFlickerStopSelected"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stopSelected();
        });

      panel
        .querySelector('button[type="button"][data-action="tileFlickerStopAll"]')
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          stopAll();
        });
    }
  };
}