// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\screenSmearFx.js

/**
 * FX Bus - Screen Smear FX (Foundry v13+)
 *
 * Rendering model (matches working streak):
 * - Capture: canvas.stage (camera-transformed world) -> RenderTexture sized to renderer.screen and renderer.resolution.
 * - Display: overlay container is a CHILD of canvas.stage (same pipeline as capture),
 *   but is locked to screen space each tick by cancelling canvas.stage.worldTransform.
 * - Avoid feedback: hide overlay during capture using shared capture helpers.
 *
 * Actions:
 * - fx.screenSmear.start (start/update)
 * - fx.screenSmear.stop
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { renderStageAsSeen, lockContainerToScreenSpace } from "./shared/capture.js";

const EFFECT_NAME = "screenSmear";
const ACTION_START = "fx.screenSmear.start";
const ACTION_STOP = "fx.screenSmear.stop";

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function getPixi() {
  return globalThis.PIXI ?? foundry?.canvas?.PIXI ?? null;
}

function getRenderer() {
  const r = globalThis.canvas?.app?.renderer;
  if (!r) throw new Error("[FX Bus] canvas.app.renderer unavailable");
  return r;
}

// Capture target: camera-transformed world stage.
function getCaptureStage() {
  const s = globalThis.canvas?.stage;
  if (!s) throw new Error("[FX Bus] canvas.stage unavailable");
  return s;
}

function getCameraXY() {
  const stage = globalThis.canvas?.stage;
  return { x: Number(stage?.x ?? 0), y: Number(stage?.y ?? 0) };
}

function easeValue(kind, t01) {
  const t = clamp(t01, 0, 1);
  switch (String(kind)) {
    case "in":
      return t * t;
    case "out":
      return 1 - (1 - t) * (1 - t);
    case "linear":
      return t;
    case "inOut":
    default:
      return t * t * (3 - 2 * t); // smoothstep
  }
}

function destroyRT(rt) {
  try {
    rt?.destroy?.(true);
  } catch {
    // ignore
  }
}

function createRT(renderer, PIXI) {
  const w = Math.max(1, Math.floor(renderer.screen.width));
  const h = Math.max(1, Math.floor(renderer.screen.height));
  const res = Number(renderer.resolution ?? 1) || 1;

  return PIXI.RenderTexture.create({
    width: w,
    height: h,
    resolution: res,
    scaleMode: PIXI.SCALE_MODES.LINEAR
  });
}

function clearRT(renderer, PIXI, rt) {
  renderer.render(new PIXI.Container(), { renderTexture: rt, clear: true });
}

function sizeSpriteToScreen(sprite, renderer) {
  sprite.position.set(0, 0);
  sprite.scale.set(1, 1);
  sprite.width = renderer.screen.width;
  sprite.height = renderer.screen.height;
}

function ensureOverlayOnCaptureStage(PIXI, captureStage) {
  let overlay = captureStage.children.find((c) => c?.__fxbusSmearOverlay === true);
  if (!overlay) {
    overlay = new PIXI.Container();
    overlay.__fxbusSmearOverlay = true;
    overlay.eventMode = "none";
    captureStage.addChild(overlay);
  } else {
    // Move to top within capture stage.
    overlay.removeFromParent();
    captureStage.addChild(overlay);
  }

  overlay.visible = true;
  overlay.renderable = true;
  overlay.alpha = 1;

  return overlay;
}

function removeOverlayFromCaptureStage() {
  const captureStage = globalThis.canvas?.stage;
  if (!captureStage) return;

  const overlay = captureStage.children.find((c) => c?.__fxbusSmearOverlay === true);
  if (!overlay) return;

  try {
    overlay.removeFromParent();
    overlay.destroy({ children: true });
  } catch {
    // ignore
  }
}

export function registerScreenSmearFx(runtime) {
  if (!runtime?.handlers || typeof runtime.handlers.set !== "function") {
    console.warn("[FX Bus] screenSmearFx: runtime.handlers missing; smear not registered");
    return;
  }

  const PIXI = getPixi();
  if (!PIXI?.RenderTexture || !PIXI?.Sprite || !PIXI?.Container || !PIXI?.Matrix) {
    console.warn("[FX Bus] screenSmearFx: PIXI requirements missing; smear not registered");
    return;
  }

  const state = {
    active: false,
    startedAtMs: 0,
    durationMs: 0,
    ease: "inOut",

    // Envelope
    strength: 0.85, // 0..1
    persistence: 0.85, // 0..0.999
    freqHz: 0,
    minStrength: 0,
    maxStrength: 1,

    // Motion
    jitterPx: 1,
    maxStepPx: 40,
    cameraWeighted: true,

    // Camera tracking
    lastCamX: 0,
    lastCamY: 0,

    // PIXI
    overlay: null,
    displaySprite: null,

    captureRT: null,
    fbPrev: null,
    fbNext: null,

    mixer: null,
    mixerPrevSprite: null,
    mixerCurrSprite: null
  };

  function teardownGraphics() {
    /**
     * Teardown order matters:
     * - Tick must be stopped before removing/destroying display objects.
     * - Avoids PIXI trying to update transforms for a container with a null parent.
     */
    removeOverlayFromCaptureStage();

    state.overlay = null;
    state.displaySprite = null;

    destroyRT(state.captureRT);
    destroyRT(state.fbPrev);
    destroyRT(state.fbNext);

    state.captureRT = null;
    state.fbPrev = null;
    state.fbNext = null;

    try {
      state.mixer?.destroy?.({ children: true });
    } catch {
      // ignore
    }

    state.mixer = null;
    state.mixerPrevSprite = null;
    state.mixerCurrSprite = null;
  }

  function ensureTexturesAndSprites() {
    /**
     * Ensure all render targets/sprites match renderer.screen + renderer.resolution.
     * Overlay is on canvas.stage but screen-locked by cancelling camera transform.
     */
    const renderer = getRenderer();
    const captureStage = getCaptureStage();

    const w = Math.max(1, Math.floor(renderer.screen.width));
    const h = Math.max(1, Math.floor(renderer.screen.height));
    const res = Number(renderer.resolution ?? 1) || 1;

    const rtRes = (rt) => Number(rt?.baseTexture?.resolution ?? rt?.resolution ?? 0);

    const needRecreate =
      !state.captureRT ||
      !state.fbPrev ||
      !state.fbNext ||
      state.captureRT.width !== w ||
      state.captureRT.height !== h ||
      state.fbPrev.width !== w ||
      state.fbPrev.height !== h ||
      state.fbNext.width !== w ||
      state.fbNext.height !== h ||
      rtRes(state.captureRT) !== res ||
      rtRes(state.fbPrev) !== res ||
      rtRes(state.fbNext) !== res;

    if (needRecreate) {
      destroyRT(state.captureRT);
      destroyRT(state.fbPrev);
      destroyRT(state.fbNext);

      state.captureRT = createRT(renderer, PIXI);
      state.fbPrev = createRT(renderer, PIXI);
      state.fbNext = createRT(renderer, PIXI);

      clearRT(renderer, PIXI, state.captureRT);
      clearRT(renderer, PIXI, state.fbPrev);
      clearRT(renderer, PIXI, state.fbNext);
    }

    if (!state.overlay) state.overlay = ensureOverlayOnCaptureStage(PIXI, captureStage);

    if (!state.displaySprite) {
      state.displaySprite = new PIXI.Sprite(state.fbPrev);
      state.displaySprite.__fxbusSmearDisplay = true;
      state.displaySprite.alpha = 1;
      state.displaySprite.blendMode = PIXI.BLEND_MODES.NORMAL;
      sizeSpriteToScreen(state.displaySprite, renderer);
      state.overlay.addChild(state.displaySprite);
    } else {
      state.displaySprite.texture = state.fbPrev;
      sizeSpriteToScreen(state.displaySprite, renderer);
    }

    if (!state.mixer) {
      state.mixer = new PIXI.Container();
      state.mixerPrevSprite = new PIXI.Sprite(state.fbPrev);
      state.mixerCurrSprite = new PIXI.Sprite(state.captureRT);
      state.mixer.addChild(state.mixerPrevSprite);
      state.mixer.addChild(state.mixerCurrSprite);
    }

    state.mixerPrevSprite.texture = state.fbPrev;
    state.mixerCurrSprite.texture = state.captureRT;

    sizeSpriteToScreen(state.mixerPrevSprite, renderer);
    sizeSpriteToScreen(state.mixerCurrSprite, renderer);

    // Keep overlay screen-locked in the capture pipeline.
    lockContainerToScreenSpace(PIXI, captureStage, state.overlay);
  }

  function stop() {
    /**
     * Stop order:
     * - cleanupTicker first so no further tick touches objects
     * - then teardown PIXI objects
     */
    state.active = false;
    cleanupTicker(runtime, EFFECT_NAME);
    teardownGraphics();
  }

  function normaliseParams(msg) {
    const durationMsRaw = Number.isFinite(msg?.durationMs) ? msg.durationMs : 0;
    const durationMs = durationMsRaw === 0 ? 0 : clamp(durationMsRaw, 1, 600000);

    const strength = clamp(Number.isFinite(msg?.strength) ? msg.strength : 0.85, 0, 1);
    const persistence = clamp(Number.isFinite(msg?.persistence) ? msg.persistence : 0.85, 0, 0.999);

    const freqHz = clamp(Number.isFinite(msg?.freqHz) ? msg.freqHz : 0, 0, 60);
    const minStrength = clamp(Number.isFinite(msg?.minStrength) ? msg.minStrength : 0, 0, 1);
    const maxStrength = clamp(Number.isFinite(msg?.maxStrength) ? msg.maxStrength : 1, 0, 1);

    const jitterPx = clamp(Number.isFinite(msg?.jitterPx) ? msg.jitterPx : 1, 0, 200);
    const maxStepPx = clamp(Number.isFinite(msg?.maxStepPx) ? msg.maxStepPx : 40, 0, 500);

    const ease = String(msg?.ease ?? "inOut");
    const cameraWeighted = Boolean(msg?.cameraWeighted ?? msg?.cameraWeightedSmear ?? true);

    return {
      durationMs,
      strength,
      persistence,
      freqHz,
      minStrength,
      maxStrength,
      jitterPx,
      maxStepPx,
      ease,
      cameraWeighted
    };
  }

  function start(msg = {}) {
    try {
      const p = normaliseParams(msg);

      state.durationMs = p.durationMs;
      state.strength = p.strength;
      state.persistence = p.persistence;
      state.freqHz = p.freqHz;
      state.minStrength = p.minStrength;
      state.maxStrength = p.maxStrength;
      state.jitterPx = p.jitterPx;
      state.maxStepPx = p.maxStepPx;
      state.ease = p.ease;
      state.cameraWeighted = p.cameraWeighted;

      state.active = true;
      state.startedAtMs = nowMs();

      const cam = getCameraXY();
      state.lastCamX = cam.x;
      state.lastCamY = cam.y;

      ensureTexturesAndSprites();

      ensureTicker(runtime, EFFECT_NAME, () => {
        if (!state.active) return;

        const renderer = getRenderer();
        const captureStage = getCaptureStage();

        ensureTexturesAndSprites();

        const elapsedMs = nowMs() - state.startedAtMs;
        const elapsedSec = elapsedMs / 1000;

        let env = 1;
        if (state.durationMs > 0) {
          const t01 = elapsedMs / state.durationMs;
          if (t01 >= 1) {
            stop();
            return;
          }
          env = easeValue(state.ease, t01);
        }

        let strengthNow = state.strength;
        if (state.freqHz > 0) {
          const phase = elapsedSec * state.freqHz * Math.PI * 2;
          const wave01 = (Math.sin(phase) + 1) * 0.5;
          const a = Math.min(state.minStrength, state.maxStrength);
          const b = Math.max(state.minStrength, state.maxStrength);
          strengthNow = a + (b - a) * wave01;
        }

        strengthNow = clamp(strengthNow * env, 0, 1);
        const persistence = clamp(state.persistence, 0, 0.999);

        let dx = 0;
        let dy = 0;

        if (state.cameraWeighted) {
          const c = getCameraXY();
          const dCamX = c.x - state.lastCamX;
          const dCamY = c.y - state.lastCamY;
          state.lastCamX = c.x;
          state.lastCamY = c.y;

          dx += -dCamX;
          dy += -dCamY;
        }

        if (state.jitterPx > 0) {
          const j = state.jitterPx;
          dx += (Math.random() * 2 - 1) * j;
          dy += (Math.random() * 2 - 1) * j;
        }

        dx = clamp(dx, -state.maxStepPx, state.maxStepPx);
        dy = clamp(dy, -state.maxStepPx, state.maxStepPx);

        // Keep overlay screen-locked (camera can change continuously).
        lockContainerToScreenSpace(PIXI, captureStage, state.overlay);

        // Capture what the user sees, excluding our overlay.
        renderStageAsSeen(renderer, captureStage, state.captureRT, {
          clear: true,
          hide: [state.overlay]
        });

        try {
          state.mixerPrevSprite.alpha = persistence;
          state.mixerCurrSprite.alpha = strengthNow;

          renderer.render(state.mixer, { renderTexture: state.fbNext, clear: true });

          const tmp = state.fbPrev;
          state.fbPrev = state.fbNext;
          state.fbNext = tmp;

          state.displaySprite.texture = state.fbPrev;
          state.mixerPrevSprite.texture = state.fbPrev;
          state.mixerCurrSprite.texture = state.captureRT;

          sizeSpriteToScreen(state.displaySprite, renderer);
          sizeSpriteToScreen(state.mixerPrevSprite, renderer);
          sizeSpriteToScreen(state.mixerCurrSprite, renderer);

          // Smear shift is applied in screen space (overlay is screen-locked).
          state.displaySprite.x = dx;
          state.displaySprite.y = dy;

          // Keep mixer sprites anchored for next frame.
          state.mixerPrevSprite.position.set(0, 0);
          state.mixerCurrSprite.position.set(0, 0);
        } catch (err) {
          console.error("[FX Bus] screenSmear tick failed", err);
          stop();
        }
      });
    } catch (err) {
      console.error("[FX Bus] screenSmear start failed", err);
      stop();
    }
  }

  runtime.handlers.set(ACTION_START, start);
  runtime.handlers.set(ACTION_STOP, stop);
}
