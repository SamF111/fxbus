// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\screenRotateFx.js

/**
 * FX Bus - Screen Rotate Effect
 *
 * Purpose:
 * - Rotate the visible Foundry canvas render stage to create a disorientating screen effect.
 * - Designed for rupture moments, teleportation, psychic attacks, black holes, reality shear,
 *   vehicle crashes, boss phase changes, or "the room is wrong" transitions.
 *
 * Behaviour:
 * - Client-side only.
 * - Visual-only.
 * - No Scene, Token, Tile, Wall, Light, or Document updates.
 * - Uses canvas.app.stage render transforms only.
 * - Broadcast-safe through FX Bus socket actions.
 * - Restores the original stage transform exactly on stop/reset where possible.
 *
 * Additive behaviour:
 * - spin, ease, snap, and wobbleHold add to the current target angle when already active/held.
 * - Example: 45 degrees + 45 degrees becomes 90 degrees.
 * - wobble is intentionally not additive; it restarts as a temporary impulse.
 *
 * Actions:
 * - fx.screenRotate.start
 * - fx.screenRotate.stop
 *
 * Modes:
 * - ease: rotate towards angle; optionally return during the same duration.
 * - wobble: oscillate around the screen centre with an envelope, then return.
 * - wobbleHold: driven damped angular oscillator that builds momentum, overshoots, and settles by the shortest route.
 * - snap: immediately rotate to angle and hold until stopped or duration ends.
 * - spin: ease towards angle; useful for inversions.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";

const EFFECT_NAME = "screenRotate";
const ACTION_START = "fx.screenRotate.start";
const ACTION_STOP = "fx.screenRotate.stop";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value, fallback) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function normaliseAngleDeg(angleDeg) {
  let a = Number(angleDeg);

  if (!Number.isFinite(a)) return 0;

  a = ((a + 180) % 360 + 360) % 360 - 180;

  return a;
}

function shortestDeltaDeg(fromDeg, toDeg) {
  return normaliseAngleDeg(toDeg - fromDeg);
}

function easeInOutQuad(t) {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

function lerp(a, b, t) {
  return a + ((b - a) * t);
}

function isAdditiveMode(mode) {
  return (
    mode === "spin" ||
    mode === "ease" ||
    mode === "snap" ||
    mode === "wobblehold"
  );
}

function normaliseMode(value) {
  const mode = String(value ?? "ease").trim().toLowerCase();

  if (mode === "wobblehold" || mode === "wobble-hold" || mode === "wobble_hold") {
    return "wobblehold";
  }

  if (mode === "wobble") return "wobble";
  if (mode === "snap") return "snap";
  if (mode === "spin") return "spin";
  if (mode === "ease") return "ease";

  return "ease";
}

function getStage() {
  return canvas?.app?.stage ?? null;
}

function getRenderer() {
  return canvas?.app?.renderer ?? null;
}

function snapshotStage(stage) {
  if (!stage) return null;

  return {
    x: stage.x,
    y: stage.y,
    rotation: stage.rotation,
    pivotX: stage.pivot?.x ?? 0,
    pivotY: stage.pivot?.y ?? 0,
    scaleX: stage.scale?.x ?? 1,
    scaleY: stage.scale?.y ?? 1
  };
}

function restoreStage(stage, snapshot) {
  if (!stage || !snapshot) return;

  stage.x = snapshot.x;
  stage.y = snapshot.y;
  stage.rotation = snapshot.rotation;

  if (stage.pivot?.set) {
    stage.pivot.set(snapshot.pivotX, snapshot.pivotY);
  } else if (stage.pivot) {
    stage.pivot.x = snapshot.pivotX;
    stage.pivot.y = snapshot.pivotY;
  }

  if (stage.scale?.set) {
    stage.scale.set(snapshot.scaleX, snapshot.scaleY);
  } else if (stage.scale) {
    stage.scale.x = snapshot.scaleX;
    stage.scale.y = snapshot.scaleY;
  }
}

function getScreenCentreLocalPoint(stage, renderer) {
  /**
   * Large comment:
   * Convert the visible renderer centre into the stage's local coordinate space.
   *
   * This makes rotation happen around the middle of the player view rather than
   * around the world origin. This is deliberately recalculated during the effect
   * because Foundry may alter transforms between frames.
   */
  const screenX = renderer.screen.width / 2;
  const screenY = renderer.screen.height / 2;

  const PointCtor = globalThis.PIXI?.Point;
  if (!PointCtor || typeof stage.toLocal !== "function") {
    return { x: screenX, y: screenY };
  }

  const globalPoint = new PointCtor(screenX, screenY);
  const localPoint = stage.toLocal(globalPoint, undefined, undefined, true);

  return {
    x: localPoint.x,
    y: localPoint.y
  };
}

function setRotationAroundScreenCentre(stage, renderer, rootBase, angleRad) {
  /**
   * Large comment:
   * Rotate the stage around the visible screen centre.
   *
   * The rootBase is the true clean baseline captured before the first additive
   * rotation. All additive rotations are applied relative to that root baseline,
   * so Stop can always restore the canvas exactly back to the original state.
   */
  if (!stage || !renderer || !rootBase) return;

  const centre = getScreenCentreLocalPoint(stage, renderer);

  if (stage.pivot?.set) {
    stage.pivot.set(centre.x, centre.y);
  } else if (stage.pivot) {
    stage.pivot.x = centre.x;
    stage.pivot.y = centre.y;
  }

  if (stage.position?.set) {
    stage.position.set(renderer.screen.width / 2, renderer.screen.height / 2);
  } else {
    stage.x = renderer.screen.width / 2;
    stage.y = renderer.screen.height / 2;
  }

  stage.rotation = rootBase.rotation + angleRad;
}

function getRuntimeState(runtime) {
  if (!runtime.screenFx.has(EFFECT_NAME)) {
    runtime.screenFx.set(EFFECT_NAME, {});
  }

  return runtime.screenFx.get(EFFECT_NAME);
}

function clearRuntimeState(runtime) {
  runtime.screenFx.delete(EFFECT_NAME);
}

function stopScreenRotate(runtime, { restore = true } = {}) {
  const stage = getStage();
  const state = runtime.screenFx.get(EFFECT_NAME);

  cleanupTicker(runtime, EFFECT_NAME);

  if (restore && stage && state?.rootBase) {
    restoreStage(stage, state.rootBase);
  } else if (restore && stage && state?.base) {
    restoreStage(stage, state.base);
  }

  clearRuntimeState(runtime);
}

function prepareStateForStart(runtime, stage, mode, requestedAngleDeg) {
  /**
   * Large comment:
   * Prepare the new state for either additive or non-additive behaviour.
   *
   * Additive modes:
   * - preserve the original rootBase
   * - preserve current visual rotation
   * - add the requested angle to the previous target angle
   *
   * Wobble:
   * - restore any existing rotate effect first
   * - restart as a clean temporary impulse
   */
  const previousState = runtime.screenFx.get(EFFECT_NAME);
  const additive = isAdditiveMode(mode) && previousState?.rootBase;

  if (!additive) {
    stopScreenRotate(runtime, { restore: true });

    return {
      rootBase: snapshotStage(stage),
      startAngleDeg: 0,
      targetAngleDeg: normaliseAngleDeg(requestedAngleDeg),
      currentAngleDeg: 0,
      currentVelocityDeg: 0
    };
  }

  cleanupTicker(runtime, EFFECT_NAME);

  const previousTargetAngleDeg = normaliseAngleDeg(
    num(previousState.targetAngleDeg, 0)
  );

  const previousCurrentAngleDeg = normaliseAngleDeg(
    num(previousState.currentAngleDeg, previousTargetAngleDeg)
  );

  const previousVelocityDeg = num(previousState.oscVelocityDeg, 0);
  const nextTargetAngleDeg = normaliseAngleDeg(
    previousTargetAngleDeg + requestedAngleDeg
  );

  return {
    rootBase: previousState.rootBase,
    startAngleDeg: previousCurrentAngleDeg,
    targetAngleDeg: nextTargetAngleDeg,
    currentAngleDeg: previousCurrentAngleDeg,
    currentVelocityDeg: previousVelocityDeg
  };
}

function initialiseOscillatorState(state) {
  /**
   * Large comment:
   * Initialise the angular oscillator lazily.
   *
   * This keeps additive re-presses smooth because they can inherit the current
   * angle and velocity from the previous Wobble Hold run.
   */
  if (!Number.isFinite(state.oscAngleDeg)) {
    state.oscAngleDeg = normaliseAngleDeg(
      num(state.currentAngleDeg, state.startAngleDeg)
    );
  }

  if (!Number.isFinite(state.oscVelocityDeg)) {
    state.oscVelocityDeg = num(state.currentVelocityDeg, 0);
  }

  if (!Number.isFinite(state.oscElapsedSeconds)) {
    state.oscElapsedSeconds = 0;
  }
}

function computeWobbleHoldAngleDeg(state, _eased, _t, deltaMS = 1000 / 60) {
  /**
   * Large comment:
   * Wobble Hold uses a driven damped angular oscillator with staged spring capture.
   *
   * The early motion is drive-led, so the canvas swings and builds momentum
   * instead of immediately racing towards the final target. The spring authority
   * ramps in later, allowing the target to capture the motion near the end.
   */
  const dt = clamp(deltaMS / 1000, 0.001, 0.05);

  initialiseOscillatorState(state);

  state.oscElapsedSeconds += dt;

  const t = clamp(state.elapsedMs / state.durationMs, 0, 1);

  const currentDeg = normaliseAngleDeg(state.oscAngleDeg);
  const targetDeg = normaliseAngleDeg(state.targetAngleDeg);
  const startDeg = normaliseAngleDeg(state.startAngleDeg);

  const remainingDeg = shortestDeltaDeg(currentDeg, targetDeg);
  const totalDeltaDeg = shortestDeltaDeg(startDeg, targetDeg);

  const direction = totalDeltaDeg >= 0 ? 1 : -1;
  const magnitude = Math.max(1, Math.abs(totalDeltaDeg));

  /*
   * Spring ramp.
   *
   * Do not let the spring dominate at the start. Early motion should be wobble
   * and angular momentum. Target capture should become stronger later.
   */
  const springRamp = easeInOutQuad(clamp((t - 0.35) / 0.45, 0, 1));
  const spring = lerp(1.8, 14.0, springRamp);
  const damping = lerp(3.2, 7.0, springRamp);

  /*
   * Drive envelope.
   *
   * The drive builds early, remains active through the middle, then fades so the
   * spring can capture the final target cleanly.
   */
  const attack = Math.sin(Math.min(1, t * 2.5) * (Math.PI / 2));
  const fade = 1 - easeInOutQuad(clamp((t - 0.62) / 0.28, 0, 1));
  const envelope = attack * fade;

  const phase = state.oscElapsedSeconds * state.freqHz * Math.PI * 2;

  /*
   * Drive is intentionally modest. It should swing the view, not launch it to
   * the target in the first half-cycle.
   */
  const driveStrength = magnitude * 10;
  const driveAccel = Math.sin(phase) * driveStrength * envelope * direction;

  const springAccel = remainingDeg * spring;
  const dampingAccel = -state.oscVelocityDeg * damping;
  const accelerationDeg = springAccel + dampingAccel + driveAccel;

  state.oscVelocityDeg += accelerationDeg * dt;

  /*
   * Velocity cap also ramps. This prevents the first swing from reaching the
   * full target too early, especially for 180 degree rotations.
   */
  const earlyVelocityCap = Math.max(45, magnitude * 0.55);
  const lateVelocityCap = Math.max(120, magnitude * 1.6);
  const maxVelocityDegPerSecond = lerp(earlyVelocityCap, lateVelocityCap, springRamp);

  state.oscVelocityDeg = clamp(
    state.oscVelocityDeg,
    -maxVelocityDegPerSecond,
    maxVelocityDegPerSecond
  );

  state.oscAngleDeg = normaliseAngleDeg(
    state.oscAngleDeg + (state.oscVelocityDeg * dt)
  );

  /*
   * Final capture.
   */
  if (t > 0.82) {
    const captureT = clamp((t - 0.82) / 0.18, 0, 1);
    const captureEase = easeInOutQuad(captureT);
    const captureDelta = shortestDeltaDeg(state.oscAngleDeg, targetDeg);

    state.oscVelocityDeg *= 1 - (0.28 * captureEase);
    state.oscAngleDeg = normaliseAngleDeg(
      state.oscAngleDeg + (captureDelta * captureEase * 0.16)
    );
  }

  if (t >= 1) {
    state.oscAngleDeg = targetDeg;
    state.oscVelocityDeg = 0;
  }

  return state.oscAngleDeg;
}

function computeAngleDegForFrame(state, mode, t, eased, deltaMS) {
  if (mode === "wobble") {
    const envelope = state.returnWhenFinished ? Math.sin(Math.PI * t) : eased;
    const phase = state.elapsedMs * 0.001 * state.freqHz * Math.PI * 2;
    return state.targetAngleDeg * Math.sin(phase) * envelope;
  }

  if (mode === "wobblehold") {
    return computeWobbleHoldAngleDeg(state, eased, t, deltaMS);
  }

  if (mode === "snap") {
    return state.targetAngleDeg;
  }

  if (state.returnWhenFinished) {
    if (mode === "spin") {
      /**
       * Large comment:
       * Spin with return enabled is treated as a full cinematic spin then clean
       * restoration at the end. This preserves the inversion feel.
       */
      return lerp(state.startAngleDeg, state.targetAngleDeg, eased);
    }

    /**
     * Large comment:
     * Ease with return enabled is a temporary disorientation pulse.
     */
    return lerp(
      state.startAngleDeg,
      state.targetAngleDeg,
      Math.sin(Math.PI * t)
    );
  }

  return lerp(state.startAngleDeg, state.targetAngleDeg, eased);
}

function startScreenRotate(runtime, payload = {}) {
  const stage = getStage();
  const renderer = getRenderer();

  if (!stage || !renderer) {
    console.warn("[FX Bus] Screen Rotate unavailable: canvas.app.stage or renderer missing.");
    return;
  }

  const requestedAngleDeg = clamp(num(payload.angleDeg, 25), -720, 720);
  const durationMs = Math.max(1, num(payload.durationMs, 1500));
  const mode = normaliseMode(payload.mode);
  const freqHz = Math.max(0.01, num(payload.freqHz, 0.7));
  const returnWhenFinished = mode === "wobblehold"
    ? false
    : bool(payload.returnWhenFinished, true);
  const holdWhenFinished = mode === "wobblehold"
    ? true
    : bool(payload.holdWhenFinished, !returnWhenFinished);

  const prepared = prepareStateForStart(runtime, stage, mode, requestedAngleDeg);

  const state = getRuntimeState(runtime);
  state.rootBase = prepared.rootBase;
  state.base = prepared.rootBase;
  state.elapsedMs = 0;
  state.requestedAngleDeg = requestedAngleDeg;
  state.startAngleDeg = prepared.startAngleDeg;
  state.targetAngleDeg = prepared.targetAngleDeg;
  state.currentAngleDeg = prepared.currentAngleDeg;
  state.currentVelocityDeg = prepared.currentVelocityDeg;
  state.oscAngleDeg = prepared.currentAngleDeg;
  state.oscVelocityDeg = prepared.currentVelocityDeg;
  state.oscElapsedSeconds = 0;
  state.durationMs = durationMs;
  state.mode = mode;
  state.freqHz = freqHz;
  state.returnWhenFinished = returnWhenFinished;
  state.holdWhenFinished = holdWhenFinished;

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => {
    const liveState = runtime.screenFx.get(EFFECT_NAME);
    if (!liveState?.rootBase) {
      cleanupTicker(runtime, EFFECT_NAME);
      return;
    }

    const liveStage = getStage();
    const liveRenderer = getRenderer();

    if (!liveStage || !liveRenderer) {
      stopScreenRotate(runtime, { restore: false });
      return;
    }

    const safeDeltaMS = Number.isFinite(deltaMS) ? deltaMS : 1000 / 60;

    liveState.elapsedMs += safeDeltaMS;
    liveState.lastDeltaMS = safeDeltaMS;

    const t = clamp(liveState.elapsedMs / liveState.durationMs, 0, 1);
    const eased = easeInOutQuad(t);
    const angleDeg = computeAngleDegForFrame(
      liveState,
      liveState.mode,
      t,
      eased,
      safeDeltaMS
    );

    liveState.currentAngleDeg = normaliseAngleDeg(angleDeg);

    setRotationAroundScreenCentre(
      liveStage,
      liveRenderer,
      liveState.rootBase,
      degToRad(liveState.currentAngleDeg)
    );

    if (t < 1) return;

    cleanupTicker(runtime, EFFECT_NAME);

    if (liveState.returnWhenFinished) {
      restoreStage(liveStage, liveState.rootBase);
      clearRuntimeState(runtime);
      return;
    }

    liveState.currentAngleDeg = normaliseAngleDeg(liveState.targetAngleDeg);
    liveState.oscAngleDeg = liveState.currentAngleDeg;
    liveState.oscVelocityDeg = 0;

    setRotationAroundScreenCentre(
      liveStage,
      liveRenderer,
      liveState.rootBase,
      degToRad(liveState.currentAngleDeg)
    );

    if (!liveState.holdWhenFinished) {
      clearRuntimeState(runtime);
    }
  });
}

export function registerScreenRotateFx(runtime) {
  runtime.handlers.set(ACTION_START, (payload) => {
    startScreenRotate(runtime, payload);
  });

  runtime.handlers.set(ACTION_STOP, (payload = {}) => {
    stopScreenRotate(runtime, {
      restore: payload.restore !== false
    });
  });
}