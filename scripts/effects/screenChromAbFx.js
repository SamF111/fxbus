/**
 * FX Bus - Screen Chromatic Aberration FX (Foundry VTT v13)
 *
 * Purpose:
 * - RGB channel split, optionally animated (pulsing amount and/or rotating direction).
 * - Client-side only. No document updates.
 *
 * Actions:
 * - fx.chromAb.start: start or update (overwrites existing state, preserves base stage filters snapshot)
 * - fx.chromAb.stop: stop and restore prior stage filters
 *
 * Parameters (payload fields):
 * - amountPx: number (default 1.2)          base separation magnitude in pixels
 * - angleDeg: number (default 0)           base direction in degrees
 * - durationMs: number (default 0)         0 = until stopped; otherwise auto-stop after duration
 *
 * Animation (all optional):
 * - freqHz: number (default 0)             0 = static; >0 animates amount between min..max
 * - minAmountPx: number (default amountPx) minimum separation when animating
 * - maxAmountPx: number (default amountPx) maximum separation when animating
 * - shape: "sine" | "triangle" (default "sine")
 * - rotateDegPerSec: number (default 0)    rotate direction continuously
 *
 * Envelope:
 * - ease: "linear" | "in" | "out" | "inOut" (default "inOut")
 *   Applies only when durationMs > 0.
 *
 * Notes:
 * - Uses a custom PIXI.Filter shader (no RGBSplitFilter dependency).
 * - Deterministic (no RNG).
 * - Restores exact prior stage.filters snapshot.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp } from "../utils.js";

const EFFECT_NAME = "chromAb";

export function registerScreenChromAbFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] screenChromAbFx: invalid runtime.");

  runtime.handlers.set("fx.chromAb.start", (msg) => onStart(runtime, msg));
  runtime.handlers.set("fx.chromAb.stop", () => onStop(runtime));
}

function normaliseParams(msg) {
  const amountPx = Number.isFinite(msg.amountPx) ? msg.amountPx : 1.2;
  const angleDeg = Number.isFinite(msg.angleDeg) ? msg.angleDeg : 0;
  const durationMs = Number.isFinite(msg.durationMs) ? msg.durationMs : 0;

  const freqHz = Number.isFinite(msg.freqHz) ? msg.freqHz : 0;
  const minAmountPx = Number.isFinite(msg.minAmountPx) ? msg.minAmountPx : amountPx;
  const maxAmountPx = Number.isFinite(msg.maxAmountPx) ? msg.maxAmountPx : amountPx;

  const rotateDegPerSec = Number.isFinite(msg.rotateDegPerSec) ? msg.rotateDegPerSec : 0;

  const shapeRaw = typeof msg.shape === "string" ? msg.shape : "sine";
  const shape = shapeRaw === "triangle" ? "triangle" : "sine";

  const easeRaw = typeof msg.ease === "string" ? msg.ease : "inOut";
  const ease = (easeRaw === "linear" || easeRaw === "in" || easeRaw === "out" || easeRaw === "inOut") ? easeRaw : "inOut";

  const base = clamp(amountPx, 0, 30);
  const minA = clamp(Math.min(minAmountPx, maxAmountPx), 0, 30);
  const maxA = clamp(Math.max(minAmountPx, maxAmountPx), 0, 30);

  return {
    amountPx: base,
    angleDeg,
    durationMs: clamp(durationMs, 0, 600000),

    freqHz: clamp(freqHz, 0, 30),
    minAmountPx: minA,
    maxAmountPx: maxA,
    shape,

    rotateDegPerSec: clamp(rotateDegPerSec, -720, 720),
    ease
  };
}

function getStage() {
  return canvas?.app?.stage ?? null;
}

function getRenderer() {
  return canvas?.app?.renderer ?? null;
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

function ensureChromAbFilter() {
  const PIXI_NS = globalThis.PIXI;
  if (!PIXI_NS?.Filter) return null;

  const vertex = `
    precision highp float;

    attribute vec2 aVertexPosition;
    attribute vec2 aTextureCoord;

    uniform mat3 projectionMatrix;

    varying vec2 vTextureCoord;

    void main(void) {
      vTextureCoord = aTextureCoord;
      vec3 pos = projectionMatrix * vec3(aVertexPosition, 1.0);
      gl_Position = vec4(pos.xy, 0.0, 1.0);
    }
  `;

  const fragment = `
    precision highp float;

    varying vec2 vTextureCoord;
    uniform sampler2D uSampler;

    uniform vec2 uInvRes;   // (1/width, 1/height)
    uniform vec2 uRedPx;
    uniform vec2 uGreenPx;
    uniform vec2 uBluePx;

    vec2 clamp01(vec2 uv) {
      return clamp(uv, vec2(0.0), vec2(1.0));
    }

    void main(void) {
      vec2 ro = clamp01(vTextureCoord + uRedPx * uInvRes);
      vec2 go = clamp01(vTextureCoord + uGreenPx * uInvRes);
      vec2 bo = clamp01(vTextureCoord + uBluePx * uInvRes);

      vec4 r = texture2D(uSampler, ro);
      vec4 g = texture2D(uSampler, go);
      vec4 b = texture2D(uSampler, bo);

      float a = max(r.a, max(g.a, b.a));
      gl_FragColor = vec4(r.r, g.g, b.b, a);
    }
  `;

  const uniforms = {
    uInvRes: new Float32Array([1, 1]),
    uRedPx: new Float32Array([0, 0]),
    uGreenPx: new Float32Array([0, 0]),
    uBluePx: new Float32Array([0, 0])
  };

  return new PIXI_NS.Filter(vertex, fragment, uniforms);
}

function setInvRes(filter, renderer) {
  const w = Math.max(1, renderer?.screen?.width ?? 1);
  const h = Math.max(1, renderer?.screen?.height ?? 1);
  filter.uniforms.uInvRes[0] = 1 / w;
  filter.uniforms.uInvRes[1] = 1 / h;
}

function setOffsets(filter, amountPx, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad) * amountPx;
  const dy = Math.sin(rad) * amountPx;

  filter.uniforms.uRedPx[0] = dx;
  filter.uniforms.uRedPx[1] = dy;

  filter.uniforms.uGreenPx[0] = 0;
  filter.uniforms.uGreenPx[1] = 0;

  filter.uniforms.uBluePx[0] = -dx;
  filter.uniforms.uBluePx[1] = -dy;
}

function triangle01(phase01) {
  const x = phase01 - Math.floor(phase01);
  return 1 - Math.abs(2 * x - 1); // 0..1
}

function wave01(shape, tSeconds, freqHz) {
  if (freqHz <= 0) return 1;
  const phase01 = tSeconds * freqHz;
  if (shape === "triangle") return triangle01(phase01);
  return 0.5 + 0.5 * Math.sin(2 * Math.PI * phase01); // 0..1
}

function easeEnvelope(ease, t01) {
  const t = clamp(t01, 0, 1);
  if (ease === "linear") return 1;

  if (ease === "in") return t * t;

  if (ease === "out") {
    const u = 1 - t;
    return 1 - u * u;
  }

  // inOut (smoothstep-ish)
  return t * t * (3 - 2 * t);
}

function applyFilterToStage(stage, filter, existingFilter) {
  const current = Array.isArray(stage.filters) ? stage.filters.slice() : [];
  const withoutOld = current.filter((f) => f !== existingFilter);
  stage.filters = withoutOld.concat([filter]);
}

function onStart(runtime, msg) {
  const stage = getStage();
  const renderer = getRenderer();
  if (!stage || !renderer) return;

  const params = normaliseParams(msg);
  const existing = getState(runtime);

  const baseFilters =
    existing?.baseFilters ??
    (Array.isArray(stage.filters) ? stage.filters.slice() : null);

  const filter = existing?.filter ?? ensureChromAbFilter();
  if (!filter) {
    ui.notifications?.error?.("FX Bus: PIXI.Filter unavailable - cannot run chromatic aberration.");
    return;
  }

  // Padding helps edge artefacts and culling behaviour.
  const pad = Math.max(2, Math.ceil(Math.max(params.maxAmountPx, params.amountPx)) + 2);
  filter.padding = pad;

  // Provide stable filterArea for stage-wide filtering.
  try {
    if (renderer?.screen) stage.filterArea = renderer.screen;
  } catch {
    // ignore
  }

  setInvRes(filter, renderer);

  // Install/replace filter.
  applyFilterToStage(stage, filter, existing?.filter);

  // Persist state and start ticker if needed (animation and/or timed duration).
  const needsTicker = (params.freqHz > 0) || (params.rotateDegPerSec !== 0) || (params.durationMs > 0);

  setState(runtime, {
    baseFilters,
    filter,
    params,
    tSeconds: 0,
    elapsedMs: 0
  });

  // Apply one immediate evaluation for static.
  tick(runtime, 0);

  if (needsTicker) ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
  else cleanupTicker(runtime, EFFECT_NAME);
}

function onStop(runtime) {
  const stage = getStage();
  if (!stage) return;

  const state = getState(runtime);
  if (!state) return;

  if (state.baseFilters === null) stage.filters = null;
  else stage.filters = Array.isArray(state.baseFilters) ? state.baseFilters.slice() : null;

  clearState(runtime);
  cleanupTicker(runtime, EFFECT_NAME);
}

function tick(runtime, deltaMS) {
  const stage = getStage();
  const renderer = getRenderer();
  const state = getState(runtime);

  if (!stage || !renderer || !state?.filter || !state?.params) {
    cleanupTicker(runtime, EFFECT_NAME);
    return;
  }

  const dt = Math.max(0, deltaMS) / 1000;
  state.tSeconds += dt;
  state.elapsedMs += Math.max(0, deltaMS);

  const p = state.params;

  // Envelope: 1 (until stopped) or eased 0->1 across duration.
  let env = 1;
  if (p.durationMs > 0) {
    env = easeEnvelope(p.ease, state.elapsedMs / p.durationMs);
  }

  // Amount animation: wave between min and max.
  let amount = p.amountPx;

  if (p.freqHz > 0) {
    const w = wave01(p.shape, state.tSeconds, p.freqHz); // 0..1
    amount = p.minAmountPx + (p.maxAmountPx - p.minAmountPx) * w;
  }

  amount *= env;

  // Angle animation: rotate around base angle.
  const angle = p.angleDeg + p.rotateDegPerSec * state.tSeconds;

  setInvRes(state.filter, renderer);
  setOffsets(state.filter, amount, angle);

  if (p.durationMs > 0 && state.elapsedMs >= p.durationMs) {
    onStop(runtime);
  }
}
