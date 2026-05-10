// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\tokenLaserFx.js

/**
 * FX Bus - Token Laser FX
 *
 * Purpose:
 * - Draw persistent visual-only laser links between tokens.
 * - Support preconfigured macro toggles via stable laserId.
 * - Keep lasers visible independently of token visibility.
 * - Make laser anchors follow rendered token position, including token oscillation.
 * - Optionally draw moving packets along the path for flow/data/power effects.
 * - Support above, below, and split token-layer rendering.
 * - Provide defensive hard cleanup for reset recovery.
 *
 * Actions:
 * - fx.tokenLaser.start
 * - fx.tokenLaser.stop
 * - fx.tokenLaser.toggle
 * - fx.tokenLaser.update
 * - fx.tokenLaser.stopAll
 * - fx.tokenLaser.hardReset
 *
 * Payload fields:
 * - laserId: string
 *     Stable id for toggling and stopping. Macros should use a fixed value.
 * - sourceTokenId: string
 *     Source token id.
 * - targetTokenIds: string[]
 *     Target token ids. One laser network may target several tokens.
 * - linkMode: "source" | "network"
 *     source = source token connects to every target.
 *     network = every listed token connects to every other listed token once.
 * - layerMode: "above" | "below" | "split"
 *     above = all laser graphics render above tokens.
 *     below = all laser graphics render below tokens.
 *     split = beam/laser body below tokens, highlights/packets/flares above tokens.
 * - colour: string | number
 *     Hex colour. Accepts "#ff0000", "ff0000", or 0xff0000.
 * - width: number
 *     Core laser width in pixels.
 * - alpha: number
 *     Main laser opacity.
 * - glow: boolean
 *     Draw wider translucent glow lines behind the core.
 * - pulse: boolean
 *     Animate alpha.
 * - pulseSpeed: number
 *     Pulse speed in cycles per second.
 * - style: "laser" | "beam" | "arc"
 *     Visual style.
 * - flowDirection: "none" | "forward" | "reverse" | "pingpong"
 *     Moving packet direction.
 * - flowSpeed: number
 *     Packet travel speed in path cycles per second.
 * - flowCount: number
 *     Number of moving packets per line.
 * - flowSize: number
 *     Packet radius in pixels. 0 = auto.
 * - flowColour: string | number
 *     Moving packet colour. Accepts "#ffffff", "ffffff", or 0xffffff.
 * - durationMs: number
 *     0 means run until stopped.
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
  width: 4,
  alpha: 0.95,
  glow: true,
  pulse: true,
  pulseSpeed: 2,
  style: "laser",
  linkMode: "network",
  layerMode: "split",
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
   * Store token laser state under runtime.tokenFx so it follows the existing
   * token-linked FX model. The map is keyed by laserId rather than tokenId
   * because one laser network can connect multiple token pairs.
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
  if (["laser", "beam", "arc"].includes(s)) return s;
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
  if (["none", "forward", "reverse", "pingpong"].includes(s)) return s;
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
    colour: coerceColour(payload?.colour),
    width: coerceNumber(payload?.width, DEFAULTS.width, 1, 40),
    alpha: coerceNumber(payload?.alpha, DEFAULTS.alpha, 0, 1),
    glow: coerceBoolean(payload?.glow, DEFAULTS.glow),
    pulse: coerceBoolean(payload?.pulse, DEFAULTS.pulse),
    pulseSpeed: coerceNumber(payload?.pulseSpeed, DEFAULTS.pulseSpeed, 0, 20),
    style: coerceStyle(payload?.style),
    linkMode: coerceLinkMode(payload?.linkMode),
    layerMode: coerceLayerMode(payload?.layerMode),
    flowDirection: coerceFlowDirection(payload?.flowDirection),
    flowSpeed: coerceNumber(payload?.flowSpeed, DEFAULTS.flowSpeed, 0, 20),
    flowCount: Math.round(coerceNumber(payload?.flowCount, DEFAULTS.flowCount, 1, 20)),
    flowSize: coerceNumber(payload?.flowSize, DEFAULTS.flowSize, 0, 60),
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
  return placeables.find((token) => token?.id === tokenId) ?? null;
}

function getLaserParent() {
  /**
   * Large comment:
   * Lasers must not be attached to source or target tokens. Their visibility
   * should be independent of token visibility, alpha, hidden state, and token
   * render effects. The token only controls endpoint sampling.
   */
  return canvas?.tokens ?? canvas?.app?.stage ?? null;
}

function configureContainer(container, name, zIndex) {
  container.name = name;
  container.sortableChildren = true;
  container.zIndex = zIndex;
  container.eventMode = "none";
  container.interactive = false;
  container.interactiveChildren = false;
}

function ensureLaserContainers() {
  /**
   * Large comment:
   * Maintain two persistent FX containers:
   * - below: intended to sit underneath token art
   * - above: intended to sit above token art
   *
   * Individual laser states own their own PIXI.Graphics objects inside these
   * containers. This allows split rendering without coupling graphics to token
   * visibility or token display hierarchy.
   */
  const parent = getLaserParent();
  if (!parent) return null;

  const key = "__fxbusTokenLaserContainers";

  if (
    parent[key]?.below &&
    parent[key]?.above &&
    !parent[key].below.destroyed &&
    !parent[key].above.destroyed
  ) {
    return parent[key];
  }

  try {
    parent.sortableChildren = true;
  } catch {
    // ignore
  }

  const below = new PIXI.Container();
  const above = new PIXI.Container();

  configureContainer(below, "FXBus.TokenLaser.BelowTokens", -10_000);
  configureContainer(above, "FXBus.TokenLaser.AboveTokens", 10_000);

  try {
    parent.addChildAt(below, 0);
  } catch {
    parent.addChild(below);
  }

  parent.addChild(above);

  parent[key] = { below, above };

  return parent[key];
}

function destroyLaserContainers() {
  /**
   * Large comment:
   * Hard-remove all persistent Token Laser containers from the canvas parent.
   *
   * This is deliberately more aggressive than stopAllLasers(). It is used by
   * global reset recovery to remove orphaned graphics that may no longer be
   * tracked in runtime.tokenFx, for example after stale client state or failed
   * development reloads.
   */
  const parent = getLaserParent();
  if (!parent) return;

  const key = "__fxbusTokenLaserContainers";
  const containers = parent[key];

  if (containers?.below) destroyGraphics(containers.below);
  if (containers?.above) destroyGraphics(containers.above);

  try {
    delete parent[key];
  } catch {
    parent[key] = null;
  }

  const legacyKey = "__fxbusTokenLaserContainer";
  const legacy = parent[legacyKey];

  if (legacy) {
    destroyGraphics(legacy);

    try {
      delete parent[legacyKey];
    } catch {
      parent[legacyKey] = null;
    }
  }

  const names = new Set([
    "FXBus.TokenLaser.Container",
    "FXBus.TokenLaser.BelowTokens",
    "FXBus.TokenLaser.AboveTokens"
  ]);

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
   * This allows the laser to follow visual-only render transforms such as
   * token oscillation, bobbing, swaying, or other PIXI-level offsets.
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

    if (canvas?.app?.stage && typeof canvas.app.stage.toLocal === "function") {
      const local = canvas.app.stage.toLocal(globalCentre);
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

function destroyGraphics(graphics) {
  if (!graphics) return;

  try {
    if (graphics.parent) graphics.parent.removeChild(graphics);
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

function makeLaserGraphics(name) {
  const graphics = new PIXI.Graphics();
  graphics.name = name;
  graphics.zIndex = 0;
  graphics.eventMode = "none";
  graphics.interactive = false;
  graphics.interactiveChildren = false;
  return graphics;
}

/* -------------------------------------------- */
/* Drawing                                      */
/* -------------------------------------------- */

function currentAlpha(state) {
  if (!state.pulse || state.pulseSpeed <= 0) return state.alpha;

  const seconds = state.elapsedMs / 1000;
  const wave = 0.5 + 0.5 * Math.sin(seconds * state.pulseSpeed * Math.PI * 2);

  return clamp(state.alpha * (0.65 + 0.35 * wave), 0, 1);
}

function drawStraightLine(graphics, from, to, colour, width, alpha) {
  if (!graphics) return;

  graphics.lineStyle({
    width,
    color: colour,
    alpha,
    cap: PIXI.LINE_CAP.ROUND,
    join: PIXI.LINE_JOIN.ROUND
  });

  graphics.moveTo(from.x, from.y);
  graphics.lineTo(to.x, to.y);
}

function getBodyGraphics(state) {
  if (state.layerMode === "above") return state.aboveGraphics;
  return state.belowGraphics;
}

function getOverlayGraphics(state) {
  if (state.layerMode === "below") return state.belowGraphics;
  return state.aboveGraphics;
}

function drawArcLine(graphics, from, to, state, alpha) {
  /**
   * Large comment:
   * Arc style is deterministic. It does not use random values per frame, so
   * all clients draw the same unstable-looking path from the same payload and
   * elapsed time. This keeps the visual consistent without synchronising RNG.
   */
  if (!graphics) return;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (length <= 0.001) return;

  const nx = -dy / length;
  const ny = dx / length;

  const segments = clamp(Math.ceil(length / 80), 4, 18);
  const time = state.elapsedMs / 1000;
  const amp = clamp(state.width * 2.5, 4, 28);

  graphics.lineStyle({
    width: Math.max(1, state.width),
    color: state.colour,
    alpha,
    cap: PIXI.LINE_CAP.ROUND,
    join: PIXI.LINE_JOIN.ROUND
  });

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
  if (!graphics) return;

  const outerRadius = Math.max(state.width * 2.2, 6);
  const innerRadius = Math.max(state.width * 0.75, 2);

  graphics.beginFill(state.colour, alpha * 0.35);
  graphics.drawCircle(point.x, point.y, outerRadius);
  graphics.endFill();

  graphics.beginFill(0xffffff, alpha * 0.75);
  graphics.drawCircle(point.x, point.y, innerRadius);
  graphics.endFill();
}

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

function drawFlowPackets(graphics, from, to, state, alpha) {
  /**
   * Large comment:
   * Draw moving packets along the laser path.
   *
   * This is visual-only and deterministic. The packets are derived from elapsed
   * time, packet index, and path endpoints, so clients render equivalent motion
   * without synchronising particle state.
   */
  if (!graphics) return;
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
    const x = from.x + dx * t;
    const y = from.y + dy * t;

    graphics.beginFill(state.flowColour, alpha * 0.35);
    graphics.drawCircle(x, y, size * 1.8);
    graphics.endFill();

    graphics.beginFill(state.flowColour, alpha * 0.95);
    graphics.drawCircle(x, y, size);
    graphics.endFill();

    graphics.beginFill(0xffffff, alpha * 0.8);
    graphics.drawCircle(x, y, Math.max(1, size * 0.35));
    graphics.endFill();
  }
}

function drawLaserToTarget(state, from, to) {
  const alpha = currentAlpha(state);
  const body = getBodyGraphics(state);
  const overlay = getOverlayGraphics(state);

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
      0xffffff,
      Math.max(1, state.width * 0.35),
      alpha * 0.75
    );
    drawFlowPackets(overlay, from, to, state, alpha);
    return;
  }

  if (state.style === "beam") {
    /**
     * Large comment:
     * Beam style is deliberately distinct from laser style.
     *
     * Laser reads as a precise line. Beam reads as a sustained energy conduit:
     * broad translucent body, bright core, and visible endpoint flares.
     *
     * In split mode the broad conduit is below tokens, while flares and moving
     * packets remain above tokens for readability.
     */
    const bodyWidth = Math.max(state.width * 3.2, state.width + 8);
    const midWidth = Math.max(state.width * 1.8, state.width + 4);
    const coreWidth = Math.max(1, state.width * 0.65);

    drawStraightLine(body, from, to, state.colour, bodyWidth, alpha * 0.22);
    drawStraightLine(body, from, to, state.colour, midWidth, alpha * 0.45);
    drawStraightLine(overlay, from, to, 0xffffff, coreWidth, alpha * 0.75);

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
    0xffffff,
    Math.max(1, state.width * 0.25),
    alpha * 0.9
  );
  drawFlowPackets(overlay, from, to, state, alpha);
}

function getLaserPairs(state) {
  /**
   * Large comment:
   * Build the token-id pairs connected by this laser network.
   *
   * source mode:
   * - source token connects to every target token.
   *
   * network mode:
   * - every selected token connects to every other selected token once.
   * - three tokens produce A-B, A-C, B-C.
   */
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
  state.belowGraphics?.clear?.();
  state.aboveGraphics?.clear?.();
}

function redrawLaser(state) {
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
  /**
   * Large comment:
   * Stop tracked lasers and also destroy persistent laser containers.
   *
   * This recovers clients whose visible laser graphics exist without matching
   * runtime.tokenFx state.
   */
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
  existing.width = data.width;
  existing.alpha = data.alpha;
  existing.glow = data.glow;
  existing.pulse = data.pulse;
  existing.pulseSpeed = data.pulseSpeed;
  existing.style = data.style;
  existing.linkMode = data.linkMode;
  existing.layerMode = data.layerMode;
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