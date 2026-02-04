// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\screenStreakFx.js

/**
 * FX Bus - Screen Streak FX (Foundry v13+)
 *
 * Behaviour fix:
 * - The streak “builds” when the fresh capture contribution decreases over time,
 *   allowing the shifted feedback buffer to dominate.
 *
 * Modes:
 * - Finite (durationMs > 0):
 *   - env decays 1 -> 0 over durationMs
 *   - auto-stops at end
 * - Indefinite (durationMs === 0):
 *   - env decays 1 -> HOLD_ENV_INDEFINITE over rampMs (clamped to <= 1000ms)
 *   - then holds (no auto-stop)
 *
 * Alignment:
 * - Capture: canvas.stage via renderStageAsSeen()
 * - Display: overlay is a child of canvas.stage, screen-locked via lockContainerToScreenSpace()
 * - Feedback avoidance: hide overlay during capture
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { renderStageAsSeen, lockContainerToScreenSpace } from "./shared/capture.js";

const EFFECT_NAME = "screenStreak";
const ACTION_START = "fx.screenStreak.start";
const ACTION_STOP = "fx.screenStreak.stop";

const RAMP_MS_DEFAULT = 250;
const RAMP_MS_MAX = 1000;

// After ramp, keep a small amount of fresh capture so the effect remains “alive” indefinitely.
const HOLD_ENV_INDEFINITE = 0.10;

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

function getCaptureStage() {
  const s = globalThis.canvas?.stage;
  if (!s) throw new Error("[FX Bus] canvas.stage unavailable");
  return s;
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
  let overlay = captureStage.children.find((c) => c?.__fxbusStreakOverlay === true);
  if (!overlay) {
    overlay = new PIXI.Container();
    overlay.__fxbusStreakOverlay = true;
    overlay.eventMode = "none";
    captureStage.addChild(overlay);
  } else {
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

  const overlay = captureStage.children.find((c) => c?.__fxbusStreakOverlay === true);
  if (!overlay) return;

  try {
    overlay.removeFromParent();
    overlay.destroy({ children: true });
  } catch {
    // ignore
  }
}

export function registerScreenStreakFx(runtime) {
  if (!runtime?.handlers || typeof runtime.handlers.set !== "function") {
    console.warn("[FX Bus] screenStreakFx: runtime.handlers missing; not registered");
    return;
  }

  const PIXI = getPixi();
  if (!PIXI?.RenderTexture || !PIXI?.Sprite || !PIXI?.Container || !PIXI?.Matrix) {
    console.warn("[FX Bus] screenStreakFx: PIXI requirements missing; not registered");
    return;
  }

  const state = {
    active: false,
    startedAtMs: 0,

    // Params
    strength: 0.6,
    persistence: 0.9,
    lengthPx: 60,
    angleDeg: 0,
    jitterPx: 0,
    freqHz: 0,
    durationMs: 0, // 0 = indefinite
    ease: "inOut",
    rampMs: RAMP_MS_DEFAULT, // used only when durationMs === 0

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
      state.displaySprite.__fxbusStreakDisplay = true;
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

    lockContainerToScreenSpace(PIXI, captureStage, state.overlay);
  }

  function stop() {
    state.active = false;
    cleanupTicker(runtime, EFFECT_NAME);
    teardownGraphics();
  }

  function normaliseParams(msg) {
    const strength = clamp(Number.isFinite(msg?.strength) ? msg.strength : 0.6, 0, 1);
    const persistence = clamp(Number.isFinite(msg?.persistence) ? msg.persistence : 0.9, 0, 0.999);

    const lengthPx = clamp(Number.isFinite(msg?.lengthPx) ? msg.lengthPx : 60, 0, 2000);
    const angleDeg = Number.isFinite(msg?.angleDeg) ? msg.angleDeg : 0;

    const jitterPx = clamp(Number.isFinite(msg?.jitterPx) ? msg.jitterPx : 0, 0, 200);
    const freqHz = clamp(Number.isFinite(msg?.freqHz) ? msg.freqHz : 0, 0, 60);

    const durationRaw = Number.isFinite(msg?.durationMs) ? msg.durationMs : 0;
    const durationMs = durationRaw === 0 ? 0 : clamp(durationRaw, 1, 600000);

    const rampRaw = Number.isFinite(msg?.rampMs) ? msg.rampMs : RAMP_MS_DEFAULT;
    const rampMs = clamp(rampRaw, 0, RAMP_MS_MAX);

    const ease = String(msg?.ease ?? "inOut");

    return { strength, persistence, lengthPx, angleDeg, jitterPx, freqHz, durationMs, rampMs, ease };
  }

  function computeEnv(elapsedMs) {
    // Finite: decay 1 -> 0 over duration.
    if (state.durationMs > 0) {
      const t01 = clamp(elapsedMs / Math.max(1, state.durationMs), 0, 1);
      return 1 - easeValue(state.ease, t01);
    }

    // Indefinite: decay 1 -> HOLD over rampMs, then hold.
    if (state.rampMs <= 0) return HOLD_ENV_INDEFINITE;

    const t01 = clamp(elapsedMs / Math.max(1, state.rampMs), 0, 1);
    const dec01 = easeValue(state.ease, t01); // 0 -> 1
    return (1 - dec01) * (1 - HOLD_ENV_INDEFINITE) + HOLD_ENV_INDEFINITE;
  }

  function start(msg = {}) {
    try {
      const p = normaliseParams(msg);

      state.strength = p.strength;
      state.persistence = p.persistence;
      state.lengthPx = p.lengthPx;
      state.angleDeg = p.angleDeg;
      state.jitterPx = p.jitterPx;
      state.freqHz = p.freqHz;
      state.durationMs = p.durationMs;
      state.rampMs = p.rampMs;
      state.ease = p.ease;

      state.active = true;
      state.startedAtMs = nowMs();

      ensureTexturesAndSprites();

      ensureTicker(runtime, EFFECT_NAME, () => {
        if (!state.active) return;

        const renderer = getRenderer();
        const captureStage = getCaptureStage();

        ensureTexturesAndSprites();

        const elapsedMs = nowMs() - state.startedAtMs;
        const elapsedSec = elapsedMs / 1000;

        if (state.durationMs > 0 && elapsedMs >= state.durationMs) {
          stop();
          return;
        }

        const env = computeEnv(elapsedMs);

        // Length modulation: keep length independent of env so “hold” really holds.
        let len = state.lengthPx;
        if (state.freqHz > 0) {
          const phase = elapsedSec * state.freqHz * Math.PI * 2;
          const wave01 = (Math.sin(phase) + 1) * 0.5;
          len = state.lengthPx * wave01;
        }

        const ang = (Number(state.angleDeg) * Math.PI) / 180;
        let sx = Math.cos(ang) * len;
        let sy = Math.sin(ang) * len;

        if (state.jitterPx > 0) {
          const j = state.jitterPx;
          sx += (Math.random() * 2 - 1) * j;
          sy += (Math.random() * 2 - 1) * j;
        }

        lockContainerToScreenSpace(PIXI, captureStage, state.overlay);

        renderStageAsSeen(renderer, captureStage, state.captureRT, {
          clear: true,
          hide: [state.overlay]
        });

        try {
          state.mixerPrevSprite.alpha = clamp(state.persistence, 0, 0.999);
          state.mixerCurrSprite.alpha = clamp(state.strength * env, 0, 1);

          state.mixerPrevSprite.position.set(sx, sy);
          state.mixerCurrSprite.position.set(0, 0);

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

          state.mixerPrevSprite.position.set(0, 0);
          state.mixerCurrSprite.position.set(0, 0);
          state.displaySprite.position.set(0, 0);
        } catch (err) {
          console.error("[FX Bus] screenStreak tick failed", err);
          stop();
        }
      });
    } catch (err) {
      console.error("[FX Bus] screenStreak start failed", err);
      stop();
    }
  }

  runtime.handlers.set(ACTION_START, start);
  runtime.handlers.set(ACTION_STOP, stop);
}
