// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tokenRecoilTab.js

/**
 * FX Bus - Token Recoil Tab (Foundry v13+ ApplicationV2)
 *
 * Purpose:
 * - Build and emit fx.tokenRecoil.burst payloads from the GM panel.
 * - Support macro chaining through Copy to Macro.
 * - Support selected-token origin, manual origin, and picked canvas-point origin.
 * - Support selected-token exclusion.
 *
 * Behaviour:
 * - This tab does not perform any animation itself.
 * - It only gathers UI values and emits socket payloads.
 * - The effect implementation lives in scripts/effects/tokenRecoilFx.js.
 *
 * Expected template fields:
 * - recoilOriginX
 * - recoilOriginY
 * - recoilUseSelectedOrigin
 * - recoilExcludeSelected
 * - recoilAffect
 * - recoilMode
 * - recoilRadiusPx
 * - recoilDistancePx
 * - recoilDurationMs
 * - recoilFalloff
 * - recoilAngleDeg
 * - recoilMaxDelayMs
 * - recoilRotationDeg
 * - recoilIncludeHidden
 *
 * Expected template buttons:
 * - data-action="recoilPickOriginOnCanvas"
 * - data-action="recoilSetOriginFromSelected"
 * - data-action="recoilStart"
 * - data-action="recoilStop"
 * - data-action="fxbusCopyToMacro"
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 * - Canvas origin picking is explicitly cancelled if this render's signal aborts.
 */

import { num, setDisabled, selectedTokenIds } from "./shared/panelUtils.js";

const TAB_ID = "recoil";

let activeOriginPick = null;

function getPanel(root) {
  return root.querySelector(`.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`);
}

function getSelectedOrigin() {
  const token = canvas?.tokens?.controlled?.[0];
  if (!token?.center) return null;

  return {
    x: Number(token.center.x),
    y: Number(token.center.y),
    tokenId: token.id
  };
}

function setInputValue(panel, name, value) {
  const el = panel?.querySelector?.(`[name="${name}"]`);
  if (!el) return;

  el.value = String(value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function setCheckboxValue(panel, name, value) {
  const el = panel?.querySelector?.(`input[name="${name}"]`);
  if (!el) return;

  el.checked = Boolean(value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function getCheckbox(panel, name, fallback = false) {
  const el = panel?.querySelector?.(`input[name="${name}"]`);
  if (!el) return fallback;

  return Boolean(el.checked);
}

function getString(panel, name, fallback) {
  const el = panel?.querySelector?.(`[name="${name}"]`);
  const value = String(el?.value ?? "").trim();

  return value.length ? value : fallback;
}

function getOriginFromForm(panel) {
  const x = num(panel.querySelector('input[name="recoilOriginX"]')?.value, NaN);
  const y = num(panel.querySelector('input[name="recoilOriginY"]')?.value, NaN);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

function buildTokenIds(panel) {
  const affect = getString(panel, "recoilAffect", "tokensInRadius");

  if (affect === "listedOnly" || affect === "selectedOnly" || affect === "selectedInRadius") {
    return selectedTokenIds();
  }

  return [];
}

function buildExcludeTokenIds(panel, originSourceTokenId) {
  if (!getCheckbox(panel, "recoilExcludeSelected", true)) return [];

  const ids = selectedTokenIds();

  if (originSourceTokenId && !ids.includes(originSourceTokenId)) {
    ids.push(originSourceTokenId);
  }

  return ids;
}

function syncOriginControls(panel) {
  const useSelected = getCheckbox(panel, "recoilUseSelectedOrigin", false);

  const x = panel.querySelector('input[name="recoilOriginX"]');
  const y = panel.querySelector('input[name="recoilOriginY"]');

  setDisabled(x, useSelected);
  setDisabled(y, useSelected);
}

function updateOriginFromSelected(panel) {
  const origin = getSelectedOrigin();

  if (!origin) {
    ui.notifications.warn("FX Bus: select one token to use as the recoil origin.");
    return null;
  }

  setInputValue(panel, "recoilOriginX", Math.round(origin.x));
  setInputValue(panel, "recoilOriginY", Math.round(origin.y));

  return origin;
}

function cancelActiveOriginPick() {
  if (!activeOriginPick) return;

  try {
    activeOriginPick.target.off("pointerdown", activeOriginPick.handler);
  } catch {
    // ignore
  }

  try {
    activeOriginPick.target.cursor = activeOriginPick.previousCursor;
  } catch {
    // ignore
  }

  activeOriginPick = null;
}

function getCanvasPointFromPointerEvent(event) {
  /**
   * Large comment:
   * Resolve a clicked canvas position in scene/canvas coordinates.
   *
   * PIXI event shapes differ between Foundry/PIXI versions. Prefer
   * event.data.getLocalPosition(canvas.stage), then fall back to global coordinates
   * transformed through canvas.stage.
   */
  try {
    if (event?.data?.getLocalPosition && canvas?.stage) {
      const p = event.data.getLocalPosition(canvas.stage);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
        return { x: p.x, y: p.y };
      }
    }
  } catch {
    // ignore
  }

  try {
    const global = event?.global ?? event?.data?.global;
    if (global && canvas?.stage?.toLocal) {
      const p = canvas.stage.toLocal(global);
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) {
        return { x: p.x, y: p.y };
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function beginPickOriginOnCanvas(panel) {
  const stage = canvas?.stage;

  if (!stage?.on || !stage?.off) {
    ui.notifications.warn("FX Bus: canvas stage unavailable.");
    return;
  }

  cancelActiveOriginPick();

  setCheckboxValue(panel, "recoilUseSelectedOrigin", false);
  syncOriginControls(panel);

  const previousCursor = stage.cursor;

  const handler = (event) => {
    event?.stopPropagation?.();

    const point = getCanvasPointFromPointerEvent(event);

    cancelActiveOriginPick();

    if (!point) {
      ui.notifications.warn("FX Bus: could not resolve clicked canvas point.");
      return;
    }

    setInputValue(panel, "recoilOriginX", Math.round(point.x));
    setInputValue(panel, "recoilOriginY", Math.round(point.y));

    ui.notifications.info("FX Bus: recoil origin picked.");
  };

  activeOriginPick = {
    target: stage,
    handler,
    previousCursor
  };

  try {
    stage.cursor = "crosshair";
  } catch {
    // ignore
  }

  stage.on("pointerdown", handler);

  ui.notifications.info("FX Bus: click the scene to pick the recoil origin.");
}

function cancelOriginPickOnAbort(signal) {
  /**
   * Large comment:
   * Canvas-stage pointer handlers are not DOM event listeners, so AbortSignal
   * cannot remove them automatically.
   *
   * Bind one abort listener for the current render so a detached/re-rendered
   * panel cannot leave a stale canvas pick handler behind.
   */
  if (!signal) return;

  signal.addEventListener(
    "abort",
    () => {
      cancelActiveOriginPick();
    },
    { once: true }
  );
}

export function tokenRecoilTabDef() {
  return {
    id: TAB_ID,
    label: "Token Recoil",
    selectionLayer: "tokens",

    /**
     * Build the socket payload for Apply / Copy-to-Macro.
     *
     * @param {HTMLElement} root
     * @param {object} _runtime
     * @returns {object}
     */
    buildApplyPayload(root, _runtime) {
      const panel = getPanel(root);
      if (!panel) throw new Error("TokenRecoil: panel not found");

      let originSourceTokenId = null;
      let origin = null;

      if (getCheckbox(panel, "recoilUseSelectedOrigin", false)) {
        const selectedOrigin = getSelectedOrigin();

        if (!selectedOrigin) {
          throw new Error("TokenRecoil: selected origin token not found");
        }

        origin = {
          x: selectedOrigin.x,
          y: selectedOrigin.y
        };

        originSourceTokenId = selectedOrigin.tokenId;

        setInputValue(panel, "recoilOriginX", Math.round(origin.x));
        setInputValue(panel, "recoilOriginY", Math.round(origin.y));
      } else {
        origin = getOriginFromForm(panel);

        if (!origin) {
          throw new Error("TokenRecoil: invalid manual origin");
        }
      }

      const payload = {
        action: "fx.tokenRecoil.burst",
        origin,
        tokenIds: buildTokenIds(panel),
        excludeTokenIds: buildExcludeTokenIds(panel, originSourceTokenId),
        affect: getString(panel, "recoilAffect", "tokensInRadius"),
        mode: getString(panel, "recoilMode", "radialOut"),
        radiusPx: num(panel.querySelector('input[name="recoilRadiusPx"]')?.value, 500),
        distancePx: num(panel.querySelector('input[name="recoilDistancePx"]')?.value, 40),
        durationMs: num(panel.querySelector('input[name="recoilDurationMs"]')?.value, 450),
        falloff: getString(panel, "recoilFalloff", "linear"),
        angleDeg: num(panel.querySelector('input[name="recoilAngleDeg"]')?.value, 0),
        maxDelayMs: num(panel.querySelector('input[name="recoilMaxDelayMs"]')?.value, 0),
        rotationDeg: num(panel.querySelector('input[name="recoilRotationDeg"]')?.value, 0),
        includeHidden: getCheckbox(panel, "recoilIncludeHidden", false)
      };

      if (!payload.tokenIds.length) delete payload.tokenIds;
      if (!payload.excludeTokenIds.length) delete payload.excludeTokenIds;

      return payload;
    },

    /**
     * Macro name used by the shared Copy to Macro action.
     *
     * @returns {string}
     */
    macroName() {
      return "FX Bus - Token Recoil";
    },

    /**
     * Wire panel controls.
     *
     * @param {HTMLElement} root
     * @param {object} runtime
     * @param {AbortSignal} signal
     */
    wire(root, runtime, signal) {
      const panel = getPanel(root);
      if (!panel) return;

      cancelOriginPickOnAbort(signal);

      const useSelected = panel.querySelector('input[name="recoilUseSelectedOrigin"]');

      if (useSelected) {
        useSelected.addEventListener(
          "change",
          () => {
            syncOriginControls(panel);
          },
          { signal }
        );

        syncOriginControls(panel);
      }

      panel
        .querySelector('button[type="button"][data-action="recoilPickOriginOnCanvas"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            beginPickOriginOnCanvas(panel);
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="recoilSetOriginFromSelected"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            updateOriginFromSelected(panel);
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="recoilStart"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            try {
              const payload = this.buildApplyPayload(root, runtime);
              runtime.emit(payload);
            } catch (err) {
              ui.notifications.error("FX Bus: failed to build Token Recoil payload. See console.");
              console.error("[FX Bus] Token Recoil payload failed", err);
            }
          },
          { signal }
        );

      panel
        .querySelector('button[type="button"][data-action="recoilStop"]')
        ?.addEventListener(
          "click",
          (event) => {
            event.preventDefault();

            const tokenIds = selectedTokenIds();

            if (tokenIds.length > 0) {
              runtime.emit({
                action: "fx.tokenRecoil.stop",
                tokenIds
              });
              return;
            }

            runtime.emit({
              action: "fx.tokenRecoil.stop"
            });
          },
          { signal }
        );
    }
  };
}