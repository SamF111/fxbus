// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenDollyZoomFx.js

/**
 * FX Bus - Token Dolly Zoom
 *
 * Purpose:
 * - Apply a temporary visual-only camera transform centred on selected token(s).
 * - Counter-scale selected token visuals while the canvas transform runs.
 *
 * Behaviour:
 * - If one token is selected:
 *   - Zooms the visible canvas around that token.
 *   - Counter-scales the selected token so it visually separates from the scene.
 * - If multiple tokens are selected:
 *   - Uses the midpoint of all selected token centres as the dolly anchor.
 *   - Counter-scales all selected tokens.
 * - If no token is selected:
 *   - Falls back to screen-centre canvas zoom behaviour.
 *
 * Guarantees:
 * - Does not update TokenDocuments.
 * - Restores captured token visual scale when stopped.
 * - Restores the canvas stage transform when stopped normally.
 * - If cancelled by user canvas navigation, keeps the user's new canvas position
 *   but still restores token visuals.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";

const TOKEN_DOLLY_EFFECT_NAME = "tokenDollyZoom";

const ACTION_TOKEN_DOLLY_START = "fx.tokenDollyZoom.start";
const ACTION_TOKEN_DOLLY_STOP = "fx.tokenDollyZoom.stop";

const TOKEN_DOLLY_DEFAULTS = {
  mode: "punchIn",
  anchor: "selectedToken",

  zoom: 0.55,
  durationMs: 6500,
  holdMs: 80,
  settleMs: 180,

  rollDeg: 0,
  wobble: 0,
  driftPx: 0,

  counterScaleAmount: 1.25,
  snapPeakAt: 0.45,

  easing: "easeInOutCubic",
  restoreOnStop: true,
  cancelOnCanvasNavigation: true
};

const TRANSFORM_EPSILON = 0.0001;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nowMs() {
  return performance.now();
}

function getPixiPoint(x, y) {
  const PointCtor = globalThis.PIXI?.Point;
  return PointCtor ? new PointCtor(x, y) : { x, y };
}

function getCanvasStage() {
  return canvas?.app?.stage ?? null;
}

function getWorldStage() {
  return canvas?.stage ?? canvas?.app?.stage ?? null;
}

function getRenderer() {
  return canvas?.app?.renderer ?? null;
}

function getSelectedTokens() {
  return Array.isArray(canvas?.tokens?.controlled)
    ? canvas.tokens.controlled
    : [];
}

function normaliseMode(value) {
  const mode = String(value ?? TOKEN_DOLLY_DEFAULTS.mode).trim().toLowerCase();

  if (mode === "punchout" || mode === "punch-out" || mode === "out") return "punchOut";
  if (mode === "punchoutin" || mode === "punch-out-in" || mode === "out-in") return "punchOutIn";
  if (mode === "wobble" || mode === "wobblezoom" || mode === "wobble-zoom") return "wobble";
  if (mode === "snap" || mode === "snapfocus" || mode === "snap-focus") return "snapFocus";
  if (mode === "punchin" || mode === "punch-in" || mode === "in") return "punchIn";

  return "punchInOut";
}

function normaliseEasing(value) {
  const easing = String(value ?? TOKEN_DOLLY_DEFAULTS.easing).trim().toLowerCase();

  if (easing === "linear") return "linear";
  if (easing === "easeinquad" || easing === "ease-in-quad") return "easeInQuad";
  if (easing === "easeoutquad" || easing === "ease-out-quad") return "easeOutQuad";
  if (easing === "easeinoutquad" || easing === "ease-in-out-quad") return "easeInOutQuad";
  if (easing === "easeincubic" || easing === "ease-in-cubic") return "easeInCubic";
  if (easing === "easeoutcubic" || easing === "ease-out-cubic") return "easeOutCubic";
  if (easing === "easeinoutcubic" || easing === "ease-in-out-cubic") return "easeInOutCubic";

  return TOKEN_DOLLY_DEFAULTS.easing;
}

function ease(progress, easing) {
  const t = clamp(progress, 0, 1);

  if (easing === "linear") return t;
  if (easing === "easeInQuad") return t * t;
  if (easing === "easeOutQuad") return 1 - ((1 - t) * (1 - t));
  if (easing === "easeInOutQuad") return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  if (easing === "easeInCubic") return t * t * t;
  if (easing === "easeOutCubic") return 1 - Math.pow(1 - t, 3);
  if (easing === "easeInOutCubic") return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  return 1 - Math.pow(1 - t, 3);
}

function pingPong(progress) {
  const t = clamp(progress, 0, 1);
  return t < 0.5 ? t * 2 : 1 - ((t - 0.5) * 2);
}

function screenCentrePoint() {
  const renderer = getRenderer();

  return {
    x: (renderer?.screen?.width ?? window.innerWidth ?? 0) / 2,
    y: (renderer?.screen?.height ?? window.innerHeight ?? 0) / 2
  };
}

function tokenCentreWorld(token) {
  if (!token) return null;

  if (token.center && Number.isFinite(token.center.x) && Number.isFinite(token.center.y)) {
    return {
      x: token.center.x,
      y: token.center.y
    };
  }

  const documentWidth = num(token.document?.width, 1);
  const documentHeight = num(token.document?.height, 1);
  const gridSize = num(canvas?.grid?.size, 100);

  const x = num(token.document?.x, token.x) + (documentWidth * gridSize * 0.5);
  const y = num(token.document?.y, token.y) + (documentHeight * gridSize * 0.5);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

function tokenMidpointWorld(tokens) {
  /**
   * Large comment:
   * Resolve the world-space midpoint of all selected token centres.
   *
   * This gives a stable group anchor for multi-token Dolly Zoom effects. Tokens
   * without a valid centre are ignored. If no valid centres remain, the caller
   * falls back to screen-centre behaviour.
   */
  const points = (tokens ?? [])
    .map((token) => tokenCentreWorld(token))
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));

  if (!points.length) return null;

  const sum = points.reduce(
    (acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    },
    { x: 0, y: 0 }
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length
  };
}

function worldToScreen(point) {
  if (!point) return null;

  const worldStage = getWorldStage();

  if (!worldStage?.worldTransform?.apply) {
    return { x: point.x, y: point.y };
  }

  const result = worldStage.worldTransform.apply(getPixiPoint(point.x, point.y));

  return {
    x: result.x,
    y: result.y
  };
}

function resolveAnchorScreenPoint(payload = {}, tokens = []) {
  /**
   * Large comment:
   * Resolve the Token Dolly Zoom anchor into screen coordinates.
   *
   * If one or more tokens are selected and the anchor is token-based, use the
   * midpoint of all selected token centres. If no token is selected, fall back
   * to screen-centre canvas zoom behaviour.
   */
  const anchor = String(payload.anchor ?? payload.origin ?? TOKEN_DOLLY_DEFAULTS.anchor).trim().toLowerCase();

  if (
    tokens.length > 0 &&
    (
      anchor === "selectedtoken" ||
      anchor === "selected-token" ||
      anchor === "token"
    )
  ) {
    const world = tokenMidpointWorld(tokens);
    const screen = worldToScreen(world);

    return screen ?? screenCentrePoint();
  }

  if (anchor === "screen" || anchor === "screenxy" || anchor === "screen-xy") {
    const centre = screenCentrePoint();

    return {
      x: num(payload.x, centre.x),
      y: num(payload.y, centre.y)
    };
  }

  if (anchor === "world" || anchor === "scene" || anchor === "canvas") {
    const screen = worldToScreen({
      x: num(payload.x, 0),
      y: num(payload.y, 0)
    });

    return screen ?? screenCentrePoint();
  }

  return screenCentrePoint();
}

function snapshotStage(stage, anchorScreen) {
  /**
   * Large comment:
   * Capture the current stage transform and derive a local pivot for the chosen
   * screen-space anchor.
   *
   * By setting the pivot to the local point beneath the anchor and the position
   * to the anchor's current screen position, the transform is unchanged at zoom
   * factor 1. This lets us scale/roll around the anchor and later restore the
   * exact original stage transform.
   */
  const localAnchor = stage?.worldTransform?.applyInverse
    ? stage.worldTransform.applyInverse(getPixiPoint(anchorScreen.x, anchorScreen.y))
    : getPixiPoint(anchorScreen.x, anchorScreen.y);

  return {
    positionX: num(stage.position?.x, 0),
    positionY: num(stage.position?.y, 0),
    pivotX: num(stage.pivot?.x, 0),
    pivotY: num(stage.pivot?.y, 0),
    scaleX: num(stage.scale?.x, 1),
    scaleY: num(stage.scale?.y, 1),
    rotation: num(stage.rotation, 0),

    anchorScreenX: anchorScreen.x,
    anchorScreenY: anchorScreen.y,
    anchorLocalX: localAnchor.x,
    anchorLocalY: localAnchor.y
  };
}

function snapshotCurrentStageTransform(stage) {
  if (!stage) return null;

  return {
    positionX: num(stage.position?.x, 0),
    positionY: num(stage.position?.y, 0),
    pivotX: num(stage.pivot?.x, 0),
    pivotY: num(stage.pivot?.y, 0),
    scaleX: num(stage.scale?.x, 1),
    scaleY: num(stage.scale?.y, 1),
    rotation: num(stage.rotation, 0)
  };
}

function almostEqual(a, b, epsilon = TRANSFORM_EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

function stageTransformMatches(stage, snapshot) {
  /**
   * Large comment:
   * Check whether the canvas stage still matches the last transform applied by
   * this effect.
   *
   * If it does not match, something else changed the canvas transform. In normal
   * use that means the user panned or zoomed the canvas, so the effect cancels
   * rather than reasserting its own transform and fighting navigation.
   */
  if (!stage || !snapshot) return true;

  return (
    almostEqual(num(stage.position?.x, 0), snapshot.positionX) &&
    almostEqual(num(stage.position?.y, 0), snapshot.positionY) &&
    almostEqual(num(stage.pivot?.x, 0), snapshot.pivotX) &&
    almostEqual(num(stage.pivot?.y, 0), snapshot.pivotY) &&
    almostEqual(num(stage.scale?.x, 1), snapshot.scaleX) &&
    almostEqual(num(stage.scale?.y, 1), snapshot.scaleY) &&
    almostEqual(num(stage.rotation, 0), snapshot.rotation)
  );
}

function restoreStage(stage, snapshot) {
  if (!stage || !snapshot) return;

  stage.position.set(snapshot.positionX, snapshot.positionY);
  stage.pivot.set(snapshot.pivotX, snapshot.pivotY);
  stage.scale.set(snapshot.scaleX, snapshot.scaleY);
  stage.rotation = snapshot.rotation;
}

function snapshotTokenVisual(token) {
  const mesh = token?.mesh ?? null;

  if (!mesh?.scale) return null;

  return {
    token,
    mesh,
    scaleX: num(mesh.scale.x, 1),
    scaleY: num(mesh.scale.y, 1)
  };
}

function snapshotTokenVisuals(tokens) {
  /**
   * Large comment:
   * Capture visual scale for all selected tokens.
   *
   * This is visual-only and intentionally avoids updating any TokenDocument.
   * Every captured token is restored exactly when the effect ends or is stopped.
   */
  return (tokens ?? [])
    .map((token) => snapshotTokenVisual(token))
    .filter((snapshot) => snapshot?.mesh?.scale);
}

function restoreTokenVisual(snapshot) {
  if (!snapshot?.mesh?.scale) return;

  snapshot.mesh.scale.set(
    snapshot.scaleX,
    snapshot.scaleY
  );
}

function restoreTokenVisuals(snapshots) {
  for (const snapshot of snapshots ?? []) {
    restoreTokenVisual(snapshot);
  }
}

function getRuntimeState(runtime) {
  if (!runtime.screenFx.has(TOKEN_DOLLY_EFFECT_NAME)) {
    runtime.screenFx.set(TOKEN_DOLLY_EFFECT_NAME, {});
  }

  return runtime.screenFx.get(TOKEN_DOLLY_EFFECT_NAME);
}

function clearRuntimeState(runtime) {
  runtime.screenFx.delete(TOKEN_DOLLY_EFFECT_NAME);
}

function computeInfiniteZoomFactor(state) {
  const zoomIn = state.zoom;
  const zoomOut = 1 / Math.max(0.01, state.zoom);

  if (state.mode === "punchOut" || state.mode === "punchOutIn") {
    return zoomOut;
  }

  if (state.mode === "wobble") {
    return 1 + ((zoomIn - 1) * 0.55);
  }

  return zoomIn;
}

function computeZoomFactor(state, progress) {
  if (state.infinite) {
    return computeInfiniteZoomFactor(state);
  }

  const mode = state.mode;
  const eased = ease(progress, state.easing);
  const pulse = ease(pingPong(progress), state.easing);
  const zoomIn = state.zoom;
  const zoomOut = 1 / Math.max(0.01, state.zoom);

  if (mode === "punchIn") {
    return 1 + ((zoomIn - 1) * pulse);
  }

  if (mode === "punchOut") {
    return 1 + ((zoomOut - 1) * pulse);
  }

  if (mode === "punchOutIn") {
    return progress < 0.5
      ? 1 + ((zoomOut - 1) * ease(progress * 2, state.easing))
      : zoomOut + ((1 - zoomOut) * ease((progress - 0.5) * 2, state.easing));
  }

  if (mode === "wobble") {
    const decay = 1 - eased;
    const oscillation = Math.sin(progress * Math.PI * 6) * decay;
    return 1 + ((zoomIn - 1) * 0.55 * oscillation);
  }

  if (mode === "snapFocus") {
    const peakAt = clamp(num(state.snapPeakAt, TOKEN_DOLLY_DEFAULTS.snapPeakAt), 0.15, 0.85);

    const snap = progress < peakAt
      ? ease(progress / peakAt, state.easing)
      : 1 - ease((progress - peakAt) / (1 - peakAt), "easeInOutCubic");

    return 1 + ((zoomIn - 1) * snap);
  }

  return 1 + ((zoomIn - 1) * pulse);
}

function computeRollRadians(state, progress) {
  const rollRad = (state.rollDeg * Math.PI) / 180;

  if (state.infinite) {
    return rollRad;
  }

  const pulse = pingPong(progress);

  if (state.mode === "wobble") {
    const decay = 1 - progress;
    return rollRad * Math.sin(progress * Math.PI * 8) * decay;
  }

  return rollRad * pulse;
}

function computeDrift(state, progress) {
  if (state.infinite) {
    return {
      x: 0,
      y: 0,
      wobbleScale: 1
    };
  }

  const drift = state.driftPx;
  const wobble = state.wobble;
  const decay = 1 - progress;

  return {
    x: Math.sin(progress * Math.PI * 4) * drift * decay,
    y: Math.cos(progress * Math.PI * 5) * drift * decay,
    wobbleScale: 1 + (Math.sin(progress * Math.PI * 10) * wobble * decay)
  };
}

function applyTokenCounterScale(state, finalZoom) {
  /**
   * Large comment:
   * Apply the token counter-scale without clamping the requested counter-scale
   * amount.
   *
   * This deliberately permits strong values such as counterScaleAmount: 2.0.
   * The final token scale is still restored from the captured snapshot when the
   * effect ends.
   */
  const snapshots = state?.tokenSnapshots ?? [];
  if (!snapshots.length) return;

  const amount = num(state.counterScaleAmount, TOKEN_DOLLY_DEFAULTS.counterScaleAmount);
  const inverse = 1 / Math.max(0.01, finalZoom);
  const counterScale = 1 + ((inverse - 1) * amount);

  for (const snapshot of snapshots) {
    if (!snapshot?.mesh?.scale) continue;

    snapshot.mesh.scale.set(
      snapshot.scaleX * counterScale,
      snapshot.scaleY * counterScale
    );
  }
}

function applyTokenDollyTransform(stage, state, progress) {
  const snapshot = state.snapshot;
  if (!stage || !snapshot) return;

  const zoomFactor = computeZoomFactor(state, progress);
  const rollRadians = computeRollRadians(state, progress);
  const drift = computeDrift(state, progress);
  const finalZoom = zoomFactor * drift.wobbleScale;

  stage.pivot.set(snapshot.anchorLocalX, snapshot.anchorLocalY);
  stage.position.set(
    snapshot.anchorScreenX + drift.x,
    snapshot.anchorScreenY + drift.y
  );
  stage.scale.set(
    snapshot.scaleX * finalZoom,
    snapshot.scaleY * finalZoom
  );
  stage.rotation = snapshot.rotation + rollRadians;

  applyTokenCounterScale(state, finalZoom);

  state.lastAppliedTransform = snapshotCurrentStageTransform(stage);
}

function stopTokenDollyZoom(runtime, payload = {}) {
  const state = runtime.screenFx.get(TOKEN_DOLLY_EFFECT_NAME);

  cleanupTicker(runtime, TOKEN_DOLLY_EFFECT_NAME);

  const stage = getCanvasStage();
  const restoreStageTransform = payload.restore !== false && state?.restoreOnStop !== false;

  if (stage && state?.snapshot && restoreStageTransform) {
    restoreStage(stage, state.snapshot);
  }

  restoreTokenVisuals(state?.tokenSnapshots);

  clearRuntimeState(runtime);
}

function cancelTokenDollyZoomAfterNavigation(runtime) {
  /**
   * Large comment:
   * Cancel because Foundry/user navigation changed the canvas transform while
   * the effect was active.
   *
   * Do not restore the stage snapshot here. Restoring would undo the user's pan
   * or zoom. The token visual counter-scale is still restored because it is owned
   * only by this effect.
   */
  stopTokenDollyZoom(runtime, { restore: false });
}

function startTokenDollyZoom(runtime, payload = {}) {
  /**
   * Large comment:
   * Start a temporary cinematic Token Dolly Zoom.
   *
   * If one token is selected, it is used as the visual subject and anchor. If
   * multiple tokens are selected, their midpoint becomes the anchor and all
   * selected tokens are counter-scaled. If no token is selected, the effect falls
   * back to screen-centre canvas zoom behaviour.
   *
   * If durationMs is 0, the transform is held until fx.tokenDollyZoom.stop is
   * emitted or until the user manually pans/zooms the canvas.
   */
  const stage = getCanvasStage();

  if (!stage) {
    console.warn("[FX Bus] Token Dolly Zoom unavailable: canvas stage missing.");
    return;
  }

  stopTokenDollyZoom(runtime, { restore: true });

  const tokens = getSelectedTokens();
  const anchorScreen = resolveAnchorScreenPoint(payload, tokens);
  const state = getRuntimeState(runtime);
  const durationMs = clamp(num(payload.durationMs, TOKEN_DOLLY_DEFAULTS.durationMs), 0, 10000);

  state.startedAtMs = nowMs();
  state.mode = normaliseMode(payload.mode);
  state.zoom = clamp(num(payload.zoom, TOKEN_DOLLY_DEFAULTS.zoom), 0.2, 3);
  state.durationMs = durationMs;
  state.infinite = durationMs === 0;
  state.holdMs = clamp(num(payload.holdMs, TOKEN_DOLLY_DEFAULTS.holdMs), 0, 5000);
  state.settleMs = clamp(num(payload.settleMs, TOKEN_DOLLY_DEFAULTS.settleMs), 0, 5000);
  state.rollDeg = clamp(num(payload.rollDeg, TOKEN_DOLLY_DEFAULTS.rollDeg), -30, 30);
  state.wobble = clamp(num(payload.wobble, TOKEN_DOLLY_DEFAULTS.wobble), 0, 0.25);
  state.driftPx = clamp(num(payload.driftPx, TOKEN_DOLLY_DEFAULTS.driftPx), 0, 300);
  state.counterScaleAmount = num(payload.counterScaleAmount, TOKEN_DOLLY_DEFAULTS.counterScaleAmount);
  state.snapPeakAt = clamp(num(payload.snapPeakAt, TOKEN_DOLLY_DEFAULTS.snapPeakAt), 0.15, 0.85);
  state.easing = normaliseEasing(payload.easing);
  state.restoreOnStop = payload.restoreOnStop !== false;
  state.cancelOnCanvasNavigation = payload.cancelOnCanvasNavigation !== false;
  state.snapshot = snapshotStage(stage, anchorScreen);
  state.tokenSnapshots = snapshotTokenVisuals(tokens);
  state.lastAppliedTransform = null;

  ensureTicker(runtime, TOKEN_DOLLY_EFFECT_NAME, () => {
    const liveState = runtime.screenFx.get(TOKEN_DOLLY_EFFECT_NAME);
    const liveStage = getCanvasStage();

    if (!liveState || !liveStage) {
      cleanupTicker(runtime, TOKEN_DOLLY_EFFECT_NAME);
      return;
    }

    if (
      liveState.cancelOnCanvasNavigation &&
      liveState.lastAppliedTransform &&
      !stageTransformMatches(liveStage, liveState.lastAppliedTransform)
    ) {
      cancelTokenDollyZoomAfterNavigation(runtime);
      return;
    }

    if (liveState.infinite) {
      applyTokenDollyTransform(liveStage, liveState, 1);
      return;
    }

    const elapsedMs = nowMs() - liveState.startedAtMs;
    const activeDurationMs = Math.max(1, liveState.durationMs);
    const progress = clamp(elapsedMs / activeDurationMs, 0, 1);

    applyTokenDollyTransform(liveStage, liveState, progress);

    if (progress < 1) return;

    stopTokenDollyZoom(runtime, { restore: true });
  });
}

export function registerTokenDollyZoomFx(runtime) {
  /**
   * Large comment:
   * Register Token Dolly Zoom runtime handlers.
   */
  runtime.handlers.set(ACTION_TOKEN_DOLLY_START, (payload = {}) => {
    startTokenDollyZoom(runtime, payload);
  });

  runtime.handlers.set(ACTION_TOKEN_DOLLY_STOP, (payload = {}) => {
    stopTokenDollyZoom(runtime, payload);
  });
}