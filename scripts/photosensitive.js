// D:\FoundryVTT\Data\modules\fxbus\scripts\photosensitive.js

/**
 * FX Bus client effect-safety policy.
 *
 * Foundry Photosensitive Mode, the FX Bus local opt-out, and the device's
 * reduced-motion request are all treated as all-or-nothing safety boundaries:
 * actions which can start, change, or toggle an effect are suppressed
 * completely. Cleanup actions always remain available so Stop and Reset can
 * restore a client which already has active effects.
 */

const ACTION_GLOBAL_RESET = "fx.bus.reset";
export const LOCAL_FX_DISABLED_SETTING = "disableLocalFx";
export const RESPECT_REDUCED_MOTION_SETTING = "respectReducedMotion";
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export const FX_SUPPRESSION_REASONS = Object.freeze({
  LOCAL_DISABLED: "local-disabled",
  PHOTOSENSITIVE: "photosensitive",
  REDUCED_MOTION: "reduced-motion"
});

const EFFECT_LABELS = new Map([
  ["screenShake", "Screen Shake"],
  ["screenRotate", "Screen Roll"],
  ["screenPulse", "Screen Pulse"],
  ["screenVignette", "Screen Vignette"],
  ["chromAb", "Chromatic Aberration"],
  ["noise", "Screen Noise"],
  ["screenBlur", "Screen Blur"],
  ["screenSmear", "Screen Smear"],
  ["screenStreak", "Screen Streak"],
  ["screenMonochrome", "Monochrome Filter"],
  ["canvasMirror", "Canvas Mirror"],
  ["tokenOsc", "Token Oscillation"],
  ["tokenRecoil", "Token Recoil"],
  ["tokenDollyZoom", "Token Dolly Zoom"],
  ["tokenLaser", "Token Tether"],
  ["tokenBeam", "Token Laser"],
  ["tileOscillation", "Tile Oscillation"],
  ["tileRotation", "Tile Rotation"],
  ["tileFlicker", "Tile Flicker"],
  ["tileFlow", "Tile Flow"]
]);

function actionName(message) {
  return typeof message?.action === "string" ? message.action.trim() : "";
}

function isCleanupAction(action) {
  if (action === ACTION_GLOBAL_RESET) return true;

  return action.endsWith(".stop") ||
    action.endsWith(".stopAll") ||
    action.endsWith(".hardReset");
}

function effectLabel(action) {
  const effectKey = action.split(".")[1];
  return EFFECT_LABELS.get(effectKey) ?? action;
}

export function isPhotosensitiveModeEnabled() {
  if (globalThis.canvas?.photosensitiveMode === true) return true;

  try {
    return globalThis.game?.settings?.get?.("core", "photosensitiveMode") === true;
  } catch {
    return false;
  }
}

export function isLocalFxDisabled() {
  try {
    return globalThis.game?.settings?.get?.(
      "fxbus",
      LOCAL_FX_DISABLED_SETTING
    ) === true;
  } catch {
    return false;
  }
}

export function isReducedMotionRequested() {
  try {
    return globalThis.window?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    return false;
  }
}

export function shouldRespectReducedMotion() {
  try {
    return globalThis.game?.settings?.get?.(
      "fxbus",
      RESPECT_REDUCED_MOTION_SETTING
    ) === true;
  } catch {
    return false;
  }
}

export function getFxSuppressionReason(message) {
  const action = actionName(message);

  if (!action.startsWith("fx.")) return null;
  if (isCleanupAction(action)) return null;

  if (isLocalFxDisabled()) return FX_SUPPRESSION_REASONS.LOCAL_DISABLED;
  if (isPhotosensitiveModeEnabled()) return FX_SUPPRESSION_REASONS.PHOTOSENSITIVE;
  if (shouldRespectReducedMotion() && isReducedMotionRequested()) {
    return FX_SUPPRESSION_REASONS.REDUCED_MOTION;
  }
  return null;
}

export function shouldSuppressFxForPhotosensitiveMode(message) {
  return getFxSuppressionReason(message) !== null;
}

export function warnFxSuppressed(message, reason = getFxSuppressionReason(message)) {
  const action = actionName(message);
  const label = effectLabel(action || "FX Bus effect");
  const localDisabled = reason === FX_SUPPRESSION_REASONS.LOCAL_DISABLED;
  const reducedMotion = reason === FX_SUPPRESSION_REASONS.REDUCED_MOTION;
  const text = localDisabled
    ? `FX Bus suppressed ${label} because effects are disabled on this client.`
    : reducedMotion
      ? `FX Bus suppressed ${label} because your system requests reduced motion.`
      : `FX Bus suppressed ${label} because Photosensitive Mode is enabled.`;

  console.warn("[FX Bus] suppressed effect", { action, reason });
  globalThis.ui?.notifications?.warn?.(text);
}

export function warnPhotosensitiveFxSuppressed(message) {
  warnFxSuppressed(message, FX_SUPPRESSION_REASONS.PHOTOSENSITIVE);
}
