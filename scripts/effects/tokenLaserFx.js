// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenLaserFx.js

/**
 * FX Bus - Token Laser / Token Tether FX
 *
 * Purpose:
 * - Draw persistent visual-only links between tokens.
 * - Support laser, beam, arc, rope, chain, and cable styles.
 * - Keep links procedural. No texture files. No tile documents. No scene mutation.
 * - Keep links visible independently of token visibility.
 * - Make anchors follow rendered token position, including token oscillation.
 * - Optionally draw moving packets along the path for flow/data/power effects.
 * - Provide defensive cleanup for reset recovery.
 *
 * v14-safe render model:
 * - Do not attach custom graphics to canvas.tokens or TokenLayer5e.
 * - Below-token graphics render through canvas.primary.
 * - Above-token graphics render through canvas.app.stage.
 * - Split mode draws body below tokens and highlights/packets/flares above tokens.
 * - Validate graphics and anchors every tick.
 * - Stop and clean up if token references or graphics become invalid.
 *
 * Actions:
 * - fx.tokenLaser.start
 * - fx.tokenLaser.stop
 * - fx.tokenLaser.toggle
 * - fx.tokenLaser.update
 * - fx.tokenLaser.stopAll
 * - fx.tokenLaser.hardReset
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, getTokenRenderObject } from "../utils.js";

const EFFECT_NAME = "tokenLaser";

const ACTION_START = "fx.tokenLaser.start";
const ACTION_STOP = "fx.tokenLaser.stop";
const ACTION_TOGGLE = "fx.tokenLaser.toggle";
const ACTION_UPDATE = "fx.tokenLaser.update";
const ACTION_STOP_ALL = "fx.tokenLaser.stopAll";
const ACTION_HARD_RESET = "fx.tokenLaser.hardReset";

const DEFAULTS = {
  colour: 0xff2222,
  secondaryColour: 0xffffff,
  outlineColour: 0x000000,

  width: 4,
  alpha: 0.95,
  glow: true,
  pulse: true,
  pulseSpeed: 2,
  style: "laser",
  linkMode: "network",
  layerMode: "split",

  sagPx: 0,
  segments: 24,

  twistFreq: 0.45,
  twistSpeed: 1.2,

  swayPx: 0,
  swayHz: 0.8,

  linkSpacingPx: 14,
  linkLengthPx: 16,
  linkWidthPx: 7,

  flowDirection: "none",
  flowSpeed: 1.5,
  flowCount: 3,
  flowSize: 0,
  flowColour: 0xffffff,
  durationMs: 0
};

/* -------------------------------------------- */
/* State                                        */
/* -------------------------------------------- */

function getStore(runtime) {
  /**
   * Large comment:
   * Store token laser/link state under runtime.tokenFx.
   *
   * The map is keyed by laserId rather than tokenId because one visual network
   * can connect multiple token pairs.
   */
  if (!runtime.tokenFx.has(EFFECT_NAME)) {
    runtime.tokenFx.set(EFFECT_NAME, new Map());
  }

  return runtime.tokenFx.get(EFFECT_NAME);
}

function hasActiveLasers(runtime) {
  return getStore(runtime).size > 0;
}

/* -------------------------------------------- */
/* Value coercion                               */
/* -------------------------------------------- */

function coerceString(value, fallback) {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : fallback;
}

function coerceNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, min, max);
}

function coerceBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function coerceColour(value, fallback = DEFAULTS.colour) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(clamp(value, 0x000000, 0xffffff));
  }

  if (typeof value !== "string") return fallback;

  const s = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;

  return Number.parseInt(s, 16);
}

function coerceStyle(value) {
  const s = String(value ?? DEFAULTS.style).trim();

  if (["laser", "beam", "arc", "rope", "chain", "cable"].includes(s)) {
    return s;
  }

  return DEFAULTS.style;
}

function coerceLinkMode(value) {
  const s = String(value ?? DEFAULTS.linkMode).trim();
  if (["source", "network"].includes(s)) return s;
  return DEFAULTS.linkMode;
}

function coerceLayerMode(value) {
  const s = String(value ?? DEFAULTS.layerMode).trim();
  if (["above", "below", "split"].includes(s)) return s;
  return DEFAULTS.layerMode;
}

function coerceFlowDirection(value) {
  const s = String(value ?? DEFAULTS.flowDirection).trim();

  if (["none", "forward", "reverse", "pingpong"].includes(s)) {
    return s;
  }

  return DEFAULTS.flowDirection;
}

function coerceTokenIds(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0);
}

function makeLaserId(payload) {
  const explicit = String(payload?.laserId ?? "").trim();
  if (explicit.length > 0) return explicit;

  const source = String(payload?.sourceTokenId ?? "source").trim() || "source";
  const targets = coerceTokenIds(payload?.targetTokenIds).join("-");

  return `laser-${source}-${targets || Date.now()}`;
}

function normalisePayload(payload) {
  const sourceTokenId = coerceString(payload?.sourceTokenId, "");
  const targetTokenIds = coerceTokenIds(payload?.targetTokenIds);

  return {
    laserId: makeLaserId(payload),
    sourceTokenId,
    targetTokenIds,

    colour: coerceColour(payload?.colour, DEFAULTS.colour),
    secondaryColour: coerceColour(payload?.secondaryColour, DEFAULTS.secondaryColour),
    outlineColour: coerceColour(payload?.outlineColour, DEFAULTS.outlineColour),

    width: coerceNumber(payload?.width, DEFAULTS.width, 1, 80),
    alpha: coerceNumber(payload?.alpha, DEFAULTS.alpha, 0, 1),
    glow: coerceBoolean(payload?.glow, DEFAULTS.glow),
    pulse: coerceBoolean(payload?.pulse, DEFAULTS.pulse),
    pulseSpeed: coerceNumber(payload?.pulseSpeed, DEFAULTS.pulseSpeed, 0, 20),
    style: coerceStyle(payload?.style),
    linkMode: coerceLinkMode(payload?.linkMode),
    layerMode: coerceLayerMode(payload?.layerMode),

    sagPx: coerceNumber(payload?.sagPx, DEFAULTS.sagPx, -500, 500),
    segments: Math.round(coerceNumber(payload?.segments, DEFAULTS.segments, 4, 128)),

    twistFreq: coerceNumber(payload?.twistFreq, DEFAULTS.twistFreq, 0, 10),
    twistSpeed: coerceNumber(payload?.twistSpeed, DEFAULTS.twistSpeed, -20, 20),

    swayPx: coerceNumber(payload?.swayPx, DEFAULTS.swayPx, 0, 200),
    swayHz: coerceNumber(payload?.swayHz, DEFAULTS.swayHz, 0, 20),

    linkSpacingPx: coerceNumber(payload?.linkSpacingPx, DEFAULTS.linkSpacingPx, 4, 120),
    linkLengthPx: coerceNumber(payload?.linkLengthPx, DEFAULTS.linkLengthPx, 4, 160),
    linkWidthPx: coerceNumber(payload?.linkWidthPx, DEFAULTS.linkWidthPx, 2, 120),

    flowDirection: coerceFlowDirection(payload?.flowDirection),
    flowSpeed: coerceNumber(payload?.flowSpeed, DEFAULTS.flowSpeed, 0, 20),
    flowCount: Math.round(coerceNumber(payload?.flowCount, DEFAULTS.flowCount, 1, 40)),
    flowSize: coerceNumber(payload?.flowSize, DEFAULTS.flowSize, 0, 80),
    flowColour: coerceColour(payload?.flowColour, DEFAULTS.flowColour),
    durationMs: coerceNumber(payload?.durationMs, DEFAULTS.durationMs, 0, 600000)
  };
}

/* -------------------------------------------- */
/* Token and canvas helpers                     */
/* -------------------------------------------- */

function getTokenById(tokenId) {
  if (!tokenId) return null;

  const placeables = canvas?.tokens?.placeables ?? [];

  return placeables.find((token) => {
    return token?.id === tokenId || token?.document?.id === tokenId;
  }) ?? null;
}

function getBelowLaserParent() {
  /**
   * Large comment:
   * Return the parent used for below-token laser graphics.
   *
   * Probe result:
   * - canvas.primary renders below token art.
   */
  return canvas?.primary ?? null;
}

function getAboveLaserParent() {
  /**
   * Large comment:
   * Return the parent used for above-token laser graphics.
   *
   * Probe result:
   * - canvas.app.stage renders above token art.
   *
   * Do not use canvas.tokens here. It renders above, but it was previously a
   * crash candidate because it touches TokenLayer internals.
   */
  return canvas?.app?.stage ?? null;
}

function getLaserParent() {
  /**
   * Large comment:
   * Legacy helper used for anchor conversion.
   *
   * The below graphics live in canvas.primary, so anchors are converted into
   * that scene-space parent. Above graphics use matching scene coordinates when
   * drawn into the stage overlay.
   */
  return getBelowLaserParent() ?? getAboveLaserParent();
}

function configureContainer(container, name, zIndex) {
  container.name = name;
  container.sortableChildren = true;
  container.zIndex = zIndex;
  container.interactive = false;
  container.interactiveChildren = false;

  try {
    container.eventMode = "none";
  } catch {
    // ignore
  }
}

function ensureLaserContainers() {
  /**
   * Large comment:
   * Maintain two persistent FX containers using the proven safe parent pair.
   *
   * Probe result:
   * - canvas.primary renders below token art.
   * - canvas.app.stage renders above token art.
   *
   * Therefore:
   * - below/body graphics go into canvas.primary
   * - above/highlight graphics go into canvas.app.stage
   */
  const belowParent = getBelowLaserParent();
  const aboveParent = getAboveLaserParent();

  if (!belowParent || !aboveParent) return null;

  const key = "__fxbusTokenLaserContainers";

  const existingBelow = belowParent[key]?.below;
  const existingAbove = aboveParent[key]?.above;

  if (
    existingBelow &&
    existingAbove &&
    !existingBelow.destroyed &&
    !existingAbove.destroyed
  ) {
    return {
      below: existingBelow,
      above: existingAbove
    };
  }

  try {
    belowParent.sortableChildren = true;
  } catch {
    // ignore
  }

  try {
    aboveParent.sortableChildren = true;
  } catch {
    // ignore
  }

  const below = new PIXI.Container();
  const above = new PIXI.Container();

  configureContainer(below, "FXBus.TokenLaser.BelowTokens", 10_000);
  configureContainer(above, "FXBus.TokenLaser.AboveTokens", 10_000);

  try {
    belowParent.addChild(below);
    aboveParent.addChild(above);
  } catch (err) {
    console.warn("[FX Bus] Token Laser container creation failed.", err);
    return null;
  }

  try {
    belowParent.sortChildren?.();
  } catch {
    // ignore
  }

  try {
    aboveParent.sortChildren?.();
  } catch {
    // ignore
  }

  belowParent[key] = {
    ...(belowParent[key] ?? {}),
    below
  };

  aboveParent[key] = {
    ...(aboveParent[key] ?? {}),
    above
  };

  return { below, above };
}

function destroyGraphics(graphics) {
  if (!graphics) return;

  try {
    if (graphics.destroyed) return;
  } catch {
    // ignore
  }

  try {
    if (graphics.parent) graphics.parent.removeChild(graphics);
  } catch {
    // ignore
  }

  try {
    graphics.clear?.();
  } catch {
    // ignore
  }

  try {
    graphics.destroy({ children: true });
  } catch {
    try {
      graphics.destroy();
    } catch {
      // ignore
    }
  }
}

function destroyLaserContainers() {
  /**
   * Large comment:
   * Hard-remove all persistent Token Laser containers from every parent that may
   * have been used by current or older builds.
   */
  const parents = [
    getBelowLaserParent(),
    getAboveLaserParent(),
    canvas?.primary,
    canvas?.app?.stage,
    canvas?.effects,
    canvas?.interface,
    canvas?.tokens
  ].filter((parent, index, arr) => {
    return parent && arr.indexOf(parent) === index;
  });

  const key = "__fxbusTokenLaserContainers";
  const legacyKey = "__fxbusTokenLaserContainer";

  const names = new Set([
    "FXBus.TokenLaser.Container",
    "FXBus.TokenLaser.BelowTokens",
    "FXBus.TokenLaser.AboveTokens"
  ]);

  for (const parent of parents) {
    const containers = parent[key];

    if (containers?.below) destroyGraphics(containers.below);
    if (containers?.above) destroyGraphics(containers.above);

    try {
      delete parent[key];
    } catch {
      parent[key] = null;
    }

    const legacy = parent[legacyKey];

    if (legacy) {
      destroyGraphics(legacy);

      try {
        delete parent[legacyKey];
      } catch {
        parent[legacyKey] = null;
      }
    }

    try {
      for (const child of Array.from(parent.children ?? [])) {
        if (names.has(child?.name)) {
          destroyGraphics(child);
        }
      }
    } catch {
      // ignore
    }
  }
}

function getTokenDocumentCentre(token) {
  const centre = token?.center;

  if (centre && Number.isFinite(centre.x) && Number.isFinite(centre.y)) {
    return { x: centre.x, y: centre.y };
  }

  const x = Number(token?.x ?? token?.document?.x ?? 0);
  const y = Number(token?.y ?? token?.document?.y ?? 0);
  const w = Number(token?.w ?? token?.width ?? 0);
  const h = Number(token?.h ?? token?.height ?? 0);

  return {
    x: x + w / 2,
    y: y + h / 2
  };
}

function getTokenRenderedAnchor(token) {
  /**
   * Large comment:
   * Anchor sampling uses rendered bounds first, not document coordinates.
   *
   * This allows the link to follow visual-only render transforms such as token
   * oscillation, bobbing, swaying, or other PIXI-level offsets.
   */
  if (!token) return null;

  const fallback = getTokenDocumentCentre(token);
  const obj = getTokenRenderObject(token);

  if (!obj || typeof obj.getBounds !== "function") return fallback;

  try {
    const bounds = obj.getBounds();

    if (
      !bounds ||
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      bounds.width <= 0 ||
      bounds.height <= 0
    ) {
      return fallback;
    }

    const globalCentre = new PIXI.Point(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );

    const parent = getLaserParent();

    if (parent && typeof parent.toLocal === "function") {
      const local = parent.toLocal(globalCentre);
      return { x: local.x, y: local.y };
    }

    return {
      x: globalCentre.x,
      y: globalCentre.y
    };
  } catch {
    return fallback;
  }
}

function makeLaserGraphics(name) {
  const graphics = new PIXI.Graphics();

  graphics.name = name;
  graphics.zIndex = 0;
  graphics.interactive = false;
  graphics.interactiveChildren = false;

  try {
    graphics.eventMode = "none";
  } catch {
    // ignore
  }

  return graphics;
}

/* -------------------------------------------- */
/* Geometry                                     */
/* -------------------------------------------- */

function distanceBetween(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function buildCurvePoints(from, to, state) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.001) return [from, to];

  const nx = -dy / length;
  const ny = dx / length;

  const count = Math.max(4, Math.floor(state.segments ?? DEFAULTS.segments));
  const time = state.elapsedMs / 1000;

  const points = [];

  for (let i = 0; i <= count; i += 1) {
    const t = i / count;

    const baseX = from.x + dx * t;
    const baseY = from.y + dy * t;

    const envelope = Math.sin(Math.PI * t);
    const sag = envelope * state.sagPx;

    const sway =
      Math.sin((time * state.swayHz * Math.PI * 2) + (t * Math.PI * 2)) *
      state.swayPx *
      envelope;

    points.push({
      x: baseX + nx * sway,
      y: baseY + sag + ny * sway,
      t
    });
  }

  return points;
}

function getCurveLength(points) {
  let length = 0;

  for (let i = 1; i < points.length; i += 1) {
    length += distanceBetween(points[i - 1], points[i]);
  }

  return length;
}

function sampleCurveAtT(points, t) {
  if (!Array.isArray(points) || points.length === 0) return null;
  if (points.length === 1) return points[0];

  const total = getCurveLength(points);
  if (total <= 0.001) return points[0];

  const targetDistance = clamp(t, 0, 1) * total;
  let travelled = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const segmentLength = distanceBetween(a, b);

    if (segmentLength <= 0.001) continue;

    if (travelled + segmentLength >= targetDistance) {
      const local = (targetDistance - travelled) / segmentLength;

      return {
        x: a.x + (b.x - a.x) * local,
        y: a.y + (b.y - a.y) * local
      };
    }

    travelled += segmentLength;
  }

  return points[points.length - 1];
}

/* -------------------------------------------- */
/* Drawing basics                               */
/* -------------------------------------------- */

function currentAlpha(state) {
  if (!state.pulse || state.pulseSpeed <= 0) return state.alpha;

  const seconds = state.elapsedMs / 1000;
  const wave = 0.5 + 0.5 * Math.sin(seconds * state.pulseSpeed * Math.PI * 2);

  return clamp(state.alpha * (0.65 + 0.35 * wave), 0, 1);
}

function applyLineStyle(graphics, width, colour, alpha) {
  if (!graphics || graphics.destroyed) return;

  try {
    graphics.lineStyle({
      width,
      color: colour,
      alpha,
      cap: PIXI.LINE_CAP?.ROUND,
      join: PIXI.LINE_JOIN?.ROUND
    });
  } catch {
    try {
      graphics.lineStyle(width, colour, alpha);
    } catch {
      // ignore
    }
  }
}

function beginFill(graphics, colour, alpha) {
  if (!graphics || graphics.destroyed) return;

  try {
    graphics.beginFill(colour, alpha);
  } catch {
    // ignore
  }
}

function endFill(graphics) {
  try {
    graphics?.endFill?.();
  } catch {
    // ignore
  }
}

function drawStraightLine(graphics, from, to, colour, width, alpha) {
  if (!graphics || graphics.destroyed) return;

  applyLineStyle(graphics, width, colour, alpha);

  graphics.moveTo(from.x, from.y);
  graphics.lineTo(to.x, to.y);
}

function drawPolyline(graphics, points, colour, width, alpha) {
  if (!graphics || graphics.destroyed) return;
  if (!Array.isArray(points) || points.length < 2) return;

  applyLineStyle(graphics, width, colour, alpha);

  graphics.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i += 1) {
    graphics.lineTo(points[i].x, points[i].y);
  }
}

function getBodyGraphics(state) {
  if (state.layerMode === "above") return state.aboveGraphics;
  return state.belowGraphics;
}

function getOverlayGraphics(state) {
  if (state.layerMode === "below") return state.belowGraphics;
  return state.aboveGraphics;
}

/* -------------------------------------------- */
/* Laser, beam, arc                             */
/* -------------------------------------------- */

function drawArcLine(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.001) return;

  const nx = -dy / length;
  const ny = dx / length;

  const segments = clamp(Math.ceil(length / 80), 4, 18);
  const time = state.elapsedMs / 1000;
  const amp = clamp(state.width * 2.5, 4, 28);

  applyLineStyle(graphics, Math.max(1, state.width), state.colour, alpha);

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const baseX = from.x + dx * t;
    const baseY = from.y + dy * t;

    const envelope = Math.sin(Math.PI * t);
    const wobble =
      Math.sin((t * 16.7) + (time * 11.3)) *
      Math.cos((t * 9.1) - (time * 7.7)) *
      amp *
      envelope;

    const x = baseX + nx * wobble;
    const y = baseY + ny * wobble;

    if (i === 0) graphics.moveTo(x, y);
    else graphics.lineTo(x, y);
  }
}

function drawEndpointFlare(graphics, point, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  const outerRadius = Math.max(state.width * 2.2, 6);
  const innerRadius = Math.max(state.width * 0.75, 2);

  beginFill(graphics, state.colour, alpha * 0.35);
  graphics.drawCircle(point.x, point.y, outerRadius);
  endFill(graphics);

  beginFill(graphics, state.secondaryColour, alpha * 0.75);
  graphics.drawCircle(point.x, point.y, innerRadius);
  endFill(graphics);
}

/* -------------------------------------------- */
/* Procedural rope                              */
/* -------------------------------------------- */

function drawRopeLink(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  const points = buildCurvePoints(from, to, state);
  const width = Math.max(2, state.width);

  drawPolyline(graphics, points, state.outlineColour, width + 4, alpha * 0.85);
  drawPolyline(graphics, points, state.colour, width, alpha);

  const twistSpacing = Math.max(4, width * 1.25);
  let carried = 0;
  let markIndex = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLength = Math.hypot(dx, dy);

    if (segmentLength <= 0.001) continue;

    const ux = dx / segmentLength;
    const uy = dy / segmentLength;
    const nx = -uy;
    const ny = ux;

    for (let d = twistSpacing - carried; d < segmentLength; d += twistSpacing) {
      const t = d / segmentLength;
      const x = a.x + dx * t;
      const y = a.y + dy * t;

      const slant = markIndex % 2 === 0 ? 1 : -1;
      const half = width * 0.55;
      const along = width * 0.45;

      applyLineStyle(
        graphics,
        Math.max(1, width * 0.22),
        state.secondaryColour,
        alpha * 0.75
      );

      graphics.moveTo(
        x - nx * half - ux * along * slant,
        y - ny * half - uy * along * slant
      );

      graphics.lineTo(
        x + nx * half + ux * along * slant,
        y + ny * half + uy * along * slant
      );

      markIndex += 1;
    }

    carried = (carried + segmentLength) % twistSpacing;
  }
}

/* -------------------------------------------- */
/* Procedural chain                             */
/* -------------------------------------------- */

function drawOvalStroke(graphics, transform, length, width, steps) {
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const px = Math.cos(t) * length * 0.5;
    const py = Math.sin(t) * width * 0.5;
    const p = transform(px, py);

    if (i === 0) graphics.moveTo(p.x, p.y);
    else graphics.lineTo(p.x, p.y);
  }
}

function drawProceduralChainOval(graphics, x, y, rotation, length, width, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  const steps = 14;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  function transform(px, py) {
    return {
      x: x + px * cos - py * sin,
      y: y + px * sin + py * cos
    };
  }

  applyLineStyle(
    graphics,
    Math.max(1, state.width * 0.35),
    state.outlineColour,
    alpha * 0.9
  );

  drawOvalStroke(graphics, transform, length + 3, width + 3, steps);

  applyLineStyle(
    graphics,
    Math.max(1, state.width * 0.25),
    state.colour,
    alpha
  );

  drawOvalStroke(graphics, transform, length, width, steps);

  applyLineStyle(
    graphics,
    Math.max(1, state.width * 0.12),
    state.secondaryColour,
    alpha * 0.75
  );

  drawOvalStroke(graphics, transform, length * 0.65, width * 0.55, steps);
}

function drawChainLink(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  const points = buildCurvePoints(from, to, state);
  const spacing = Math.max(4, state.linkSpacingPx);
  const linkLength = Math.max(4, state.linkLengthPx);
  const linkWidth = Math.max(2, state.linkWidthPx);

  let travelled = 0;
  let nextAt = 0;
  let index = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLength = Math.hypot(dx, dy);

    if (segmentLength <= 0.001) continue;

    while (nextAt <= travelled + segmentLength) {
      const local = (nextAt - travelled) / segmentLength;
      const x = a.x + dx * local;
      const y = a.y + dy * local;

      const tangent = Math.atan2(dy, dx);
      const rotation = tangent + (index % 2 === 0 ? 0 : Math.PI / 2);

      drawProceduralChainOval(
        graphics,
        x,
        y,
        rotation,
        linkLength,
        linkWidth,
        state,
        alpha
      );

      nextAt += spacing;
      index += 1;
    }

    travelled += segmentLength;
  }
}

/* -------------------------------------------- */
/* Procedural cable                             */
/* -------------------------------------------- */

function drawCableLink(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  const points = buildCurvePoints(from, to, state);
  const width = Math.max(2, state.width);

  drawPolyline(graphics, points, state.outlineColour, width + 5, alpha * 0.9);
  drawPolyline(graphics, points, state.colour, width, alpha);
  drawPolyline(
    graphics,
    points,
    state.secondaryColour,
    Math.max(1, width * 0.22),
    alpha * 0.65
  );

  const ribSpacing = Math.max(8, width * 2.2);
  let carried = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segmentLength = Math.hypot(dx, dy);

    if (segmentLength <= 0.001) continue;

    const ux = dx / segmentLength;
    const uy = dy / segmentLength;
    const nx = -uy;
    const ny = ux;

    for (let d = ribSpacing - carried; d < segmentLength; d += ribSpacing) {
      const t = d / segmentLength;
      const x = a.x + dx * t;
      const y = a.y + dy * t;

      applyLineStyle(
        graphics,
        Math.max(1, width * 0.14),
        state.outlineColour,
        alpha * 0.55
      );

      graphics.moveTo(
        x - nx * width * 0.55 - ux * width * 0.25,
        y - ny * width * 0.55 - uy * width * 0.25
      );

      graphics.lineTo(
        x + nx * width * 0.55 + ux * width * 0.25,
        y + ny * width * 0.55 + uy * width * 0.25
      );
    }

    carried = (carried + segmentLength) % ribSpacing;
  }
}

/* -------------------------------------------- */
/* Flow packets                                 */
/* -------------------------------------------- */

function getFlowT(state, index, count) {
  const seconds = state.elapsedMs / 1000;
  const offset = count > 0 ? index / count : 0;
  const speed = state.flowSpeed;

  if (state.flowDirection === "reverse") {
    return 1 - ((seconds * speed + offset) % 1);
  }

  if (state.flowDirection === "pingpong") {
    const raw = (seconds * speed + offset) % 2;
    return raw <= 1 ? raw : 2 - raw;
  }

  return (seconds * speed + offset) % 1;
}

function drawFlowPacketAt(graphics, point, size, colour, alpha) {
  if (!graphics || graphics.destroyed || !point) return;

  beginFill(graphics, colour, alpha * 0.35);
  graphics.drawCircle(point.x, point.y, size * 1.8);
  endFill(graphics);

  beginFill(graphics, colour, alpha * 0.95);
  graphics.drawCircle(point.x, point.y, size);
  endFill(graphics);

  beginFill(graphics, 0xffffff, alpha * 0.8);
  graphics.drawCircle(point.x, point.y, Math.max(1, size * 0.35));
  endFill(graphics);
}

function drawFlowPackets(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;
  if (state.flowDirection === "none" || state.flowSpeed <= 0) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.001) return;

  const count = Math.max(1, Math.floor(state.flowCount));
  const size = state.flowSize > 0
    ? state.flowSize
    : Math.max(2, state.width * 1.2);

  for (let i = 0; i < count; i += 1) {
    const t = getFlowT(state, i, count);

    drawFlowPacketAt(
      graphics,
      {
        x: from.x + dx * t,
        y: from.y + dy * t
      },
      size,
      state.flowColour,
      alpha
    );
  }
}

function drawFlowPacketsOnCurve(graphics, points, state, alpha) {
  if (!graphics || graphics.destroyed) return;
  if (state.flowDirection === "none" || state.flowSpeed <= 0) return;
  if (!Array.isArray(points) || points.length < 2) return;

  const count = Math.max(1, Math.floor(state.flowCount));
  const size = state.flowSize > 0
    ? state.flowSize
    : Math.max(2, state.width * 1.2);

  for (let i = 0; i < count; i += 1) {
    const t = getFlowT(state, i, count);
    const point = sampleCurveAtT(points, t);

    drawFlowPacketAt(graphics, point, size, state.flowColour, alpha);
  }
}

/* -------------------------------------------- */
/* Style routing                                */
/* -------------------------------------------- */

function drawLaserToTarget(state, from, to) {
  const alpha = currentAlpha(state);
  const body = getBodyGraphics(state);
  const overlay = getOverlayGraphics(state);

  if (state.style === "rope") {
    const curve = buildCurvePoints(from, to, state);
    drawRopeLink(body, from, to, state, alpha);
    drawFlowPacketsOnCurve(overlay, curve, state, alpha);
    return;
  }

  if (state.style === "chain") {
    const curve = buildCurvePoints(from, to, state);
    drawChainLink(body, from, to, state, alpha);
    drawFlowPacketsOnCurve(overlay, curve, state, alpha);
    return;
  }

  if (state.style === "cable") {
    const curve = buildCurvePoints(from, to, state);
    drawCableLink(body, from, to, state, alpha);
    drawFlowPacketsOnCurve(overlay, curve, state, alpha);
    return;
  }

  if (state.glow) {
    drawStraightLine(
      body,
      from,
      to,
      state.colour,
      Math.max(state.width * 4, state.width + 8),
      alpha * 0.16
    );

    drawStraightLine(
      body,
      from,
      to,
      state.colour,
      Math.max(state.width * 2, state.width + 4),
      alpha * 0.28
    );
  }

  if (state.style === "arc") {
    drawArcLine(body, from, to, state, alpha);

    drawStraightLine(
      overlay,
      from,
      to,
      state.secondaryColour,
      Math.max(1, state.width * 0.35),
      alpha * 0.75
    );

    drawFlowPackets(overlay, from, to, state, alpha);
    return;
  }

  if (state.style === "beam") {
    const bodyWidth = Math.max(state.width * 3.2, state.width + 8);
    const midWidth = Math.max(state.width * 1.8, state.width + 4);
    const coreWidth = Math.max(1, state.width * 0.65);

    drawStraightLine(body, from, to, state.colour, bodyWidth, alpha * 0.22);
    drawStraightLine(body, from, to, state.colour, midWidth, alpha * 0.45);
    drawStraightLine(overlay, from, to, state.secondaryColour, coreWidth, alpha * 0.75);

    drawEndpointFlare(overlay, from, state, alpha);
    drawEndpointFlare(overlay, to, state, alpha);
    drawFlowPackets(overlay, from, to, state, alpha);

    return;
  }

  drawStraightLine(body, from, to, state.colour, state.width, alpha);

  drawStraightLine(
    overlay,
    from,
    to,
    state.secondaryColour,
    Math.max(1, state.width * 0.25),
    alpha * 0.9
  );

  drawFlowPackets(overlay, from, to, state, alpha);
}

/* -------------------------------------------- */
/* Pairing and redraw                           */
/* -------------------------------------------- */

function getLaserPairs(state) {
  const ids = [
    state.sourceTokenId,
    ...state.targetTokenIds
  ].filter((id, index, arr) => {
    return typeof id === "string" && id.length > 0 && arr.indexOf(id) === index;
  });

  if (state.linkMode !== "network") {
    return state.targetTokenIds.map((targetTokenId) => [
      state.sourceTokenId,
      targetTokenId
    ]);
  }

  const pairs = [];

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      pairs.push([ids[i], ids[j]]);
    }
  }

  return pairs;
}

function clearLaserGraphics(state) {
  try {
    if (!state?.belowGraphics?.destroyed) state.belowGraphics?.clear?.();
  } catch {
    // ignore
  }

  try {
    if (!state?.aboveGraphics?.destroyed) state.aboveGraphics?.clear?.();
  } catch {
    // ignore
  }
}

function redrawLaser(state) {
  if (!state) return false;
  if (state.belowGraphics?.destroyed || state.aboveGraphics?.destroyed) return false;

  const pairs = getLaserPairs(state);

  clearLaserGraphics(state);

  let drawn = 0;

  for (const [fromTokenId, toTokenId] of pairs) {
    const fromToken = getTokenById(fromTokenId);
    const toToken = getTokenById(toTokenId);

    if (!fromToken || !toToken) continue;

    const fromAnchor = getTokenRenderedAnchor(fromToken);
    const toAnchor = getTokenRenderedAnchor(toToken);

    if (!fromAnchor || !toAnchor) continue;
    if (!Number.isFinite(fromAnchor.x) || !Number.isFinite(fromAnchor.y)) continue;
    if (!Number.isFinite(toAnchor.x) || !Number.isFinite(toAnchor.y)) continue;

    drawLaserToTarget(state, fromAnchor, toAnchor);
    drawn += 1;
  }

  return drawn > 0;
}

/* -------------------------------------------- */
/* Lifecycle                                    */
/* -------------------------------------------- */

function stopLaser(runtime, laserId) {
  const store = getStore(runtime);
  const id = String(laserId ?? "").trim();

  if (!id) return;

  const state = store.get(id);
  if (!state) return;

  destroyGraphics(state.belowGraphics);
  destroyGraphics(state.aboveGraphics);
  store.delete(id);

  if (!hasActiveLasers(runtime)) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

function stopAllLasers(runtime) {
  const store = getStore(runtime);

  for (const state of store.values()) {
    destroyGraphics(state.belowGraphics);
    destroyGraphics(state.aboveGraphics);
  }

  store.clear();
  cleanupTicker(runtime, EFFECT_NAME);
}

function hardResetLasers(runtime) {
  try {
    stopAllLasers(runtime);
  } catch (err) {
    console.warn("[FX Bus] Token Laser hard reset: stopAll failed", err);
  }

  try {
    destroyLaserContainers();
  } catch (err) {
    console.warn("[FX Bus] Token Laser hard reset: container cleanup failed", err);
  }

  try {
    cleanupTicker(runtime, EFFECT_NAME);
  } catch {
    // ignore
  }

  try {
    runtime?.tokenFx?.delete?.(EFFECT_NAME);
  } catch {
    // ignore
  }
}

function startTicker(runtime) {
  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => {
    const store = getStore(runtime);
    const toStop = [];

    for (const [laserId, state] of store.entries()) {
      state.elapsedMs += deltaMS;

      if (state.durationMs > 0 && state.elapsedMs >= state.durationMs) {
        toStop.push(laserId);
        continue;
      }

      const ok = redrawLaser(state);

      if (!ok) {
        toStop.push(laserId);
      }
    }

    for (const laserId of toStop) {
      stopLaser(runtime, laserId);
    }

    if (!hasActiveLasers(runtime)) {
      cleanupTicker(runtime, EFFECT_NAME);
    }
  });
}

function startLaser(runtime, payload) {
  const data = normalisePayload(payload);

  if (!data.sourceTokenId) {
    console.warn("[FX Bus] Token Laser start ignored: missing sourceTokenId.", payload);
    return;
  }

  if (data.targetTokenIds.length === 0) {
    console.warn("[FX Bus] Token Laser start ignored: missing targetTokenIds.", payload);
    return;
  }

  const containers = ensureLaserContainers();

  if (!containers) {
    console.warn("[FX Bus] Token Laser start ignored: no laser containers available.");
    return;
  }

  const store = getStore(runtime);

  if (store.has(data.laserId)) {
    stopLaser(runtime, data.laserId);
  }

  const belowGraphics = makeLaserGraphics(`FXBus.TokenLaser.${data.laserId}.Below`);
  const aboveGraphics = makeLaserGraphics(`FXBus.TokenLaser.${data.laserId}.Above`);

  containers.below.addChild(belowGraphics);
  containers.above.addChild(aboveGraphics);

  const state = {
    ...data,
    belowGraphics,
    aboveGraphics,
    elapsedMs: 0
  };

  store.set(data.laserId, state);

  redrawLaser(state);
  startTicker(runtime);
}

function updateLaser(runtime, payload) {
  const store = getStore(runtime);
  const laserId = String(payload?.laserId ?? "").trim();

  if (!laserId || !store.has(laserId)) {
    startLaser(runtime, payload);
    return;
  }

  const existing = store.get(laserId);
  const data = normalisePayload({
    ...existing,
    ...payload,
    laserId
  });

  existing.sourceTokenId = data.sourceTokenId;
  existing.targetTokenIds = data.targetTokenIds;

  existing.colour = data.colour;
  existing.secondaryColour = data.secondaryColour;
  existing.outlineColour = data.outlineColour;

  existing.width = data.width;
  existing.alpha = data.alpha;
  existing.glow = data.glow;
  existing.pulse = data.pulse;
  existing.pulseSpeed = data.pulseSpeed;
  existing.style = data.style;
  existing.linkMode = data.linkMode;
  existing.layerMode = data.layerMode;

  existing.sagPx = data.sagPx;
  existing.segments = data.segments;
  existing.twistFreq = data.twistFreq;
  existing.twistSpeed = data.twistSpeed;
  existing.swayPx = data.swayPx;
  existing.swayHz = data.swayHz;
  existing.linkSpacingPx = data.linkSpacingPx;
  existing.linkLengthPx = data.linkLengthPx;
  existing.linkWidthPx = data.linkWidthPx;

  existing.flowDirection = data.flowDirection;
  existing.flowSpeed = data.flowSpeed;
  existing.flowCount = data.flowCount;
  existing.flowSize = data.flowSize;
  existing.flowColour = data.flowColour;
  existing.durationMs = data.durationMs;

  redrawLaser(existing);
  startTicker(runtime);
}

function toggleLaser(runtime, payload) {
  const laserId = makeLaserId(payload);
  const store = getStore(runtime);

  if (store.has(laserId)) {
    stopLaser(runtime, laserId);
    return;
  }

  startLaser(runtime, {
    ...payload,
    laserId
  });
}

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerTokenLaserFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] registerTokenLaserFx: invalid runtime.");
  }

  runtime.handlers.set(ACTION_START, (payload) => {
    startLaser(runtime, payload);
  });

  runtime.handlers.set(ACTION_STOP, (payload) => {
    stopLaser(runtime, payload?.laserId);
  });

  runtime.handlers.set(ACTION_TOGGLE, (payload) => {
    toggleLaser(runtime, payload);
  });

  runtime.handlers.set(ACTION_UPDATE, (payload) => {
    updateLaser(runtime, payload);
  });

  runtime.handlers.set(ACTION_STOP_ALL, () => {
    stopAllLasers(runtime);
  });

  runtime.handlers.set(ACTION_HARD_RESET, () => {
    hardResetLasers(runtime);
  });
}