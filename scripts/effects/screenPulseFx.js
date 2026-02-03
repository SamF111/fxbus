/**
 * FX Bus - Screen Pulse FX (Foundry VTT v12+)
 *
 * Purpose:
 * - Pulse a full-screen colour overlay for a fixed duration or indefinitely until stopped.
 * - Runs entirely client-side. No document updates.
 *
 * Actions:
 * - fx.screenPulse.start: start a pulse (overwrites any existing active pulse state)
 * - fx.screenPulse.stop: stop immediately and remove the overlay
 *
 * Parameters (payload fields):
 * - colour: string hex (default "#ff0000") - "#RRGGBB" or "#RRGGBBAA" (alpha ignored, use minAlpha/maxAlpha)
 * - durationMs: number (default 1500)
 *     - If 0: run indefinitely until fx.screenPulse.stop or fx.bus.reset
 *     - Else: clamped to [1, 60000]
 * - freqHz: number (default 2.0)
 * - maxAlpha: number 0-1 (default 0.35)
 * - minAlpha: number 0-1 (default 0.0)
 * - shape: "sine" | "triangle" (default "sine")
 * - blendMode: "SCREEN" | "MULTIPLY" | "ADD" | "NORMAL" (default "SCREEN")
 * - ease: "inOut" | "in" | "out" | "linear" (default "inOut")
 *
 * Critical:
 * - Overlay is drawn to the current viewport bounds using stage.toLocal(), so it covers the screen
 *   regardless of pan/zoom.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, easeOutQuad } from "../utils.js";

const EFFECT_NAME = "screenPulse";

const ACTION_START = "fx.screenPulse.start";
const ACTION_STOP = "fx.screenPulse.stop";

export function registerScreenPulseFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] screenPulseFx: invalid runtime.");

  runtime.handlers.set(ACTION_START, (msg) => onStart(runtime, msg));
  runtime.handlers.set(ACTION_STOP, () => onStop(runtime));
}

function normaliseParams(msg) {
  const colour = typeof msg.colour === "string" ? msg.colour.trim() : "#ff0000";

  const durationMsRaw = Number.isFinite(msg.durationMs) ? msg.durationMs : 1500;
  const durationMs = durationMsRaw === 0 ? 0 : clamp(durationMsRaw, 1, 60000);

  const freqHz = Number.isFinite(msg.freqHz) ? msg.freqHz : 2.0;

  const maxAlpha = Number.isFinite(msg.maxAlpha) ? msg.maxAlpha : 0.35;
  const minAlpha = Number.isFinite(msg.minAlpha) ? msg.minAlpha : 0.0;

  const shape = msg.shape === "triangle" ? "triangle" : "sine";

  const blendMode = (typeof msg.blendMode === "string" ? msg.blendMode.trim().toUpperCase() : "SCREEN");
  const ease = (typeof msg.ease === "string" ? msg.ease.trim().toLowerCase() : "inout");

  return {
    colour,
    durationMs,
    freqHz: clamp(freqHz, 0.1, 30),
    maxAlpha: clamp(maxAlpha, 0, 1),
    minAlpha: clamp(minAlpha, 0, 1),
    shape,
    blendMode,
    ease
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

function parseHexColour(hex) {
  const s = String(hex || "").replace("#", "").trim();
  if (s.length !== 6 && s.length !== 8) return 0xff0000;
  const rgb = s.slice(0, 6);
  const n = Number.parseInt(rgb, 16);
  return Number.isFinite(n) ? n : 0xff0000;
}

function resolveBlendMode(name) {
  const m = globalThis.PIXI?.BLEND_MODES;
  if (!m) return 0;

  switch (name) {
    case "MULTIPLY": return m.MULTIPLY;
    case "ADD": return m.ADD;
    case "NORMAL": return m.NORMAL;
    case "SCREEN":
    default: return m.SCREEN ?? m.NORMAL;
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

function ensureOverlay(runtime) {
  const stage = canvas?.app?.stage;
  const Graphics = globalThis.PIXI?.Graphics;

  if (!stage || !Graphics) return null;

  let overlay = runtime.__screenPulseOverlay ?? null;

  if (!overlay) {
    overlay = new Graphics();
    overlay.name = "fxbus.screenPulse";
    overlay.visible = false;
    overlay.alpha = 0;

    // Do not interfere with input
    overlay.eventMode = "none";

    stage.addChild(overlay);
    runtime.__screenPulseOverlay = overlay;
  }

  overlay.visible = true;
  overlay.alpha = 0;

  return overlay;
}

function redrawOverlayToViewport(overlay, colourHex) {
  const rect = getViewportRectInStageLocal();
  if (!rect) return;

  overlay.clear();
  overlay.beginFill(colourHex, 1.0);
  overlay.drawRect(rect.x, rect.y, rect.width, rect.height);
  overlay.endFill();
}

function removeOverlay(runtime) {
  const overlay = runtime.__screenPulseOverlay ?? null;
  if (!overlay) return;

  try {
    if (overlay.parent) overlay.parent.removeChild(overlay);
    overlay.destroy({ children: true });
  } catch (_) {}

  runtime.__screenPulseOverlay = null;
}

function envelope(easeName, t01) {
  const t = clamp(t01, 0, 1);

  if (easeName === "linear") {
    return 1 - Math.abs(2 * t - 1);
  }

  if (easeName === "in") {
    const tri = 1 - Math.abs(2 * t - 1);
    return clamp(tri * tri, 0, 1);
  }

  if (easeName === "out") {
    const tri = 1 - Math.abs(2 * t - 1);
    return easeOutQuad(tri);
  }

  const tri = 1 - Math.abs(2 * t - 1);
  const half = tri <= 0.5 ? (tri / 0.5) : (1 - (tri - 0.5) / 0.5);
  return 1 - (1 - half) * (1 - half);
}

function wave(shape, phase01) {
  const p = phase01 - Math.floor(phase01);

  if (shape === "triangle") {
    return 1 - Math.abs(2 * p - 1);
  }

  return (Math.sin(2 * Math.PI * p) + 1) / 2;
}

function onStart(runtime, msg) {
  const params = normaliseParams(msg);

  const overlay = ensureOverlay(runtime);
  if (!overlay) return;

  overlay.blendMode = resolveBlendMode(params.blendMode);
  redrawOverlayToViewport(overlay, parseHexColour(params.colour));

  setState(runtime, {
    params,
    overlay,
    elapsedMs: 0
  });

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

function onStop(runtime) {
  removeOverlay(runtime);
  clearState(runtime);
  cleanupTicker(runtime, EFFECT_NAME);
}

function tick(runtime, deltaMS) {
  const state = getState(runtime);
  if (!state) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  const overlay = state.overlay;
  if (!overlay) {
    onStop(runtime);
    return;
  }

  redrawOverlayToViewport(overlay, parseHexColour(state.params.colour));

  state.elapsedMs += Math.max(0, deltaMS);

  const { params, elapsedMs } = state;

  const t01 = params.durationMs === 0 ? 0 : clamp(elapsedMs / params.durationMs, 0, 1);
  const env = params.durationMs === 0 ? 1 : envelope(params.ease, t01);

  const phase01 = (elapsedMs / 1000) * params.freqHz;
  const wv = wave(params.shape, phase01);

  const minA = Math.min(params.minAlpha, params.maxAlpha);
  const maxA = Math.max(params.minAlpha, params.maxAlpha);
  const oscAlpha = minA + (maxA - minA) * wv;

  overlay.alpha = clamp(oscAlpha * env, 0, 1);
  overlay.blendMode = resolveBlendMode(params.blendMode);

  if (params.durationMs !== 0 && elapsedMs >= params.durationMs) {
    onStop(runtime);
  }
}
