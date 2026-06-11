// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\tabs\tokenBeamTab.js

/**
 * FX Bus - Token Beam Tab (Foundry v13+ ApplicationV2)
 *
 * Behaviour:
 * - Uses native Foundry token selection.
 * - Presents the effect publicly as Token Laser.
 * - Emits the internal fx.tokenBeam.* action namespace.
 * - Supports continuous beams and projectile-style travelling beam segments.
 * - Supports three selection modes:
 *   - single: selected token[0] emits one beam or projectile.
 *   - all: every selected token emits one beam or projectile.
 *   - firstToRest: selected token[0] emits one beam or projectile towards each remaining selected token.
 * - Apply starts or updates continuous beams.
 * - Apply fires new projectile instances when projectile mode is selected.
 * - Stop Selected removes beams whose source token is currently selected.
 * - Stop All removes all Token Beam effects.
 *
 * Selection-layer metadata:
 * - selectionLayer: "tokens" tells the GM panel to activate Foundry's native
 *   Token selector when this tab is opened or clicked.
 *
 * v13/v14 stability:
 * - No MutationObserver.
 * - No live token Hooks from this tab.
 * - No continuous canvas.tokens.controlled reads for tab text.
 * - Token IDs are read only when Apply, Stop Selected, or Copy Macro builds a payload.
 *
 * Copy-to-macro support:
 * - Provides buildApplyPayload(root, runtime) for the generic macro path.
 * - The selected token ids are baked into the copied macro.
 *
 * DOM lifecycle:
 * - wire(root, runtime, signal) binds listeners owned by the current panel render.
 * - The panel aborts the signal before rewiring to prevent stacked listeners.
 */

import {
  normaliseHex,
  num,
  selectedTokenIds,
  setDisabled,
  syncColourPair
} from "./shared/panelUtils.js";

const TAB_ID = "tokenBeam";

function getPanel(root) {
  const panel = root.querySelector(
    `.tab[data-group="fxbus"][data-tab="${TAB_ID}"]`
  );

  if (!panel) throw new Error("TokenBeam: panel not found");

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

function readHex(panel, name, fallback) {
  return normaliseHex(panel.querySelector(`input[name="${name}"]`)?.value, fallback);
}

function getSelectionMode(panel) {
  const value = readSelect(panel, "tokenBeamSelectionMode", "single");

  if (["single", "all", "firstToRest"].includes(value)) return value;

  return "single";
}

function getBeamMode(panel) {
  /**
   * Large comment:
   * Read the Token Laser render mode.
   *
   * Runtime values:
   * - continuous: persistent source beam, replacing the existing beam from the same source.
   * - projectile: travelling shot with an auto-generated beam id per fire.
   */
  const value = readSelect(panel, "tokenBeamMode", "continuous");

  if (["continuous", "projectile"].includes(value)) return value;

  return "continuous";
}

function getTargetLengthMode(panel) {
  /**
   * Large comment:
   * Convert the compact "Cap at target" checkbox into the runtime's existing
   * targetLengthMode setting.
   *
   * Runtime values:
   * - direction: aim at target but continue to configured beam length.
   * - endpoint: cap the beam at the target if the target is closer than lengthPx.
   *
   * Backward compatibility:
   * - If an older HBS still has tokenBeamTargetLengthMode as a select, use it.
   */
  const mode = getSelectionMode(panel);
  const trackTarget = readChecked(panel, "tokenBeamTrackTarget", true);

  if (mode !== "firstToRest" || !trackTarget) {
    return "direction";
  }

  const stopAtTarget = panel.querySelector('input[name="tokenBeamStopAtTarget"]');

  if (stopAtTarget) {
    return stopAtTarget.checked ? "endpoint" : "direction";
  }

  return readSelect(panel, "tokenBeamTargetLengthMode", "direction");
}

function getSelectedBeamTokens(panel) {
  /**
   * Large comment:
   * Read selected token IDs only when a user action actually needs a payload.
   *
   * Do not read selected tokens during passive tab rendering or summary updates.
   * This follows the Token Tether tab pattern and avoids token-selection UI
   * instability in Foundry v13/v14.
   */
  const selectionMode = getSelectionMode(panel);
  const tokenIds = selectedTokenIds();

  if (selectionMode === "single" && tokenIds.length < 1) {
    throw new Error("TokenBeam: select at least one token");
  }

  if (selectionMode === "all" && tokenIds.length < 1) {
    throw new Error("TokenBeam: select at least one token");
  }

  if (selectionMode === "firstToRest" && tokenIds.length < 2) {
    throw new Error("TokenBeam: select at least two tokens");
  }

  return {
    selectionMode,
    tokenIds
  };
}

function getBeamParams(panel) {
  const until = panel.querySelector('input[name="tokenBeamUntilStopped"]');
  const beamMode = getBeamMode(panel);

  return {
    colour: readHex(panel, "tokenBeamColour", "#ff2222"),
    coreColour: readHex(panel, "tokenBeamCoreColour", "#ffffff"),
    glowColour: readHex(panel, "tokenBeamGlowColour", "#ff2222"),

    width: readNumber(panel, "tokenBeamWidth", 14),
    coreWidth: readNumber(panel, "tokenBeamCoreWidth", 4),
    alpha: readNumber(panel, "tokenBeamAlpha", 0.95),

    lengthPx: readNumber(panel, "tokenBeamLengthPx", 900),
    startOffsetPx: readNumber(panel, "tokenBeamStartOffsetPx", 0),
    endOffsetPx: readNumber(panel, "tokenBeamEndOffsetPx", 0),

    angleMode: readSelect(panel, "tokenBeamAngleMode", "absolute"),
    angleDeg: readNumber(panel, "tokenBeamAngleDeg", 0),

    targetLengthMode: getTargetLengthMode(panel),
    trackTarget: readChecked(panel, "tokenBeamTrackTarget", true),

    beamMode,

    projectileSpeedPx: readNumber(panel, "tokenBeamProjectileSpeedPx", 1200),
    projectileTrailPx: readNumber(panel, "tokenBeamProjectileTrailPx", 220),
    projectileImpactLingerMs: readNumber(panel, "tokenBeamProjectileImpactLingerMs", 180),
    projectileFireAndForget: readChecked(panel, "tokenBeamProjectileFireAndForget", true),
    projectileStopOnImpact: readChecked(panel, "tokenBeamProjectileStopOnImpact", true),

    layerMode: readSelect(panel, "tokenBeamLayerMode", "split"),

    glow: readChecked(panel, "tokenBeamGlow", true),
    pulse: readChecked(panel, "tokenBeamPulse", true),
    pulseSpeed: readNumber(panel, "tokenBeamPulseSpeed", 2.5),

    edgeNoisePx: readNumber(panel, "tokenBeamEdgeNoisePx", 4),
    edgeNoiseHz: readNumber(panel, "tokenBeamEdgeNoiseHz", 18),
    edgeSegments: readNumber(panel, "tokenBeamEdgeSegments", 16),

    flow: readChecked(panel, "tokenBeamFlow", true),
    flowSpeed: readNumber(panel, "tokenBeamFlowSpeed", 2),
    flowCount: readNumber(panel, "tokenBeamFlowCount", 7),
    flowSize: readNumber(panel, "tokenBeamFlowSize", 0),
    flowColour: readHex(panel, "tokenBeamFlowColour", "#ffffff"),

    muzzleFlare: readChecked(panel, "tokenBeamMuzzleFlare", true),
    impactFlare: readChecked(panel, "tokenBeamImpactFlare", true),

    durationMs: until?.checked ? 0 : readNumber(panel, "tokenBeamDurationMs", 1500)
  };
}

function buildApplyPayload(root, action) {
  const panel = getPanel(root);
  const tokenData = getSelectedBeamTokens(panel);
  const params = getBeamParams(panel);

  const payload = {
    action,
    ...tokenData,
    ...params
  };

  /**
   * Large comment:
   * Continuous single-source beams should replace the previous beam from that
   * source. Projectile shots should not provide a stable beamId, because the
   * runtime auto-generates a unique id for each shot.
   */
  if (tokenData.selectionMode === "single") {
    payload.sourceTokenId = tokenData.tokenIds[0];

    if (params.beamMode !== "projectile") {
      payload.beamId = `tokenBeam-${tokenData.tokenIds[0]}`;
    }
  }

  return payload;
}

function buildStopSelectedPayload() {
  const tokenIds = selectedTokenIds();

  if (!Array.isArray(tokenIds) || tokenIds.length < 1) {
    throw new Error("TokenBeam: select at least one token");
  }

  return {
    action: "fx.tokenBeam.stop",
    tokenIds
  };
}

function updateSelectedTokenSummary(panel) {
  /**
   * Large comment:
   * Keep the summary static.
   *
   * The actual token ids are read only when the user presses Apply, Stop
   * Selected, or Copy Macro. This avoids passive token reads from tab rendering.
   */
  const el = panel.querySelector("[data-token-beam-selection-summary]");
  if (!el) return;

  el.textContent =
    "Select tokens with Foundry's native Token tool. Use Single, Apply to All, or First to Rest.";
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
}

function syncDurationControls(panel, signal) {
  const until = panel.querySelector('input[name="tokenBeamUntilStopped"]');
  const duration = panel.querySelector('input[name="tokenBeamDurationMs"]');

  if (!until || !duration) return;

  const sync = () => setDisabled(duration, Boolean(until.checked));

  until.addEventListener("change", sync, { signal });
  sync();
}

function syncSelectionModeControls(panel, signal) {
  /**
   * Large comment:
   * Disable irrelevant aiming controls when first-to-rest target tracking is active.
   *
   * In firstToRest mode with target tracking on, the runtime calculates beam
   * direction from token[0] to each target token. Manual angle controls are
   * therefore ignored and should appear disabled.
   *
   * The "Cap at target" toggle is only meaningful when a target is being
   * tracked. Otherwise the beam should continue using its configured length.
   */
  const selectionMode = panel.querySelector('select[name="tokenBeamSelectionMode"]');
  const angleMode = panel.querySelector('select[name="tokenBeamAngleMode"]');
  const angleDeg = panel.querySelector('input[name="tokenBeamAngleDeg"]');
  const trackTarget = panel.querySelector('input[name="tokenBeamTrackTarget"]');

  const targetLengthControl =
    panel.querySelector('input[name="tokenBeamStopAtTarget"]') ??
    panel.querySelector('select[name="tokenBeamTargetLengthMode"]');

  if (!selectionMode) return;

  const sync = () => {
    const mode = getSelectionMode(panel);
    const isFirstToRest = mode === "firstToRest";
    const isTrackingTarget = isFirstToRest && Boolean(trackTarget?.checked);

    setDisabled(angleMode, isTrackingTarget);
    setDisabled(angleDeg, isTrackingTarget);
    setDisabled(trackTarget, !isFirstToRest);
    setDisabled(targetLengthControl, !isTrackingTarget);
  };

  selectionMode.addEventListener("change", sync, { signal });
  trackTarget?.addEventListener("change", sync, { signal });

  sync();
}

function syncProjectileControls(panel, signal) {
  /**
   * Large comment:
   * Enable projectile-only controls only when projectile mode is selected.
   *
   * Continuous beams ignore projectile speed, trail length, fire-and-forget, and
   * impact cleanup settings.
   */
  const mode = panel.querySelector('select[name="tokenBeamMode"]');

  const speed = panel.querySelector('input[name="tokenBeamProjectileSpeedPx"]');
  const trail = panel.querySelector('input[name="tokenBeamProjectileTrailPx"]');
  const linger = panel.querySelector('input[name="tokenBeamProjectileImpactLingerMs"]');
  const fireAndForget = panel.querySelector('input[name="tokenBeamProjectileFireAndForget"]');
  const stopOnImpact = panel.querySelector('input[name="tokenBeamProjectileStopOnImpact"]');

  if (!mode) return;

  const sync = () => {
    const isProjectile = getBeamMode(panel) === "projectile";

    setDisabled(speed, !isProjectile);
    setDisabled(trail, !isProjectile);
    setDisabled(linger, !isProjectile);
    setDisabled(fireAndForget, !isProjectile);
    setDisabled(stopOnImpact, !isProjectile);
  };

  mode.addEventListener("change", sync, { signal });
  sync();
}

function syncFlowControls(panel, signal) {
  const flow = panel.querySelector('input[name="tokenBeamFlow"]');
  const speed = panel.querySelector('input[name="tokenBeamFlowSpeed"]');
  const count = panel.querySelector('input[name="tokenBeamFlowCount"]');
  const size = panel.querySelector('input[name="tokenBeamFlowSize"]');
  const colourPicker = panel.querySelector('input[name="tokenBeamFlowColourPicker"]');
  const colourText = panel.querySelector('input[name="tokenBeamFlowColour"]');

  if (!flow) return;

  const sync = () => {
    const disabled = !flow.checked;

    setDisabled(speed, disabled);
    setDisabled(count, disabled);
    setDisabled(size, disabled);
    setDisabled(colourPicker, disabled);
    setDisabled(colourText, disabled);
  };

  flow.addEventListener("change", sync, { signal });
  sync();
}

function syncPulseControls(panel, signal) {
  const pulse = panel.querySelector('input[name="tokenBeamPulse"]');
  const speed = panel.querySelector('input[name="tokenBeamPulseSpeed"]');

  if (!pulse) return;

  const sync = () => setDisabled(speed, !pulse.checked);

  pulse.addEventListener("change", sync, { signal });
  sync();
}

function syncEdgeNoiseControls(panel, signal) {
  const edgeNoise = panel.querySelector('input[name="tokenBeamEdgeNoisePx"]');
  const edgeHz = panel.querySelector('input[name="tokenBeamEdgeNoiseHz"]');
  const edgeSegments = panel.querySelector('input[name="tokenBeamEdgeSegments"]');

  if (!edgeNoise) return;

  const sync = () => {
    const disabled = num(edgeNoise.value, 0) <= 0;

    setDisabled(edgeHz, disabled);
    setDisabled(edgeSegments, disabled);
  };

  edgeNoise.addEventListener("input", sync, { signal });
  sync();
}

export function tokenBeamTabDef() {
  return {
    id: TAB_ID,
    label: "Token Laser",
    selectionLayer: "tokens",

    buildApplyPayload(root, _runtime) {
      return buildApplyPayload(root, "fx.tokenBeam.start");
    },

    macroName(_root) {
      return "FX Bus - Token Laser";
    },

    wire(root, runtime, signal) {
      const panel = getOptionalPanel(root);
      if (!panel) return;

      syncColourPair(panel, "tokenBeamColourPicker", "tokenBeamColour", "#ff2222", signal);
      syncColourPair(panel, "tokenBeamCoreColourPicker", "tokenBeamCoreColour", "#ffffff", signal);
      syncColourPair(panel, "tokenBeamGlowColourPicker", "tokenBeamGlowColour", "#ff2222", signal);
      syncColourPair(panel, "tokenBeamFlowColourPicker", "tokenBeamFlowColour", "#ffffff", signal);

      syncDurationControls(panel, signal);
      syncSelectionModeControls(panel, signal);
      syncProjectileControls(panel, signal);
      syncFlowControls(panel, signal);
      syncPulseControls(panel, signal);
      syncEdgeNoiseControls(panel, signal);
      wireSelectionSummary(panel);

      const apply = () => {
        try {
          runtime.emit(buildApplyPayload(root, "fx.tokenBeam.update"));
        } catch (err) {
          ui.notifications.warn("Select the required tokens for Token Laser.");
          console.warn("[FX Bus] Token Beam apply failed", err);
        }
      };

      const stopSelected = () => {
        try {
          runtime.emit(buildStopSelectedPayload());
        } catch (err) {
          ui.notifications.warn("Select at least one token to stop Token Laser.");
          console.warn("[FX Bus] Token Beam stop selected failed", err);
        }
      };

      const stopAll = () => {
        runtime.emit({ action: "fx.tokenBeam.stopAll" });
      };

      for (const button of Array.from(panel.querySelectorAll(".fxbus-do[data-do]"))) {
        button.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            event.stopPropagation();

            const action = button.dataset.do;

            if (action === "tokenBeamApply") apply();
            if (action === "tokenBeamStopSelected") stopSelected();
            if (action === "tokenBeamStopAll") stopAll();
          },
          { signal }
        );
      }
    }
  };
}