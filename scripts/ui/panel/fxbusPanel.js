/**
 * FX Bus - Panel Shell
 *
 * Adds persistence of last-used values via game.settings (client scope).
 */

import { tokenOscTabDef } from "./tabs/tokenOscTab.js";
import { screenShakeTabDef } from "./tabs/screenShakeTab.js";
import { screenPulseTabDef } from "./tabs/screenPulseTab.js";
import { screenVignetteTabDef } from "./tabs/screenVignetteTab.js";

function panelCss() {
  return `
    <style>
      .fxbus-tabs { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
      .fxbus-tab-btn {
        border: 1px solid var(--color-border-light-primary);
        border-radius: 10px;
        padding: 6px 10px;
        cursor: pointer;
        background: var(--color-bg-option);
        user-select: none;
        font-weight: 650;
      }
      .fxbus-tab-btn.is-active {
        background: var(--color-bg-button);
        border-color: var(--color-border-highlight);
      }
      .fxbus-panel-section { display:none; }
      .fxbus-panel-section.is-active { display:block; }
      .fxbus-grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap:10px; }
      .fxbus-inline { display:flex; gap:8px; align-items:center; }
      .fxbus-muted { opacity: 0.8; font-size: 12px; line-height: 1.2; }
      .fxbus-divider { margin: 10px 0; }
      .fxbus-row { display:flex; gap:10px; align-items:center; justify-content:flex-start; flex-wrap:wrap; }
      .fxbus-row button { min-width: 120px; }
      .fxbus-smallbtn { min-width: 90px !important; }
    </style>
  `;
}

function buildTabs() {
  return [tokenOscTabDef(), screenShakeTabDef(), screenPulseTabDef(), screenVignetteTabDef()];
}

function activateTab(root, tabId) {
  const buttons = Array.from(root.querySelectorAll(".fxbus-tab-btn"));
  const panels = Array.from(root.querySelectorAll(".fxbus-panel-section"));
  for (const b of buttons) b.classList.toggle("is-active", b.dataset.tab === tabId);
  for (const p of panels) p.classList.toggle("is-active", p.dataset.panel === tabId);
}

function readState() {
  try {
    return game.settings.get("fxbus", "uiState") ?? {};
  } catch (err) {
    console.warn("[FX Bus] uiState read failed", err);
    return {};
  }
}

async function writeState(patch) {
  try {
    const current = readState();
    const next = { ...current, ...patch };
    await game.settings.set("fxbus", "uiState", next);
  } catch (err) {
    console.warn("[FX Bus] uiState write failed", err);
  }
}

function applyStateToForm(root, state) {
  const form = root;

  for (const [name, value] of Object.entries(state ?? {})) {
    const el = form.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) continue;

    if (el.type === "checkbox") {
      el.checked = Boolean(value);
      continue;
    }

    if (el.tagName === "SELECT") {
      el.value = String(value);
      continue;
    }

    // number/text/color
    el.value = String(value);
  }
}

function captureStateFromForm(root) {
  const form = root;
  const elements = Array.from(form.querySelectorAll("[name]"));

  const state = {};
  for (const el of elements) {
    const name = el.getAttribute("name");
    if (!name) continue;

    if (el.type === "checkbox") {
      state[name] = Boolean(el.checked);
      continue;
    }

    // Preserve numeric fields as numbers where possible.
    if (el.type === "number") {
      const n = Number(el.value);
      state[name] = Number.isFinite(n) ? n : el.value;
      continue;
    }

    state[name] = el.value;
  }
  return state;
}

function wireStatePersistence(root) {
  let timer = null;

  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const snapshot = captureStateFromForm(root);
      writeState(snapshot);
      timer = null;
    }, 150);
  };

  root.addEventListener("input", scheduleSave, true);
  root.addEventListener("change", scheduleSave, true);
}

export function openFxBusGmControlPanel(options = {}) {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;
  if (!runtime?.emit) {
    ui.notifications.error("FX Bus runtime not found. Enable fxbus and reload.");
    return;
  }

  const tabs = buildTabs();
  const state = readState();

  const requestedTab = typeof options.startTab === "string" ? options.startTab : null;
  const rememberedTab = typeof state.__activeTab === "string" ? state.__activeTab : null;
  const startTab = requestedTab ?? rememberedTab ?? tabs[0]?.id ?? "osc";

  const tabButtonsHtml = tabs
    .map((t) => `<div class="fxbus-tab-btn" data-tab="${t.id}">${t.label}</div>`)
    .join("");

  const panelsHtml = tabs.map((t) => t.contentHtml()).join("");

  const content = `
    <form class="fxbus-panel">
      ${panelCss()}
      <nav class="fxbus-tabs" aria-label="FX Bus tabs">
        ${tabButtonsHtml}
        <div class="fxbus-tab-btn" data-tab="reset">Reset</div>
      </nav>

      ${panelsHtml}

      <section class="fxbus-panel-section" data-panel="reset">
        <p class="fxbus-muted">Global reset immediately stops all FX and restores transforms.</p>
        <div class="fxbus-row">
          <button type="button" class="fxbus-do" data-do="doReset" style="min-width:160px;">Execute Reset</button>
        </div>
      </section>
    </form>
  `;

  const dlg = new Dialog(
    {
      title: "FX Bus - GM Control Panel",
      content,
      buttons: { close: { label: "Close" } },
      default: "close",
      render: (html) => {
        const root = html[0].querySelector("form.fxbus-panel");
        if (!root) return;

        // Restore remembered values into the form.
        applyStateToForm(root, state);

        // Tabs
        const buttons = Array.from(root.querySelectorAll(".fxbus-tab-btn"));
        for (const b of buttons) {
          b.addEventListener("click", async () => {
            const tabId = b.dataset.tab;
            activateTab(root, tabId);
            await writeState({ __activeTab: tabId });
          });
        }

        // Wire each tab module
        for (const t of tabs) t.wire(root, runtime);

        // Reset action
        root.querySelector('button[data-do="doReset"]')?.addEventListener("click", () => {
          runtime.emit({ action: "fx.bus.reset" });
        });

        // Persist any future edits
        wireStatePersistence(root);

        // Activate starting tab (after restore so visible values are correct)
        activateTab(root, startTab);
      }
    },
    { width: 540 }
  );

  dlg.render(true);
}
