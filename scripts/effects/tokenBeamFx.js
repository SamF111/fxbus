// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenBeamFx.js

/**
 * FX Bus - Token Beam FX
 *
 * Purpose:
 * - Draw persistent visual-only power beams originating from tokens.
 * - Support single-token beams, beams from all selected tokens, and beams from
 *   selected token[0] towards the rest of the selected tokens.
 * - Support continuous beams and projectile-style travelling beam segments.
 * - Keep the effect procedural. No texture files. No tile documents. No scene mutation.
 * - Follow rendered token position, including token oscillation or other PIXI-level motion.
 *
 * Actions:
 * - fx.tokenBeam.start
 * - fx.tokenBeam.stop
 * - fx.tokenBeam.update
 * - fx.tokenBeam.stopAll
 * - fx.tokenBeam.hardReset
 *
 * Payload targeting:
 * - Single beam:
 *   {
 *     action: "fx.tokenBeam.start",
 *     sourceTokenId: "...",
 *     angleDeg: 0
 *   }
 *
 * - Apply to all selected tokens:
 *   {
 *     action: "fx.tokenBeam.start",
 *     selectionMode: "all",
 *     tokenIds: ["a", "b", "c"]
 *   }
 *
 * - First selected token aims towards the rest:
 *   {
 *     action: "fx.tokenBeam.start",
 *     selectionMode: "firstToRest",
 *     tokenIds: ["source", "target1", "target2"]
 *   }
 *
 * - Projectile mode:
 *   {
 *     action: "fx.tokenBeam.start",
 *     sourceTokenId: "...",
 *     beamMode: "projectile",
 *     projectileSpeedPx: 1200,
 *     projectileTrailPx: 220
 *   }
 *
 * Runtime model:
 * - State is stored under runtime.tokenFx.get("tokenBeam").
 * - One ticker redraws all active beams.
 * - Stop removes graphics and ticker state.
 * - Hard reset also destroys persistent containers.
 */

import { ensureTicker, cleanupTicker } from "../ticker.js";
import { clamp, getTokenRenderObject } from "../utils.js";

const EFFECT_NAME = "tokenBeam";

const ACTION_START = "fx.tokenBeam.start";
const ACTION_STOP = "fx.tokenBeam.stop";
const ACTION_UPDATE = "fx.tokenBeam.update";
const ACTION_STOP_ALL = "fx.tokenBeam.stopAll";
const ACTION_HARD_RESET = "fx.tokenBeam.hardReset";

let projectileSequence = 0;

const DEFAULTS = {
  colour: 0xff2222,
  coreColour: 0xffffff,
  glowColour: 0xff2222,

  width: 14,
  coreWidth: 4,
  alpha: 0.95,

  lengthPx: 900,
  startOffsetPx: 0,
  endOffsetPx: 0,

  angleDeg: 0,
  angleMode: "absolute",

  selectionMode: "single",
  targetLengthMode: "direction",
  trackTarget: true,
  replaceForSource: false,

  beamMode: "continuous",

  projectileSpeedPx: 1200,
  projectileTrailPx: 220,
  projectileImpactLingerMs: 180,
  projectileFireAndForget: true,
  projectileStopOnImpact: true,

  layerMode: "split",

  glow: true,
  pulse: true,
  pulseSpeed: 2.5,

  edgeNoisePx: 4,
  edgeNoiseHz: 18,
  edgeSegments: 16,

  flow: true,
  flowSpeed: 2,
  flowCount: 7,
  flowSize: 0,
  flowColour: 0xffffff,

  muzzleFlare: true,
  impactFlare: true,

  durationMs: 0
};

/* -------------------------------------------- */
/* State                                        */
/* -------------------------------------------- */

function getStore(runtime) {
  /**
   * Large comment:
   * Store Token Beam state under runtime.tokenFx.
   *
   * The map is keyed by beamId because one source token may legitimately emit
   * several beams when token[0] is aimed towards multiple selected targets.
   */
  if (!runtime.tokenFx.has(EFFECT_NAME)) {
    runtime.tokenFx.set(EFFECT_NAME, new Map());
  }

  return runtime.tokenFx.get(EFFECT_NAME);
}

function hasActiveBeams(runtime) {
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

function coerceInteger(value, fallback, min, max) {
  return Math.round(coerceNumber(value, fallback, min, max));
}

function coerceBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function coerceColour(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(clamp(value, 0x000000, 0xffffff));
  }

  if (typeof value !== "string") return fallback;

  const s = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return fallback;

  return Number.parseInt(s, 16);
}

function coerceTokenIds(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0);
}

function coerceSelectionMode(value) {
  const s = String(value ?? DEFAULTS.selectionMode).trim();

  if (["single", "all", "firstToRest"].includes(s)) return s;

  if (s === "firstToTargets") return "firstToRest";
  if (s === "sourceToTargets") return "firstToRest";

  return DEFAULTS.selectionMode;
}

function coerceAngleMode(value) {
  const s = String(value ?? DEFAULTS.angleMode).trim();

  if (["absolute", "tokenRotationOffset"].includes(s)) return s;

  return DEFAULTS.angleMode;
}

function coerceLayerMode(value) {
  const s = String(value ?? DEFAULTS.layerMode).trim();

  if (["above", "below", "split"].includes(s)) return s;

  return DEFAULTS.layerMode;
}

function coerceTargetLengthMode(value) {
  const s = String(value ?? DEFAULTS.targetLengthMode).trim();

  if (["direction", "endpoint"].includes(s)) return s;

  return DEFAULTS.targetLengthMode;
}

function coerceBeamMode(value) {
  const s = String(value ?? DEFAULTS.beamMode).trim();

  if (["continuous", "projectile"].includes(s)) return s;

  return DEFAULTS.beamMode;
}

function getBaseBeamOptions(payload) {
  const colour = coerceColour(payload?.colour, DEFAULTS.colour);

  return {
    colour,
    coreColour: coerceColour(payload?.coreColour, DEFAULTS.coreColour),
    glowColour: coerceColour(payload?.glowColour, colour),

    width: coerceNumber(payload?.width, DEFAULTS.width, 1, 120),
    coreWidth: coerceNumber(payload?.coreWidth, DEFAULTS.coreWidth, 0.5, 80),
    alpha: coerceNumber(payload?.alpha, DEFAULTS.alpha, 0, 1),

    lengthPx: coerceNumber(payload?.lengthPx, DEFAULTS.lengthPx, 1, 10000),
    startOffsetPx: coerceNumber(payload?.startOffsetPx, DEFAULTS.startOffsetPx, 0, 1000),
    endOffsetPx: coerceNumber(payload?.endOffsetPx, DEFAULTS.endOffsetPx, 0, 1000),

    angleDeg: coerceNumber(payload?.angleDeg, DEFAULTS.angleDeg, -36000, 36000),
    angleMode: coerceAngleMode(payload?.angleMode),

    targetLengthMode: coerceTargetLengthMode(payload?.targetLengthMode),
    trackTarget: coerceBoolean(payload?.trackTarget, DEFAULTS.trackTarget),

    beamMode: coerceBeamMode(payload?.beamMode),

    projectileSpeedPx: coerceNumber(
      payload?.projectileSpeedPx,
      DEFAULTS.projectileSpeedPx,
      1,
      20000
    ),
    projectileTrailPx: coerceNumber(
      payload?.projectileTrailPx,
      DEFAULTS.projectileTrailPx,
      1,
      10000
    ),
    projectileImpactLingerMs: coerceNumber(
      payload?.projectileImpactLingerMs,
      DEFAULTS.projectileImpactLingerMs,
      0,
      10000
    ),
    projectileFireAndForget: coerceBoolean(
      payload?.projectileFireAndForget,
      DEFAULTS.projectileFireAndForget
    ),
    projectileStopOnImpact: coerceBoolean(
      payload?.projectileStopOnImpact,
      DEFAULTS.projectileStopOnImpact
    ),

    layerMode: coerceLayerMode(payload?.layerMode),

    glow: coerceBoolean(payload?.glow, DEFAULTS.glow),
    pulse: coerceBoolean(payload?.pulse, DEFAULTS.pulse),
    pulseSpeed: coerceNumber(payload?.pulseSpeed, DEFAULTS.pulseSpeed, 0, 30),

    edgeNoisePx: coerceNumber(payload?.edgeNoisePx, DEFAULTS.edgeNoisePx, 0, 100),
    edgeNoiseHz: coerceNumber(payload?.edgeNoiseHz, DEFAULTS.edgeNoiseHz, 0, 80),
    edgeSegments: coerceInteger(payload?.edgeSegments, DEFAULTS.edgeSegments, 2, 96),

    flow: coerceBoolean(payload?.flow, DEFAULTS.flow),
    flowSpeed: coerceNumber(payload?.flowSpeed, DEFAULTS.flowSpeed, -30, 30),
    flowCount: coerceInteger(payload?.flowCount, DEFAULTS.flowCount, 0, 80),
    flowSize: coerceNumber(payload?.flowSize, DEFAULTS.flowSize, 0, 100),
    flowColour: coerceColour(payload?.flowColour, DEFAULTS.flowColour),

    muzzleFlare: coerceBoolean(payload?.muzzleFlare, DEFAULTS.muzzleFlare),
    impactFlare: coerceBoolean(payload?.impactFlare, DEFAULTS.impactFlare),

    durationMs: coerceNumber(payload?.durationMs, DEFAULTS.durationMs, 0, 600000)
  };
}

function makeProjectileBeamId(sourceTokenId, targetTokenId) {
  projectileSequence += 1;

  const source = String(sourceTokenId ?? "source").trim() || "source";
  const target = String(targetTokenId ?? "").trim() || "shot";
  const now = Date.now();

  return `tokenBeamProjectile-${source}-${target}-${now}-${projectileSequence}`;
}

function makeBeamId(sourceTokenId, targetTokenId, explicit, beamMode) {
  const forced = String(explicit ?? "").trim();
  if (forced.length > 0) return forced;

  if (beamMode === "projectile") {
    return makeProjectileBeamId(sourceTokenId, targetTokenId);
  }

  const source = String(sourceTokenId ?? "source").trim() || "source";
  const target = String(targetTokenId ?? "").trim();

  if (target.length > 0) return `tokenBeam-${source}-${target}`;

  return `tokenBeam-${source}`;
}

function normaliseBeamDef(raw, baseOptions) {
  const sourceTokenId = coerceString(raw?.sourceTokenId, "");
  const targetTokenId = coerceString(raw?.targetTokenId, "");

  if (!sourceTokenId) return null;

  const beamMode = coerceBeamMode(raw?.beamMode ?? baseOptions.beamMode);

  return {
    ...baseOptions,

    beamMode,

    beamId: makeBeamId(sourceTokenId, targetTokenId, raw?.beamId, beamMode),
    sourceTokenId,
    targetTokenId,

    angleDeg: coerceNumber(raw?.angleDeg, baseOptions.angleDeg, -36000, 36000),
    angleMode: coerceAngleMode(raw?.angleMode ?? baseOptions.angleMode),

    lengthPx: coerceNumber(raw?.lengthPx, baseOptions.lengthPx, 1, 10000),
    targetLengthMode: coerceTargetLengthMode(raw?.targetLengthMode ?? baseOptions.targetLengthMode),
    trackTarget: coerceBoolean(raw?.trackTarget, baseOptions.trackTarget),

    projectileSpeedPx: coerceNumber(
      raw?.projectileSpeedPx,
      baseOptions.projectileSpeedPx,
      1,
      20000
    ),
    projectileTrailPx: coerceNumber(
      raw?.projectileTrailPx,
      baseOptions.projectileTrailPx,
      1,
      10000
    ),
    projectileImpactLingerMs: coerceNumber(
      raw?.projectileImpactLingerMs,
      baseOptions.projectileImpactLingerMs,
      0,
      10000
    ),
    projectileFireAndForget: coerceBoolean(
      raw?.projectileFireAndForget,
      baseOptions.projectileFireAndForget
    ),
    projectileStopOnImpact: coerceBoolean(
      raw?.projectileStopOnImpact,
      baseOptions.projectileStopOnImpact
    )
  };
}

function normalisePayload(payload) {
  const baseOptions = getBaseBeamOptions(payload);
  const selectionMode = coerceSelectionMode(payload?.selectionMode);
  const tokenIds = coerceTokenIds(payload?.tokenIds);
  const explicitBeams = Array.isArray(payload?.beams) ? payload.beams : [];

  const defs = [];
  const replaceSourceTokenIds = new Set();
  const explicitReplace = coerceBoolean(payload?.replaceForSource, DEFAULTS.replaceForSource);

  if (explicitBeams.length > 0) {
    for (const raw of explicitBeams) {
      const def = normaliseBeamDef(raw, baseOptions);
      if (def) defs.push(def);
    }

    if (explicitReplace) {
      for (const def of defs) replaceSourceTokenIds.add(def.sourceTokenId);
    }

    return { defs, replaceSourceTokenIds };
  }

  if (selectionMode === "all") {
    for (const tokenId of tokenIds) {
      defs.push({
        ...baseOptions,
        beamId: makeBeamId(tokenId, "", payload?.beamId, baseOptions.beamMode),
        sourceTokenId: tokenId,
        targetTokenId: ""
      });
    }

    if (explicitReplace) {
      for (const tokenId of tokenIds) replaceSourceTokenIds.add(tokenId);
    }

    return { defs, replaceSourceTokenIds };
  }

  if (selectionMode === "firstToRest") {
    const sourceTokenId = tokenIds[0] ?? "";
    const targetTokenIds = tokenIds.slice(1);

    for (const targetTokenId of targetTokenIds) {
      defs.push({
        ...baseOptions,
        beamId: makeBeamId(sourceTokenId, targetTokenId, null, baseOptions.beamMode),
        sourceTokenId,
        targetTokenId,
        targetLengthMode: coerceTargetLengthMode(payload?.targetLengthMode ?? "direction"),
        trackTarget: coerceBoolean(payload?.trackTarget, true)
      });
    }

    if (sourceTokenId && (baseOptions.beamMode !== "projectile" || explicitReplace)) {
      replaceSourceTokenIds.add(sourceTokenId);
    }

    return { defs, replaceSourceTokenIds };
  }

  const sourceTokenId =
    coerceString(payload?.sourceTokenId, "") ||
    tokenIds[0] ||
    "";

  const targetTokenId = coerceString(payload?.targetTokenId, "");

  const direct = normaliseBeamDef(
    {
      beamId: payload?.beamId,
      sourceTokenId,
      targetTokenId,
      beamMode: payload?.beamMode,
      angleDeg: payload?.angleDeg,
      angleMode: payload?.angleMode,
      lengthPx: payload?.lengthPx,
      targetLengthMode: payload?.targetLengthMode,
      trackTarget: payload?.trackTarget,
      projectileSpeedPx: payload?.projectileSpeedPx,
      projectileTrailPx: payload?.projectileTrailPx,
      projectileImpactLingerMs: payload?.projectileImpactLingerMs,
      projectileFireAndForget: payload?.projectileFireAndForget,
      projectileStopOnImpact: payload?.projectileStopOnImpact
    },
    baseOptions
  );

  if (direct) defs.push(direct);

  if (explicitReplace && sourceTokenId) {
    replaceSourceTokenIds.add(sourceTokenId);
  }

  return { defs, replaceSourceTokenIds };
}

/* -------------------------------------------- */
/* Token and coordinate helpers                 */
/* -------------------------------------------- */

function getTokenById(tokenId) {
  if (!tokenId) return null;

  const placeables = canvas?.tokens?.placeables ?? [];

  return placeables.find((token) => {
    return token?.id === tokenId || token?.document?.id === tokenId;
  }) ?? null;
}

function getBelowBeamParent() {
  return canvas?.primary ?? null;
}

function getAboveBeamParent() {
  return canvas?.app?.stage ?? null;
}

function getSceneCoordinateParent() {
  return getBelowBeamParent() ?? canvas?.primary ?? canvas?.app?.stage ?? null;
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

function cloneScenePoint(point) {
  return {
    x: Number(point?.x ?? 0),
    y: Number(point?.y ?? 0)
  };
}

function getTokenRenderedSceneAnchor(token) {
  /**
   * Large comment:
   * Sample rendered token bounds, then convert that rendered global centre back
   * into scene coordinates.
   *
   * This lets beams follow visual-only token render motion, including token
   * oscillation, without mutating token documents.
   */
  if (!token) return null;

  const fallback = getTokenDocumentCentre(token);
  const obj = getTokenRenderObject(token);
  const sceneParent = getSceneCoordinateParent();

  if (!obj || typeof obj.getBounds !== "function" || !sceneParent?.toLocal) {
    return fallback;
  }

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

    const scene = sceneParent.toLocal(globalCentre);

    if (!Number.isFinite(scene.x) || !Number.isFinite(scene.y)) return fallback;

    return { x: scene.x, y: scene.y };
  } catch {
    return fallback;
  }
}

function scenePointToParentLocal(parent, scenePoint) {
  if (!parent || !scenePoint) return null;

  const sceneParent = getSceneCoordinateParent();

  if (!sceneParent?.toGlobal || !parent?.toLocal) {
    return { x: scenePoint.x, y: scenePoint.y };
  }

  try {
    const globalPoint = sceneParent.toGlobal(new PIXI.Point(scenePoint.x, scenePoint.y));
    const localPoint = parent.toLocal(globalPoint);

    return {
      x: localPoint.x,
      y: localPoint.y
    };
  } catch {
    return {
      x: scenePoint.x,
      y: scenePoint.y
    };
  }
}

function getTokenRotationDeg(token) {
  const candidates = [
    token?.document?.rotation,
    token?.rotation
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  return 0;
}

/* -------------------------------------------- */
/* Containers and graphics                      */
/* -------------------------------------------- */

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

function isLiveDisplayObject(obj) {
  if (!obj) return false;

  try {
    return obj.destroyed !== true;
  } catch {
    return false;
  }
}

function ensureBeamContainers() {
  const belowParent = getBelowBeamParent();
  const aboveParent = getAboveBeamParent();

  if (!belowParent || !aboveParent) return null;

  const key = "__fxbusTokenBeamContainers";

  let below = belowParent[key]?.below;
  let above = aboveParent[key]?.above;

  if (!isLiveDisplayObject(below)) {
    below = new PIXI.Container();
    configureContainer(below, "FXBus.TokenBeam.BelowTokens", 10_000);

    try {
      belowParent.sortableChildren = true;
      belowParent.addChild(below);
      belowParent.sortChildren?.();
    } catch (err) {
      console.warn("[FX Bus] Token Beam below container creation failed.", err);
      return null;
    }

    belowParent[key] = {
      ...(belowParent[key] ?? {}),
      below
    };
  }

  if (!isLiveDisplayObject(above)) {
    above = new PIXI.Container();
    configureContainer(above, "FXBus.TokenBeam.AboveTokens", 10_000);

    try {
      aboveParent.sortableChildren = true;
      aboveParent.addChild(above);
      aboveParent.sortChildren?.();
    } catch (err) {
      console.warn("[FX Bus] Token Beam above container creation failed.", err);
      return null;
    }

    aboveParent[key] = {
      ...(aboveParent[key] ?? {}),
      above
    };
  }

  return { below, above };
}

function makeBeamGraphics(name) {
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

function destroyBeamContainers() {
  const parents = [
    getBelowBeamParent(),
    getAboveBeamParent(),
    canvas?.primary,
    canvas?.app?.stage,
    canvas?.effects,
    canvas?.interface,
    canvas?.tokens
  ].filter((parent, index, arr) => {
    return parent && arr.indexOf(parent) === index;
  });

  const key = "__fxbusTokenBeamContainers";
  const names = new Set([
    "FXBus.TokenBeam.BelowTokens",
    "FXBus.TokenBeam.AboveTokens"
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

function clearBeamGraphics(state) {
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

/* -------------------------------------------- */
/* Drawing basics                               */
/* -------------------------------------------- */

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
  try {
    graphics?.beginFill?.(colour, alpha);
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

function drawCircle(graphics, x, y, radius, colour, alpha) {
  if (!graphics || graphics.destroyed) return;
  if (!Number.isFinite(radius) || radius <= 0) return;

  beginFill(graphics, colour, alpha);
  graphics.drawCircle(x, y, radius);
  endFill(graphics);
}

function drawLine(graphics, from, to, colour, width, alpha) {
  if (!graphics || graphics.destroyed) return;
  if (!from || !to) return;

  applyLineStyle(graphics, width, colour, alpha);
  graphics.moveTo(from.x, from.y);
  graphics.lineTo(to.x, to.y);
}

function currentAlpha(state) {
  if (!state.pulse || state.pulseSpeed <= 0) return state.alpha;

  const seconds = state.elapsedMs / 1000;
  const wave = 0.5 + 0.5 * Math.sin(seconds * state.pulseSpeed * Math.PI * 2);

  return clamp(state.alpha * (0.72 + 0.28 * wave), 0, 1);
}

function hashString(value) {
  const s = String(value ?? "");
  let h = 2166136261;

  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (h >>> 0) / 4294967295;
}

function drawJitterLine(graphics, from, to, state, colour, width, alpha, phaseOffset) {
  if (!graphics || graphics.destroyed) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.001) return;

  const nx = -dy / length;
  const ny = dx / length;

  const count = Math.max(2, state.edgeSegments);
  const seconds = state.elapsedMs / 1000;
  const amp = state.edgeNoisePx;

  applyLineStyle(graphics, width, colour, alpha);

  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    const envelope = Math.sin(Math.PI * t);

    const waveA = Math.sin(
      seconds * state.edgeNoiseHz +
      t * 23.17 +
      state.phase * 17.91 +
      phaseOffset
    );

    const waveB = Math.cos(
      seconds * state.edgeNoiseHz * 0.73 -
      t * 31.43 +
      state.phase * 9.37 -
      phaseOffset
    );

    const offset = (waveA * 0.65 + waveB * 0.35) * amp * envelope;

    const x = from.x + dx * t + nx * offset;
    const y = from.y + dy * t + ny * offset;

    if (i === 0) graphics.moveTo(x, y);
    else graphics.lineTo(x, y);
  }
}

function drawFlare(graphics, point, state, alpha, multiplier = 1) {
  if (!graphics || graphics.destroyed || !point) return;

  const outer = Math.max(state.width * 1.8 * multiplier, 8);
  const mid = Math.max(state.width * 0.9 * multiplier, 4);
  const core = Math.max(state.coreWidth * 0.9 * multiplier, 2);

  drawCircle(graphics, point.x, point.y, outer, state.glowColour, alpha * 0.18);
  drawCircle(graphics, point.x, point.y, mid, state.colour, alpha * 0.38);
  drawCircle(graphics, point.x, point.y, core, state.coreColour, alpha * 0.8);
}

function drawFlowPackets(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;
  if (!state.flow || state.flowCount <= 0 || state.flowSpeed === 0) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.001) return;

  const nx = -dy / length;
  const ny = dx / length;

  const seconds = state.elapsedMs / 1000;
  const size = state.flowSize > 0
    ? state.flowSize
    : Math.max(2, state.coreWidth * 0.9);

  for (let i = 0; i < state.flowCount; i += 1) {
    const base = i / Math.max(1, state.flowCount);
    const t = ((seconds * state.flowSpeed + base) % 1 + 1) % 1;

    const x = from.x + dx * t;
    const y = from.y + dy * t;

    drawCircle(graphics, x, y, size * 2.2, state.flowColour, alpha * 0.16);
    drawCircle(graphics, x, y, size, state.flowColour, alpha * 0.8);

    applyLineStyle(graphics, Math.max(1, size * 0.4), state.flowColour, alpha * 0.55);
    graphics.moveTo(x - nx * size * 2.2, y - ny * size * 2.2);
    graphics.lineTo(x + nx * size * 2.2, y + ny * size * 2.2);
  }
}

function drawBeamBody(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  if (state.glow) {
    drawLine(
      graphics,
      from,
      to,
      state.glowColour,
      Math.max(state.width * 4.4, state.width + 18),
      alpha * 0.12
    );

    drawLine(
      graphics,
      from,
      to,
      state.glowColour,
      Math.max(state.width * 2.6, state.width + 10),
      alpha * 0.2
    );
  }

  drawLine(
    graphics,
    from,
    to,
    state.colour,
    Math.max(1, state.width),
    alpha * 0.72
  );

  if (state.edgeNoisePx > 0 && state.edgeNoiseHz > 0) {
    drawJitterLine(
      graphics,
      from,
      to,
      state,
      state.colour,
      Math.max(1, state.width * 0.45),
      alpha * 0.65,
      0
    );

    drawJitterLine(
      graphics,
      from,
      to,
      state,
      state.coreColour,
      Math.max(1, state.coreWidth * 0.75),
      alpha * 0.55,
      Math.PI
    );
  }
}

function drawBeamOverlay(graphics, from, to, state, alpha) {
  if (!graphics || graphics.destroyed) return;

  drawLine(
    graphics,
    from,
    to,
    state.coreColour,
    Math.max(1, state.coreWidth),
    alpha * 0.92
  );

  drawLine(
    graphics,
    from,
    to,
    0xffffff,
    Math.max(1, state.coreWidth * 0.35),
    alpha * 0.85
  );

  drawFlowPackets(graphics, from, to, state, alpha);

  if (state.beamMode !== "projectile" && state.muzzleFlare) {
    drawFlare(graphics, from, state, alpha, 1.05);
  }

  if (state.impactFlare) {
    const multiplier = state.beamMode === "projectile" ? 1.15 : 0.9;
    drawFlare(graphics, to, state, alpha, multiplier);
  }
}

/* -------------------------------------------- */
/* Beam endpoint resolution                     */
/* -------------------------------------------- */

function resolveAngleRad(state, sourceToken, sourceScene, targetScene) {
  /**
   * Large comment:
   * Resolve the beam angle every redraw.
   *
   * Important:
   * - Target-tracked beams must keep aiming at their current target position.
   * - Token-rotation beams must re-read token.document.rotation every tick.
   * - Only target-tracked beams cache a last valid angle as a defensive fallback.
   *
   * Do not cache the angle for ordinary tokenRotationOffset beams, otherwise a
   * live beam will not follow token rotation changes.
   */
  if (targetScene && state.trackTarget) {
    const dx = targetScene.x - sourceScene.x;
    const dy = targetScene.y - sourceScene.y;

    if (Math.hypot(dx, dy) > 0.001) {
      const angle = Math.atan2(dy, dx);
      state.lastAngleRad = angle;
      return angle;
    }

    if (Number.isFinite(state.lastAngleRad)) return state.lastAngleRad;
  }

  let angleDeg = state.angleDeg;

  if (state.angleMode === "tokenRotationOffset") {
    /**
     * Large comment:
     * Foundry token rotation is document rotation in degrees. FX Bus beam maths
     * uses canvas angles:
     *
     * - 0 degrees points right
     * - 90 degrees points down
     * - 180 degrees points left
     * - 270 degrees points up
     *
     * The -90 correction treats an unrotated token as visually facing upward,
     * which matches the normal top-down token convention. Use angleDeg as a
     * user-facing offset if a particular token's art points a different way.
     */
    angleDeg = getTokenRotationDeg(sourceToken) + state.angleDeg - 90;
  }

  const angle = (angleDeg * Math.PI) / 180;

  state.lastAngleRad = angle;

  return angle;
}

function resolveBeamLengthPx(state, sourceScene, targetScene) {
  /**
   * Large comment:
   * Resolve beam length without turning Token Beam into Token Tether.
   *
   * Behaviour:
   * - direction mode: always use the configured maximum length.
   * - endpoint mode:
   *   - if the tracked target is closer than lengthPx, stop at the target.
   *   - if the tracked target is farther than lengthPx, stop at lengthPx.
   *
   * In other words, endpoint mode caps the beam at the target, but the beam
   * still has a maximum range.
   */
  const configuredLengthPx = Math.max(1, Number(state.lengthPx) || DEFAULTS.lengthPx);

  if (!targetScene || state.targetLengthMode !== "endpoint") {
    return configuredLengthPx;
  }

  const targetDistancePx = Math.hypot(
    targetScene.x - sourceScene.x,
    targetScene.y - sourceScene.y
  );

  if (!Number.isFinite(targetDistancePx) || targetDistancePx <= 0) {
    return configuredLengthPx;
  }

  return Math.min(configuredLengthPx, targetDistancePx);
}

function resolveLiveBeamSceneEndpoints(state) {
  const sourceToken = getTokenById(state.sourceTokenId);
  if (!sourceToken) return null;

  const sourceScene = getTokenRenderedSceneAnchor(sourceToken);
  if (!sourceScene) return null;

  const targetToken = state.targetTokenId ? getTokenById(state.targetTokenId) : null;
  const targetScene = targetToken ? getTokenRenderedSceneAnchor(targetToken) : null;

  const angleRad = resolveAngleRad(state, sourceToken, sourceScene, targetScene);

  const ux = Math.cos(angleRad);
  const uy = Math.sin(angleRad);

  const lengthPx = resolveBeamLengthPx(state, sourceScene, targetScene);

  const start = Math.max(0, state.startOffsetPx);
  const end = Math.max(start + 1, lengthPx - state.endOffsetPx);

  return {
    fromScene: {
      x: sourceScene.x + ux * start,
      y: sourceScene.y + uy * start
    },
    toScene: {
      x: sourceScene.x + ux * end,
      y: sourceScene.y + uy * end
    }
  };
}

function getFullBeamLengthPx(endpoints) {
  if (!endpoints?.fromScene || !endpoints?.toScene) return 0;

  return Math.hypot(
    endpoints.toScene.x - endpoints.fromScene.x,
    endpoints.toScene.y - endpoints.fromScene.y
  );
}

function pointAlongBeam(endpoints, distancePx) {
  const lengthPx = getFullBeamLengthPx(endpoints);

  if (lengthPx <= 0.001) {
    return cloneScenePoint(endpoints.fromScene);
  }

  const t = clamp(distancePx / lengthPx, 0, 1);

  return {
    x: endpoints.fromScene.x + (endpoints.toScene.x - endpoints.fromScene.x) * t,
    y: endpoints.fromScene.y + (endpoints.toScene.y - endpoints.fromScene.y) * t
  };
}

function lockProjectileEndpointsIfNeeded(state, endpoints) {
  /**
   * Large comment:
   * Lock fire-and-forget projectiles to their initial origin, direction, and
   * maximum travel distance.
   *
   * This makes a projectile feel like a fired shot rather than a tether or
   * homing beam. If projectileFireAndForget is false, the projectile continues
   * to use live token/target positions instead.
   */
  if (state.beamMode !== "projectile") return endpoints;
  if (!state.projectileFireAndForget) return endpoints;

  if (!state.projectileLockedEndpoints) {
    state.projectileLockedEndpoints = {
      fromScene: cloneScenePoint(endpoints.fromScene),
      toScene: cloneScenePoint(endpoints.toScene)
    };
  }

  return state.projectileLockedEndpoints;
}

function resolveProjectileSceneEndpoints(state, fullEndpoints) {
  /**
   * Large comment:
   * Convert the full beam path into a moving projectile segment.
   *
   * The projectile head moves from the origin to the resolved end point. The
   * visible projectile is only the trail behind that head, clamped to the full
   * path. On impact, the final trail can linger briefly before automatic cleanup.
   */
  const fullLengthPx = getFullBeamLengthPx(fullEndpoints);

  if (fullLengthPx <= 0.001) return null;

  const speedPx = Math.max(1, Number(state.projectileSpeedPx) || DEFAULTS.projectileSpeedPx);
  const trailPx = Math.max(1, Number(state.projectileTrailPx) || DEFAULTS.projectileTrailPx);

  const rawHeadDistancePx = (state.elapsedMs / 1000) * speedPx;

  if (rawHeadDistancePx >= fullLengthPx && state.projectileImpactStartedMs == null) {
    state.projectileImpactStartedMs = state.elapsedMs;
  }

  const hasImpacted = state.projectileImpactStartedMs != null;

  if (hasImpacted && state.projectileStopOnImpact) {
    const lingerMs = Math.max(
      0,
      Number(state.projectileImpactLingerMs) || DEFAULTS.projectileImpactLingerMs
    );

    if (state.elapsedMs - state.projectileImpactStartedMs > lingerMs) {
      return null;
    }
  }

  const headDistancePx = clamp(rawHeadDistancePx, 0, fullLengthPx);
  const tailDistancePx = clamp(headDistancePx - trailPx, 0, fullLengthPx);

  return {
    fromScene: pointAlongBeam(fullEndpoints, tailDistancePx),
    toScene: pointAlongBeam(fullEndpoints, headDistancePx)
  };
}

function resolveBeamSceneEndpoints(state) {
  const liveEndpoints = resolveLiveBeamSceneEndpoints(state);
  if (!liveEndpoints) return null;

  if (state.beamMode !== "projectile") {
    return liveEndpoints;
  }

  const fullEndpoints = lockProjectileEndpointsIfNeeded(state, liveEndpoints);

  return resolveProjectileSceneEndpoints(state, fullEndpoints);
}

/* -------------------------------------------- */
/* Redraw                                       */
/* -------------------------------------------- */

function drawBeamInParent(graphics, parent, state, endpoints, mode) {
  if (!graphics || graphics.destroyed || !parent) return;

  const from = scenePointToParentLocal(parent, endpoints.fromScene);
  const to = scenePointToParentLocal(parent, endpoints.toScene);

  if (!from || !to) return;
  if (!Number.isFinite(from.x) || !Number.isFinite(from.y)) return;
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return;

  const alpha = currentAlpha(state);

  if (mode === "body") {
    drawBeamBody(graphics, from, to, state, alpha);
    return;
  }

  if (mode === "overlay") {
    drawBeamOverlay(graphics, from, to, state, alpha);
    return;
  }

  drawBeamBody(graphics, from, to, state, alpha);
  drawBeamOverlay(graphics, from, to, state, alpha);
}

function redrawBeam(state) {
  if (!state) return false;
  if (state.belowGraphics?.destroyed || state.aboveGraphics?.destroyed) return false;

  clearBeamGraphics(state);

  const endpoints = resolveBeamSceneEndpoints(state);
  if (!endpoints) return false;

  const belowParent = state.belowGraphics?.parent ?? getBelowBeamParent();
  const aboveParent = state.aboveGraphics?.parent ?? getAboveBeamParent();

  if (state.layerMode === "below") {
    drawBeamInParent(state.belowGraphics, belowParent, state, endpoints, "all");
    return true;
  }

  if (state.layerMode === "above") {
    drawBeamInParent(state.aboveGraphics, aboveParent, state, endpoints, "all");
    return true;
  }

  drawBeamInParent(state.belowGraphics, belowParent, state, endpoints, "body");
  drawBeamInParent(state.aboveGraphics, aboveParent, state, endpoints, "overlay");

  return true;
}

function tick(runtime, deltaMS) {
  const store = getStore(runtime);
  const remove = [];

  for (const [beamId, state] of store.entries()) {
    state.elapsedMs += deltaMS;

    if (state.durationMs > 0 && state.elapsedMs >= state.durationMs) {
      remove.push(beamId);
      continue;
    }

    const ok = redrawBeam(state);
    if (!ok) remove.push(beamId);
  }

  for (const beamId of remove) {
    stopBeam(runtime, beamId);
  }

  if (!hasActiveBeams(runtime)) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

function ensureBeamTicker(runtime) {
  ensureTicker(runtime, EFFECT_NAME, (deltaMS) => tick(runtime, deltaMS));
}

/* -------------------------------------------- */
/* Start / stop                                 */
/* -------------------------------------------- */

function startBeam(runtime, def) {
  if (!def?.sourceTokenId) return;

  const containers = ensureBeamContainers();
  if (!containers) return;

  stopBeam(runtime, def.beamId);

  const belowGraphics = makeBeamGraphics(`FXBus.TokenBeam.${def.beamId}.Below`);
  const aboveGraphics = makeBeamGraphics(`FXBus.TokenBeam.${def.beamId}.Above`);

  try {
    containers.below.addChild(belowGraphics);
    containers.above.addChild(aboveGraphics);
  } catch (err) {
    destroyGraphics(belowGraphics);
    destroyGraphics(aboveGraphics);
    console.warn("[FX Bus] Token Beam graphics creation failed.", err);
    return;
  }

  const state = {
    ...def,
    belowGraphics,
    aboveGraphics,
    elapsedMs: 0,
    phase: hashString(def.beamId),
    lastAngleRad: null,
    projectileImpactStartedMs: null,
    projectileLockedEndpoints: null
  };

  getStore(runtime).set(def.beamId, state);
  redrawBeam(state);
  ensureBeamTicker(runtime);
}

function stopBeam(runtime, beamId) {
  const id = String(beamId ?? "").trim();
  if (!id) return;

  const store = getStore(runtime);
  const state = store.get(id);

  if (!state) return;

  destroyGraphics(state.belowGraphics);
  destroyGraphics(state.aboveGraphics);

  store.delete(id);

  if (!hasActiveBeams(runtime)) {
    cleanupTicker(runtime, EFFECT_NAME);
  }
}

function stopAllBeams(runtime) {
  const store = getStore(runtime);
  const beamIds = Array.from(store.keys());

  for (const beamId of beamIds) {
    stopBeam(runtime, beamId);
  }

  cleanupTicker(runtime, EFFECT_NAME);
}

function stopForSourceTokens(runtime, sourceTokenIds) {
  const ids = new Set(
    Array.from(sourceTokenIds ?? [])
      .map((id) => String(id ?? "").trim())
      .filter((id) => id.length > 0)
  );

  if (ids.size === 0) return;

  const store = getStore(runtime);
  const beamIds = [];

  for (const [beamId, state] of store.entries()) {
    if (ids.has(state.sourceTokenId)) beamIds.push(beamId);
  }

  for (const beamId of beamIds) {
    stopBeam(runtime, beamId);
  }
}

function stopFromPayload(runtime, payload) {
  const directBeamId = coerceString(payload?.beamId, "");

  if (directBeamId) {
    stopBeam(runtime, directBeamId);
    return;
  }

  const beamIds = coerceTokenIds(payload?.beamIds);

  if (beamIds.length > 0) {
    for (const beamId of beamIds) {
      stopBeam(runtime, beamId);
    }
    return;
  }

  const sourceTokenIds = [
    ...coerceTokenIds(payload?.sourceTokenIds),
    ...coerceTokenIds(payload?.tokenIds)
  ];

  const directSource = coerceString(payload?.sourceTokenId, "");
  if (directSource) sourceTokenIds.push(directSource);

  if (sourceTokenIds.length > 0) {
    stopForSourceTokens(runtime, sourceTokenIds);
    return;
  }

  stopAllBeams(runtime);
}

function startFromPayload(runtime, payload) {
  const { defs, replaceSourceTokenIds } = normalisePayload(payload);

  if (defs.length === 0) {
    ui.notifications?.warn?.("FX Bus: Token Beam requires at least one source token.");
    return;
  }

  stopForSourceTokens(runtime, replaceSourceTokenIds);

  for (const def of defs) {
    startBeam(runtime, def);
  }
}

function hardReset(runtime) {
  stopAllBeams(runtime);
  destroyBeamContainers();
}

/* -------------------------------------------- */
/* Registration                                 */
/* -------------------------------------------- */

export function registerTokenBeamFx(runtime) {
  runtime.handlers.set(ACTION_START, (payload) => startFromPayload(runtime, payload));
  runtime.handlers.set(ACTION_UPDATE, (payload) => startFromPayload(runtime, payload));
  runtime.handlers.set(ACTION_STOP, (payload) => stopFromPayload(runtime, payload));
  runtime.handlers.set(ACTION_STOP_ALL, () => stopAllBeams(runtime));
  runtime.handlers.set(ACTION_HARD_RESET, () => hardReset(runtime));

  /**
   * Large comment:
   * Expose cleanup for Reset All FX without forcing fxbusResetFx.js to know
   * implementation details. Reset may call this helper if present.
   */
  runtime.__fxbusTokenBeamHardReset = () => hardReset(runtime);
}