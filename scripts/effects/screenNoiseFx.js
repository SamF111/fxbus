/**
 * FX Bus - Screen Noise FX (Foundry VTT v13)
 *
 * Purpose:
 * - Overlay animated TV-static style noise across the whole view.
 * - Client-side only. No document updates.
 *
 * Actions:
 * - fx.noise.start: start or update (reuses existing base snapshot)
 * - fx.noise.stop: stop and restore prior stage filters
 *
 * Parameters:
 * - intensity: number (default 0.25)      noise strength (0-1)
 * - alpha: number (default 0.35)         blend amount (0-1)
 * - grainPx: number (default 2)          approximate grain size in pixels (1-24)
 * - fps: number (default 20)             update rate (1-60)
 * - monochrome: boolean (default true)   monochrome if true, RGB if false
 * - durationMs: number (default 0)       0 = until stopped
 * - seed: number (default 1)             decorrelates patterns between sessions/uses
 *
 * Notes:
 * - Still deterministic (no RNG), but looks far less “patterned”.
 * - Uses per-pixel noise with intra-cell jitter and frame decorrelation.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp } from "../utils.js";

const EFFECT_NAME = "noise";

export function registerScreenNoiseFx(runtime) {
  if (!runtime?.handlers) throw new Error("[FX Bus] screenNoiseFx: invalid runtime.");

  runtime.handlers.set("fx.noise.start", (msg) => onStart(runtime, msg));
  runtime.handlers.set("fx.noise.stop", () => onStop(runtime));
}

function normaliseParams(msg) {
  const intensity = Number.isFinite(msg.intensity) ? msg.intensity : 0.25;
  const alpha = Number.isFinite(msg.alpha) ? msg.alpha : 0.35;
  const grainPx = Number.isFinite(msg.grainPx) ? msg.grainPx : 2;
  const fps = Number.isFinite(msg.fps) ? msg.fps : 20;
  const monochrome = typeof msg.monochrome === "boolean" ? msg.monochrome : true;
  const durationMs = Number.isFinite(msg.durationMs) ? msg.durationMs : 0;
  const seed = Number.isFinite(msg.seed) ? msg.seed : 1;

  return {
    intensity: clamp(intensity, 0, 1),
    alpha: clamp(alpha, 0, 1),
    grainPx: clamp(grainPx, 1, 24),
    fps: clamp(fps, 1, 60),
    monochrome,
    durationMs: clamp(durationMs, 0, 600000),
    seed
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

function ensureNoiseFilter() {
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

    uniform vec2 uInvRes;        // (1/width, 1/height)
    uniform float uIntensity;    // 0..1
    uniform float uAlpha;        // 0..1
    uniform float uGrainPx;      // 1..24
    uniform float uFrame;        // increments at fps
    uniform float uMono;         // 1 = mono, 0 = rgb
    uniform float uSeed;         // decorrelation seed

    // Dave Hoskins-style hash: stable and cheap.
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    vec3 hash32(vec2 p) {
      float a = hash12(p +  7.1);
      float b = hash12(p + 19.7);
      float c = hash12(p + 31.3);
      return vec3(a, b, c);
    }

    void main(void) {
      vec4 base = texture2D(uSampler, vTextureCoord);

      // Pixel coords.
      vec2 px = vTextureCoord / uInvRes;

      // Grain cell coords.
      float g = max(uGrainPx, 1.0);
      vec2 cell = floor(px / g);

      // Intra-cell position (0..1). This kills the obvious “block” look.
      vec2 intra = fract(px / g);

      // Frame phase to decorrelate between frames without obvious stepping.
      // Use two close phases to avoid repeating patterns.
      float f1 = uFrame + uSeed * 13.0;
      float f2 = uFrame * 1.37 + uSeed * 71.0;

      // Base random per cell per frame.
      vec3 nCell = hash32(cell + vec2(f1, f2));

      // Additional high-frequency dither per pixel within the cell.
      vec3 nFine = hash32(px + vec2(f2, f1));

      // Mix based on intra-cell position so it isn't uniform within each cell.
      float m = clamp((intra.x + intra.y) * 0.5, 0.0, 1.0);
      vec3 n = mix(nCell, nFine, m);

      if (uMono > 0.5) {
        float g0 = (n.r + n.g + n.b) / 3.0;
        n = vec3(g0);
      }

      // Convert [0,1] -> [-1,1], apply intensity.
      vec3 centred = (n * 2.0 - 1.0) * uIntensity;

      // Add and blend.
      vec3 noisy = clamp(base.rgb + centred, 0.0, 1.0);
      vec3 outRgb = mix(base.rgb, noisy, uAlpha);

      gl_FragColor = vec4(outRgb, base.a);
    }
  `;

  const uniforms = {
    uInvRes: new Float32Array([1, 1]),
    uIntensity: 0.25,
    uAlpha: 0.35,
    uGrainPx: 2.0,
    uFrame: 0.0,
    uMono: 1.0,
    uSeed: 1.0
  };

  return new PIXI_NS.Filter(vertex, fragment, uniforms);
}

function setInvRes(filter, renderer) {
  const w = Math.max(1, renderer?.screen?.width ?? 1);
  const h = Math.max(1, renderer?.screen?.height ?? 1);
  filter.uniforms.uInvRes[0] = 1 / w;
  filter.uniforms.uInvRes[1] = 1 / h;
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

  const filter = existing?.filter ?? ensureNoiseFilter();
  if (!filter) {
    ui.notifications?.error?.("FX Bus: PIXI.Filter unavailable - cannot run screen noise.");
    return;
  }

  try {
    if (renderer?.screen) stage.filterArea = renderer.screen;
  } catch {
    // ignore
  }

  filter.padding = 4;

  setInvRes(filter, renderer);
  filter.uniforms.uIntensity = params.intensity;
  filter.uniforms.uAlpha = params.alpha;
  filter.uniforms.uGrainPx = params.grainPx;
  filter.uniforms.uMono = params.monochrome ? 1.0 : 0.0;
  filter.uniforms.uSeed = params.seed;

  applyFilterToStage(stage, filter, existing?.filter);

  setState(runtime, {
    baseFilters,
    filter,
    params,
    elapsedMs: 0,
    frameAccMs: 0,
    frameIndex: 0
  });

  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
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

  const p = state.params;

  state.elapsedMs += Math.max(0, deltaMS);
  state.frameAccMs += Math.max(0, deltaMS);

  const frameMs = 1000 / Math.max(1, p.fps);
  while (state.frameAccMs >= frameMs) {
    state.frameAccMs -= frameMs;
    state.frameIndex += 1;
  }

  setInvRes(state.filter, renderer);
  state.filter.uniforms.uFrame = state.frameIndex;

  if (p.durationMs > 0 && state.elapsedMs >= p.durationMs) {
    onStop(runtime);
  }
}
