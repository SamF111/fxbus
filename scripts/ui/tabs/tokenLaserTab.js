// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tokenLaserTab.js

/**
 * FX Bus - Token Tether Tab (Foundry v13+ ApplicationV2)
 *
 * Behaviour:
 * - Uses native Foundry token selection.
 * - First selected token becomes the tether source.
 * - All remaining selected tokens become tether targets.
 * - Link mode controls whether tethers form a source fan or a full token network.
 * - Layer mode controls whether graphics render above tokens, below tokens, or split.
 * - Motion mode controls whether packets move along each path.
 * - Apply starts or updates a tether using the configured laserId.
 * - Toggle uses the configured laserId as an authoritative GM-side toggle.
 * - Stop stops the configured laserId.
 * - Stop All removes all token tethers.
 *
 * Selection-layer metadata:
 * - selectionLayer: "tokens" tells the GM panel to activate Foundry's native
 *   Token selector when this tab is opened or clicked.
 *
 * v13/v14 stability:
 * - No MutationObserver.
 * - No live token Hooks from this tab.
 * - No continuous canvas.tokens.controlled reads for tab text.
 * - Token IDs are read only when Apply, Toggle, or Copy to Macro builds a payload.
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) for the generic macro path.
 * - Provides buildMacroSource(root, runtime, options) for an authoritative toggle macro.
 * - The custom macro checks GM-local state and emits explicit start or stop.
 * - This avoids late-joining clients interpreting raw toggle in the opposite state.
 */

import {
  normaliseHex,
  num,
  selectedTokenIds,
  setDisabled,
  syncColourPair
} from "./shared/panelUtils.js";

const TAB_ID = "laser";
const EFFECT_NAME = "tokenLaser";

function getPanel(root) {
  const panel = root.querySelector(
    `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
  );

  if (!panel) throw new Error("TokenTether: panel not found");

  return panel;
}

function getLaserId(panel) {
  const explicit = String(
    panel.querySelector('input[name="laserId"]')?.value ?? ""
  ).trim();

  return explicit.length > 0 ? explicit : "token-tether";
}

function getSelectedLaserTokens() {
  /**
   * Large comment:
   * Read selected token IDs only when a user action actually needs a payload.
   *
   * Do not read selected tokens during passive tab rendering or summary updates.
   * That path has been implicated in crashes on token-related UI interaction.
   */
  const tokenIds = selectedTokenIds();

  if (!Array.isArray(tokenIds) || tokenIds.length < 2) {
    throw new Error("TokenTether: select at least two tokens");
  }

  return {
    sourceTokenId: tokenIds[0],
    targetTokenIds: tokenIds.slice(1)
  };
}

function getLaserParams(panel) {
  const until = panel.querySelector('input[name="laserUntilStopped"]');
  const duration = panel.querySelector('input[name="laserDurationMs"]');

  return {
    laserId: getLaserId(panel),

    colour: normaliseHex(
      panel.querySelector('input[name="laserColour"]')?.value,
      "#ff2222"
    ),

    secondaryColour: normaliseHex(
      panel.querySelector('input[name="laserSecondaryColour"]')?.value,
      "#ffffff"
    ),

    outlineColour: normaliseHex(
      panel.querySelector('input[name="laserOutlineColour"]')?.value,
      "#000000"
    ),

    width: num(panel.querySelector('input[name="laserWidth"]')?.value, 4),
    alpha: num(panel.querySelector('input[name="laserAlpha"]')?.value, 0.95),
    glow: Boolean(panel.querySelector('input[name="laserGlow"]')?.checked),
    pulse: Boolean(panel.querySelector('input[name="laserPulse"]')?.checked),
    pulseSpeed: num(panel.querySelector('input[name="laserPulseSpeed"]')?.value, 2),

    style: String(panel.querySelector('select[name="laserStyle"]')?.value ?? "laser"),
    linkMode: String(panel.querySelector('select[name="laserLinkMode"]')?.value ?? "network"),
    layerMode: String(panel.querySelector('select[name="laserLayerMode"]')?.value ?? "split"),

    sagPx: num(panel.querySelector('input[name="laserSagPx"]')?.value, 0),
    segments: num(panel.querySelector('input[name="laserSegments"]')?.value, 24),

    twistFreq: num(panel.querySelector('input[name="laserTwistFreq"]')?.value, 0.45),
    twistSpeed: num(panel.querySelector('input[name="laserTwistSpeed"]')?.value, 1.2),

    swayPx: num(panel.querySelector('input[name="laserSwayPx"]')?.value, 0),
    swayHz: num(panel.querySelector('input[name="laserSwayHz"]')?.value, 0.8),

    linkSpacingPx: num(panel.querySelector('input[name="laserLinkSpacingPx"]')?.value, 14),
    linkLengthPx: num(panel.querySelector('input[name="laserLinkLengthPx"]')?.value, 16),
    linkWidthPx: num(panel.querySelector('input[name="laserLinkWidthPx"]')?.value, 7),

    flowDirection: String(panel.querySelector('select[name="laserFlowDirection"]')?.value ?? "none"),
    flowSpeed: num(panel.querySelector('input[name="laserFlowSpeed"]')?.value, 1.5),
    flowCount: num(panel.querySelector('input[name="laserFlowCount"]')?.value, 3),
    flowSize: num(panel.querySelector('input[name="laserFlowSize"]')?.value, 0),

    flowColour: normaliseHex(
      panel.querySelector('input[name="laserFlowColour"]')?.value,
      "#ffffff"
    ),

    durationMs: until?.checked ? 0 : num(duration?.value, 1500)
  };
}

function buildPayload(root, action) {
  const panel = getPanel(root);
  const tokenData = getSelectedLaserTokens();

  return {
    action,
    ...tokenData,
    ...getLaserParams(panel)
  };
}

function buildStopPayload(root) {
  const panel = getPanel(root);

  return {
    action: "fx.tokenLaser.stop",
    laserId: getLaserId(panel)
  };
}

function buildAuthoritativeTogglePayload(root, runtime) {
  /**
   * Large comment:
   * Resolve Toggle on the GM client into an explicit start or stop payload.
   *
   * Do not emit fx.tokenLaser.toggle here. Raw toggle is unsafe across clients
   * with different local state, especially when a player joins after the tether
   * was started.
   */
  const panel = getPanel(root);
  const laserId = getLaserId(panel);
  const store = runtime?.tokenFx?.get?.(EFFECT_NAME);
  const isActive = Boolean(store?.has?.(laserId));

  if (isActive) {
    return {
      action: "fx.tokenLaser.stop",
      laserId
    };
  }

  return buildPayload(root, "fx.tokenLaser.start");
}

function jsStringLiteral(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

function buildMacroHeader(macroName, meta, laserId) {
  const lines = [
    "/**",
    ` * ${jsStringLiteral(macroName || "FX Bus - Token Tether")}`,
    " *",
    " * Generated by FX Bus GM Control Panel.",
    " * Action: fx.tokenLaser.authoritativeToggle",
    ` * Tether ID: ${jsStringLiteral(laserId)}`,
    meta?.generatedAt ? ` * Generated: ${jsStringLiteral(meta.generatedAt)}` : null,
    meta?.generatedBy ? ` * User: ${jsStringLiteral(meta.generatedBy)}` : null,
    meta?.fxbusVersion ? ` * FX Bus: v${jsStringLiteral(meta.fxbusVersion)}` : null,
    " *",
    " * Behaviour:",
    " * - Visual-only. Does not update Documents.",
    " * - GM-local state decides whether to emit explicit start or stop.",
    " * - Avoids raw toggle desync for late-joining clients.",
    " */"
  ].filter(Boolean);

  return lines.join("\n");
}

function buildAuthoritativeToggleMacroSource(startPayload, macroName, meta) {
  /**
   * Large comment:
   * Build a Token Tether macro that behaves as an authoritative toggle.
   */
  const laserId = String(startPayload?.laserId ?? "token-tether").trim() || "token-tether";

  const safeStartPayload = {
    ...startPayload,
    action: "fx.tokenLaser.start",
    laserId
  };

  const stopPayload = {
    action: "fx.tokenLaser.stop",
    laserId
  };

  const header = buildMacroHeader(macroName, meta, laserId);
  const startJson = JSON.stringify(safeStartPayload, null, 2);
  const stopJson = JSON.stringify(stopPayload, null, 2);

  return `${header}

(() => {
  if (!game.user.isGM) return;

  const runtime = globalThis.fxbus;

  if (!runtime?.emit) {
    ui.notifications?.error?.("FX Bus runtime not available.");
    return;
  }

  const laserId = ${JSON.stringify(laserId)};
  const store = runtime?.tokenFx?.get?.("${EFFECT_NAME}");
  const isActive = Boolean(store?.has?.(laserId));

  const startPayload = ${startJson};
  const stopPayload = ${stopJson};

  runtime.emit(isActive ? stopPayload : startPayload);
})();`;
}

function updateSelectedTokenSummary(panel) {
  /**
   * Large comment:
   * Keep the summary static.
   *
   * Earlier versions queried canvas.tokens.controlled and wrote token names into
   * this field from hooks, select changes, and MutationObserver callbacks. That
   * path is suspected of causing crashes in v13/v14.
   */
  const el = panel.querySelector("[data-laser-selection-summary]");
  if (!el) return;

  el.textContent = "Select at least two tokens with Foundry's native Token tool, then use Apply or Toggle.";
}

function wireSelectionSummary(panel) {
  /**
   * Large comment:
   * Intentionally passive.
   *
   * No Hooks.
   * No MutationObserver.
   * No live token reads.
   */
  updateSelectedTokenSummary(panel);

  panel.__fxbusLaserCleanup = () => {
    // no hooks to remove
  };
}

function syncDurationControls(panel) {
  const until = panel.querySelector('input[name="laserUntilStopped"]');
  const duration = panel.querySelector('input[name="laserDurationMs"]');

  if (!until || !duration) return;

  const sync = () => setDisabled(duration, Boolean(until.checked));

  until.addEventListener("change", sync);
  sync();
}

function syncFlowControls(panel) {
  const direction = panel.querySelector('select[name="laserFlowDirection"]');
  const speed = panel.querySelector('input[name="laserFlowSpeed"]');
  const count = panel.querySelector('input[name="laserFlowCount"]');
  const size = panel.querySelector('input[name="laserFlowSize"]');
  const colourPicker = panel.querySelector('input[name="laserFlowColourPicker"]');
  const colourText = panel.querySelector('input[name="laserFlowColour"]');

  if (!direction) return;

  const sync = () => {
    const disabled = direction.value === "none";
    setDisabled(speed, disabled);
    setDisabled(count, disabled);
    setDisabled(size, disabled);
    setDisabled(colourPicker, disabled);
    setDisabled(colourText, disabled);
  };

  direction.addEventListener("change", sync);
  sync();
}

function syncProceduralControls(panel) {
  /**
   * Large comment:
   * Disable irrelevant advanced procedural controls based on the selected style.
   *
   * This does not read tokens and does not emit effects.
   */
  const style = panel.querySelector('select[name="laserStyle"]');

  const sag = panel.querySelector('input[name="laserSagPx"]');
  const segments = panel.querySelector('input[name="laserSegments"]');
  const sway = panel.querySelector('input[name="laserSwayPx"]');
  const swayHz = panel.querySelector('input[name="laserSwayHz"]');

  const twistFreq = panel.querySelector('input[name="laserTwistFreq"]');
  const twistSpeed = panel.querySelector('input[name="laserTwistSpeed"]');

  const chainSpacing = panel.querySelector('input[name="laserLinkSpacingPx"]');
  const chainLength = panel.querySelector('input[name="laserLinkLengthPx"]');
  const chainWidth = panel.querySelector('input[name="laserLinkWidthPx"]');

  if (!style) return;

  const sync = () => {
    const value = style.value;
    const isProceduralCurve = ["rope", "chain", "cable"].includes(value);
    const isRope = value === "rope";
    const isChain = value === "chain";

    setDisabled(sag, !isProceduralCurve);
    setDisabled(segments, !isProceduralCurve);
    setDisabled(sway, !isProceduralCurve);
    setDisabled(swayHz, !isProceduralCurve);

    setDisabled(twistFreq, !isRope);
    setDisabled(twistSpeed, true);

    setDisabled(chainSpacing, !isChain);
    setDisabled(chainLength, !isChain);
    setDisabled(chainWidth, !isChain);
  };

  style.addEventListener("change", sync);
  sync();
}

export function tokenLaserTabDef() {
  return {
    id: TAB_ID,
    label: "Token Tether",
    selectionLayer: "tokens",

    buildApplyPayload(root, _runtime) {
      return buildPayload(root, "fx.tokenLaser.start");
    },

    buildMacroSource(root, _runtime, options = {}) {
      const startPayload = buildPayload(root, "fx.tokenLaser.start");

      return buildAuthoritativeToggleMacroSource(
        startPayload,
        options.macroName ?? "FX Bus - Token Tether",
        options.meta ?? {}
      );
    },

    macroName(root) {
      try {
        const panel = getPanel(root);
        return `FX Bus - Token Tether - ${getLaserId(panel)}`;
      } catch {
        return "FX Bus - Token Tether";
      }
    },

    wire(root, runtime) {
      const panel = root.querySelector(
        `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
      );
      if (!panel) return;

      try {
        panel.__fxbusLaserCleanup?.();
      } catch {
        // ignore
      }

      syncColourPair(panel, "laserColourPicker", "laserColour", "#ff2222");
      syncColourPair(panel, "laserSecondaryColourPicker", "laserSecondaryColour", "#ffffff");
      syncColourPair(panel, "laserOutlineColourPicker", "laserOutlineColour", "#000000");
      syncColourPair(panel, "laserFlowColourPicker", "laserFlowColour", "#ffffff");

      syncDurationControls(panel);
      syncFlowControls(panel);
      syncProceduralControls(panel);
      wireSelectionSummary(panel);

      function apply() {
        try {
          runtime.emit(buildPayload(root, "fx.tokenLaser.update"));
        } catch (err) {
          ui.notifications.warn("Select at least two tokens for Token Tether.");
          console.warn("[FX Bus] Token Tether apply failed", err);
        }
      }

      function toggle() {
        try {
          runtime.emit(buildAuthoritativeTogglePayload(root, runtime));
        } catch (err) {
          ui.notifications.warn("Select at least two tokens for Token Tether.");
          console.warn("[FX Bus] Token Tether toggle failed", err);
        }
      }

      function stop() {
        try {
          runtime.emit(buildStopPayload(root));
        } catch (err) {
          ui.notifications.warn("Token Tether stop failed.");
          console.warn("[FX Bus] Token Tether stop failed", err);
        }
      }

      function stopAll() {
        runtime.emit({ action: "fx.tokenLaser.stopAll" });
      }

      for (const button of Array.from(panel.querySelectorAll(".fxbus-do[data-do]"))) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();

          const action = button.dataset.do;

          if (action === "laserApply") apply();
          if (action === "laserToggle") toggle();
          if (action === "laserStop") stop();
          if (action === "laserStopAll") stopAll();
        });
      }
    }
  };
}