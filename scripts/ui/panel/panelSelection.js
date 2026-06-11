// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelSelection.js

/**
 * FX Bus - Panel Selection
 *
 * Purpose:
 * - Activate Foundry's native Token or Tile selection mode when the matching
 *   FX Bus panel category is active.
 * - Keep native Scene Controls integration out of the main ApplicationV2 class.
 * - Avoid coupling this logic to controls.js.
 */

function getSceneControlsCollection() {
  return ui?.controls?.controls ?? null;
}

function getNativeControl(controlNames) {
  /**
   * Large comment:
   * Resolve a native Foundry control group by likely names.
   *
   * Foundry versions may expose controls as either arrays or object maps. This
   * helper supports both without depending on controls.js exports.
   */
  const controls = getSceneControlsCollection();
  if (!controls) return null;

  if (Array.isArray(controls)) {
    return controls.find((control) => controlNames.includes(control?.name)) ?? null;
  }

  if (typeof controls === "object") {
    for (const name of controlNames) {
      if (controls[name]) return controls[name];
    }

    return Object.values(controls).find((control) => {
      return controlNames.includes(control?.name);
    }) ?? null;
  }

  return null;
}

function getNativeSelectToolName(control) {
  /**
   * Large comment:
   * Resolve the best native selection tool for a control group.
   *
   * Prefer "select". Fall back to the control's active tool. Fall back again to
   * the first named tool.
   */
  const tools = control?.tools;

  if (!tools) return "select";

  if (Array.isArray(tools)) {
    if (tools.some((tool) => tool?.name === "select")) return "select";

    if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
      return control.activeTool;
    }

    return tools.find((tool) => {
      return typeof tool?.name === "string" && tool.name.length > 0;
    })?.name ?? "select";
  }

  if (typeof tools === "object") {
    if (tools.select) return "select";

    if (typeof control?.activeTool === "string" && control.activeTool.length > 0) {
      return control.activeTool;
    }

    return Object.values(tools).find((tool) => {
      return typeof tool?.name === "string" && tool.name.length > 0;
    })?.name ?? "select";
  }

  return "select";
}

async function activateNativeSelectionLayer(selectionLayer) {
  /**
   * Large comment:
   * Activate native Foundry Token/Tiles selection from the panel without relying
   * on controls.js.
   *
   * This intentionally uses Foundry's native SceneControls activation. It may
   * move the left toolbar to Tokens or Tiles; that is the accepted workflow for
   * real token/tile selection.
   */
  const layer = String(selectionLayer ?? "");
  if (!layer) return false;

  const controlsUi = ui?.controls;

  if (!controlsUi || typeof controlsUi.activate !== "function") {
    ui.notifications.warn("FX Bus: native controls API unavailable.");
    return false;
  }

  const control =
    layer === "tokens"
      ? getNativeControl(["tokens", "token"])
      : layer === "tiles"
        ? getNativeControl(["tiles", "tile"])
        : null;

  if (!control?.name) {
    ui.notifications.warn(`FX Bus: could not find native ${layer} controls.`);
    return false;
  }

  const toolName = getNativeSelectToolName(control);

  try {
    await controlsUi.activate({ control: control.name, tool: toolName });
    return true;
  } catch (err) {
    console.warn("[FX Bus] Native selection activation failed.", {
      selectionLayer: layer,
      controlName: control.name,
      toolName,
      err
    });

    ui.notifications.warn(`FX Bus: failed to activate ${layer} selection.`);
    return false;
  }
}

function selectionLayerForCategory(categoryId) {
  /**
   * Large comment:
   * Resolve the native Foundry selection layer implied by a top-level FX Bus
   * category.
   *
   * This is intentionally category-level behaviour:
   * - Token category means token selection is appropriate.
   * - Tile category means tile selection is appropriate.
   * - Screen, Canvas, and Reset do not require native selection changes.
   */
  const id = String(categoryId ?? "");

  if (id === "token") return "tokens";
  if (id === "tile") return "tiles";

  return null;
}

export async function activateCategorySelectionMode(categoryId) {
  /**
   * Large comment:
   * Activate native Foundry selection based on the active FX Bus category.
   *
   * Category-level switching is deliberate. Opening Token FX should prepare token
   * selection. Opening Tile FX should prepare tile selection. Screen and Canvas
   * effects should not steal native Foundry selection mode.
   */
  const selectionLayer = selectionLayerForCategory(categoryId);
  if (!selectionLayer) return;

  await activateNativeSelectionLayer(selectionLayer);
}