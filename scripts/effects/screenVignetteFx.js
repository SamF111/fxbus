/**
 * FX Bus - Screen Vignette FX (Foundry VTT v12+ / v13)
 *
 * Purpose:
 * - Apply a full-screen vignette (darkened edges, clear centre).
 * - Can be static or "breathing" (oscillating intensity).
 * - Runs for a fixed duration or indefinitely until stopped.
 * - Runs entirely client-side. No document updates.
 *
 * Actions:
 * - fx.screenVignette.start: start vignette (overwrites any existing active vignette state)
 * - fx.screenVignette.stop: stop immediately and remove vignette
 *
 * Parameters (payload fields):
 * - colour: string hex (default "#000000") - "#RRGGBB" or "RRGGBB"
 * - innerRadius: number 0-1 (default 0.6) - centre clear radius fraction
 * - outerRadius: number 0-1 (default 0.95) - edge dark radius fraction
 *
 * Intensity:
 * - maxAlpha: number 0-1 (default 0.6) - peak opacity at edges
 * - minAlpha: number 0-1 (default 0.0) - minimum opacity at edges (used when freqHz > 0)
 * - freqHz: number (default 0)         - if > 0, vignette "breathes" between minAlpha and maxAlpha
 * - shape: "sine" | "triangle" (default "sine")
 *
 * Timing:
 * - durationMs: number (default 1200)
 *     - If 0: run indefinitely until fx.screenVignette.stop or fx.bus.reset
 *     - Else: clamped to [1, 60000]
 * - ease: "inOut" | "in" | "out" | "linear" (default "inOut")
 *
 * Render:
 * - blendMode: "MULTIPLY" | "SCREEN" | "ADD" | "NORMAL" (default "MULTIPLY")
 *
 * Critical:
 * - Sprite is laid out to the current viewport bounds using stage.toLocal(), so it covers the screen
 *   regardless of pan/zoom/resize/scene changes.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, easeOutQuad } from "../utils.js";

const EFFECT_NAME = "screenVignette";

const ACTION_START = "fx.screenVignette.start";
const ACTION_STOP = "fx.screenVignette.stop";

export function registerScreenVignetteFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] screenVignetteFx: invalid runtime.");

  runtime.handlers.set(ACTION_START, (msg) => onStart(runtime, msg));
  runtime.handlers.set(ACTION_STOP, () => onStop(runtime));
}

function normaliseParams(msg) {
  const colour = typeof msg.colour === "string" ? msg.colour.trim() : "#000000";

  const innerRadiusRaw = Number.isFinite(msg.innerRadius) ? msg.innerRadius : 0.6;
  const outerRadiusRaw = Number.isFinite(msg.outerRadius) ? msg.outerRadius : 0.95;

  const maxAlphaRaw = Number.isFinite(msg.maxAlpha) ? msg.maxAlpha : 0.6;
  const minAlphaRaw = Number.isFinite(msg.minAlpha) ? msg.minAlpha : 0.0;

  const freqHzRaw = Number.isFinite(msg.freqHz) ? msg.freqHz : 0;
  const shape = msg.shape === "triangle" ? "triangle" : "sine";

  const durationMsRaw = Number.isFinite(msg.durationMs) ? msg.durationMs : 1200;
  const durationMs = durationMsRaw === 0 ? 0 : clamp(durationMsRaw, 1, 60000);

  const ease = typeof msg.ease === "string" ? msg.ease.trim() : "inOut";
  const blendMode = typeof msg.blendMode === "string" ? msg.blendMode.trim().toUpperCase() : "MULTIPLY";

  const innerRadius = clamp(innerRadiusRaw, 0, 1);
  const outerRadius = clamp(outerRadiusRaw, 0, 1);

  const maxAlpha = clamp(maxAlphaRaw, 0, 1);
  const minAlpha = clamp(minAlphaRaw, 0, 1);

  return {
    colour,
    innerRadius: Math.min(innerRadius, outerRadius),
    outerRadius: Math.max(innerRadius, outerRadius),
    maxAlpha: Math.max(minAlpha, maxAlpha),
    minAlpha: Math.min(minAlpha, maxAlpha),
    freqHz: clamp(freqHzRaw, 0, 30),
    shape,
    durationMs,
    ease,
    blendMode
  };
}

function getState(runtime) {
  return runtime.screenFx.get(EFFECT_NAME) ?? null;
}

function setState(runtime, state) {
  runtime.screenFx.set(EFFECT_NAME, state);
}

function clearState(runtime) {
  runtime.screenFx.delete(EFFECT_NAME);
}

function parseHexToRgb(hex) {
  const s = String(hex || "").replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(s, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255
  };
}

function resolveBlendMode(name) {
  const m = globalThis.PIXI?.BLEND_MODES;
  if (!m) return 0;

  switch (name) {
    case "SCREEN": return m.SCREEN ?? m.NORMAL;
    case "ADD": return m.ADD;
    case "NORMAL": return m.NORMAL;
    case "MULTIPLY":
    default: return m.MULTIPLY ?? m.NORMAL;
  }
}

function getViewportRectInStageLocal() {
  const stage = canvas?.app?.stage;
  const renderer = canvas?.app?.renderer;
  const Point = globalThis.PIXI?.Point;

  if (!stage || !renderer || !Point) return null;

  const w = renderer.screen?.width ?? renderer.width ?? window.innerWidth;
  const h = renderer.screen?.height ?? renderer.height ?? window.innerHeight;

  const tl = stage.toLocal(new Point(0, 0));
  const br = stage.toLocal(new Point(w, h));

  return {
    x: tl.x,
    y: tl.y,
    width: br.x - tl.x,
    height: br.y - tl.y
  };
}

function makeVignetteTexture(params) {
  const size = 512;

  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;

  const ctx = c.getContext("2d");
  if (!ctx) return null;

  const { r, g, b } = parseHexToRgb(params.colour);

  const cx = size / 2;
  const cy = size / 2;

  const maxR = Math.min(cx, cy);
  const innerR = maxR * params.innerRadius;
  const outerR = maxR * params.outerRadius;

  // Gradient alpha goes 0->1. Sprite alpha will scale to min/max over time.
  const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`);

  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const Texture = globalThis.PIXI?.Texture;
  if (!Texture) return null;

  return Texture.from(c);
}

function ensureSprite(runtime, params) {
  const stage = canvas?.app?.stage;
  const Sprite = globalThis.PIXI?.Sprite;

  if (!stage || !Sprite) return null;

  let sprite = runtime.__screenVignetteSprite ?? null;

  if (!sprite) {
    sprite = new Sprite();
    sprite.name = "fxbus.screenVignette";
    sprite.visible = false;
    sprite.alpha = 0;
    sprite.eventMode = "none";
    stage.addChild(sprite);

    runtime.__screenVignetteSprite = sprite;
  }

  const oldTex = sprite.texture;
  const tex = makeVignetteTexture(params);
  if (!tex) return null;

  sprite.texture = tex;

  try {
    if (oldTex && oldTex !== tex) oldTex.destroy(true);
  } catch (_) {}

  sprite.blendMode = resolveBlendMode(params.blendMode);
  sprite.visible = true;
  sprite.alpha = 0;

  return sprite;
}

function layoutSpriteToViewport(sprite) {
  const rect = getViewportRectInStageLocal();
  if (!rect) return;

  sprite.position.set(rect.x, rect.y);
  sprite.width = rect.width;
  sprite.height = rect.height;
}

function removeSprite(runtime) {
  const sprite = runtime.__screenVignetteSprite ?? null;
  if (!sprite) return;

  try {
    const tex = sprite.texture;
    if (sprite.parent) sprite.parent.removeChild(sprite);
    sprite.destroy({ children: true });
    try { tex?.destroy(true); } catch (_) {}
  } catch (_) {}

  runtime.__screenVignetteSprite = null;
}

function envelope(easeName, t01) {
  const t = clamp(t01, 0, 1);

  if (easeName === "linear") return t;

  if (easeName === "in") return t * t;

  if (easeName === "out") return 1 - (1 - t) * (1 - t);

  // inOut
  return t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function wave(shape, phase01) {
  const p = phase01 - Math.floor(phase01);
  if (shape === "triangle") return 1 - Math.abs(2 * p - 1);
  return (Math.sin(2 * Math.PI * p) + 1) / 2;
}

function onStart(runtime, msg) {
  const params = normaliseParams(msg);

  const sprite = ensureSprite(runtime, params);
  if (!sprite) return;

  layoutSpriteToViewport(sprite);

  setState(runtime, {
    params,
    sprite,
    elapsedMs: 0
  });

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onStop(runtime) {
  removeSprite(runtime);
  clearState(runtime);
  cleanupTicker(runtime, EFFECT_NAME);
}

function tick(runtime, deltaMS) {
  const state = getState(runtime);
  if (!state) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  const sprite = state.sprite;
  if (!sprite) {
    onStop(runtime);
    return;
  }

  layoutSpriteToViewport(sprite);

  state.elapsedMs += Math.max(0, deltaMS);

  const { params, elapsedMs } = state;

  // Time envelope:
  // - indefinite: constant 1
  // - finite: 0->1->0 across duration (peaks mid)
  let env = 1;
  if (params.durationMs !== 0) {
    const t01 = clamp(elapsedMs / params.durationMs, 0, 1);
    const e = envelope(params.ease, t01);
    env = 1 - Math.abs(2 * e - 1);
  }

  // Breathing intensity:
  // - freqHz <= 0: constant maxAlpha
  // - freqHz > 0: oscillate between minAlpha and maxAlpha
  let intensity = params.maxAlpha;
  if (params.freqHz > 0) {
    const phase01 = (elapsedMs / 1000) * params.freqHz;
    const wv = wave(params.shape, phase01);
    intensity = params.minAlpha + (params.maxAlpha - params.minAlpha) * wv;
  }

  sprite.alpha = clamp(env * intensity, 0, 1);
  sprite.blendMode = resolveBlendMode(params.blendMode);

  if (params.durationMs !== 0 && elapsedMs >= params.durationMs) {
    onStop(runtime);
  }
}
