// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelState.js

/**
 * FX Bus - Panel State
 *
 * Purpose:
 * - Read and write persisted per-client panel state.
 * - Reapply saved form values after Foundry recreates the panel DOM.
 * - Capture form values generically across all tab panels.
 * - Debounce state writes so sliders and number fields do not spam settings.
 */

import {
  MODULE_ID,
  UI_STATE_KEY
} from "../../constants.js";


function cssEscapeForRoot(root, value) {
  const css = root?.ownerDocument?.defaultView?.CSS ?? globalThis.CSS;
  if (css && typeof css.escape === "function") return css.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

export function readState() {
  try {
    return game.settings.get(MODULE_ID, UI_STATE_KEY) ?? {};
  } catch (err) {
    console.warn("[FX Bus] uiState read failed", err);
    return {};
  }
}

export async function writeState(patch) {
  try {
    const current = readState();
    const next = { ...current, ...patch };
    await game.settings.set(MODULE_ID, UI_STATE_KEY, next);
  } catch (err) {
    console.warn("[FX Bus] uiState write failed", err);
  }
}

export function applyStateToForm(root, state) {
  for (const [name, value] of Object.entries(state ?? {})) {
    if (String(name).startsWith("__")) continue;

    const escapedName = cssEscapeForRoot(root, name);
    const el = root.querySelector(`[name="${escapedName}"]`);
    if (!el) continue;

    if (el.type === "checkbox") {
      el.checked = Boolean(value);
      continue;
    }

    if (el.tagName === "SELECT") {
      el.value = String(value);
      continue;
    }

    el.value = String(value);
  }
}

export function captureStateFromForm(root) {
  const elements = Array.from(root.querySelectorAll("[name]"));
  const state = {};

  for (const el of elements) {
    const name = el.getAttribute("name");
    if (!name) continue;

    if (el.type === "checkbox") {
      state[name] = Boolean(el.checked);
      continue;
    }

    if (el.type === "number") {
      const n = Number(el.value);
      state[name] = Number.isFinite(n) ? n : el.value;
      continue;
    }

    state[name] = el.value;
  }

  return state;
}

export function wireStatePersistence(root, signal) {
  let timer = null;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const scheduleSave = () => {
    clearTimer();

    timer = setTimeout(() => {
      writeState(captureStateFromForm(root));
      timer = null;
    }, 150);
  };

  root.addEventListener("input", scheduleSave, { capture: true, signal });
  root.addEventListener("change", scheduleSave, { capture: true, signal });

  signal?.addEventListener?.("abort", clearTimer, { once: true });
}

