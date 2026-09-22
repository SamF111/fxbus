// D:\FoundryVTT\Data\modules\fxbus\scripts\targetedFxLedger.js

import { normalizeFxAudience } from "./audience.js";

const ACTION_GLOBAL_RESET = "fx.bus.reset";
const GLOBAL_RESOURCE = "global";

const EFFECTS = [
  effect("screenShake", "Screen Shake", "fx.screenShake.start", "fx.screenShake.stop", 600),
  effect("screenRotate", "Screen Rotate", "fx.screenRotate.start", "fx.screenRotate.stop", 1500),
  effect("screenPulse", "Screen Pulse", "fx.screenPulse.start", "fx.screenPulse.stop", 1500),
  effect("screenVignette", "Screen Vignette", "fx.screenVignette.start", "fx.screenVignette.stop", 1200),
  effect("chromAb", "Chromatic Aberration", "fx.chromAb.start", "fx.chromAb.stop", 0),
  effect("noise", "Screen Noise", "fx.noise.start", "fx.noise.stop", 0),
  effect("screenBlur", "Screen Blur", "fx.screenBlur.start", "fx.screenBlur.stop", 0),
  effect("screenSmear", "Screen Smear", "fx.screenSmear.start", "fx.screenSmear.stop", 0),
  effect("screenStreak", "Screen Streak", "fx.screenStreak.start", "fx.screenStreak.stop", 0),
  effect(
    "screenMonochrome",
    "Screen Monochrome",
    "fx.screenMonochrome.start",
    "fx.screenMonochrome.stop",
    0,
    { updateActions: ["fx.screenMonochrome.update"] }
  ),
  effect(
    "canvasMirror",
    "Canvas Mirror",
    "fx.canvasMirror.start",
    "fx.canvasMirror.stop",
    0,
    { startLifecycle: "toggle", resourceResolver: resolveMirrorResources }
  ),
  effect(
    "tokenOsc",
    "Token Oscillation",
    "fx.tokenOsc.start",
    "fx.tokenOsc.stop",
    0,
    {
      updateActions: ["fx.tokenOsc.update"],
      stopAllActions: ["fx.tokenOsc.stopAll"],
      emptyStopMeansAll: false,
      resourceField: "tokenIds"
    }
  ),
  effect(
    "tokenRecoil",
    "Token Recoil",
    "fx.tokenRecoil.burst",
    "fx.tokenRecoil.stop",
    450,
    {
      stopAllActions: ["fx.tokenRecoil.stopAll"],
      resourceField: "tokenIds"
    }
  ),
  effect("tokenDollyZoom", "Token Dolly Zoom", "fx.tokenDollyZoom.start", "fx.tokenDollyZoom.stop", 6500),
  effect(
    "tokenLaser",
    "Token Tether",
    "fx.tokenLaser.start",
    "fx.tokenLaser.stop",
    0,
    {
      updateActions: ["fx.tokenLaser.update"],
      toggleActions: ["fx.tokenLaser.toggle"],
      stopAllActions: ["fx.tokenLaser.stopAll", "fx.tokenLaser.hardReset"],
      resourceResolver: resolveLaserResources,
      emptyStopMeansAll: false
    }
  ),
  effect(
    "tokenBeam",
    "Token Laser",
    "fx.tokenBeam.start",
    "fx.tokenBeam.stop",
    0,
    {
      updateActions: ["fx.tokenBeam.update"],
      stopAllActions: ["fx.tokenBeam.stopAll", "fx.tokenBeam.hardReset"],
      resourceResolver: resolveBeamResources
    }
  ),
  effect(
    "tileOscillation",
    "Tile Oscillation",
    "fx.tileOscillation.start",
    "fx.tileOscillation.stop",
    0,
    {
      updateActions: ["fx.tileOscillation.update"],
      stopAllActions: ["fx.tileOscillation.stopAll"],
      resourceField: "tileIds"
    }
  ),
  effect(
    "tileRotation",
    "Tile Rotation",
    "fx.tileRotation.start",
    "fx.tileRotation.stop",
    0,
    { updateActions: ["fx.tileRotation.update"], resourceField: "tileIds" }
  ),
  effect(
    "tileFlicker",
    "Tile Flicker",
    "fx.tileFlicker.start",
    "fx.tileFlicker.stop",
    0,
    { updateActions: ["fx.tileFlicker.update"], resourceField: "tileIds" }
  ),
  effect(
    "tileFlow",
    "Tile Flow",
    "fx.tileFlow.start",
    "fx.tileFlow.stop",
    0,
    { updateActions: ["fx.tileFlow.update"], resourceField: "tileIds" }
  )
];

const ACTIONS = new Map();
const EFFECTS_BY_KEY = new Map(EFFECTS.map((descriptor) => [descriptor.key, descriptor]));

for (const descriptor of EFFECTS) {
  ACTIONS.set(descriptor.startAction, {
    descriptor,
    lifecycle: descriptor.startLifecycle
  });
  ACTIONS.set(descriptor.stopAction, { descriptor, lifecycle: "stop" });

  for (const action of descriptor.updateActions) {
    ACTIONS.set(action, { descriptor, lifecycle: "update" });
  }

  for (const action of descriptor.toggleActions) {
    ACTIONS.set(action, { descriptor, lifecycle: "toggle" });
  }

  for (const action of descriptor.stopAllActions) {
    ACTIONS.set(action, { descriptor, lifecycle: "stopAll" });
  }
}

function effect(key, label, startAction, stopAction, defaultDurationMs, options = {}) {
  return {
    key,
    label,
    startAction,
    stopAction,
    defaultDurationMs,
    updateActions: options.updateActions ?? [],
    toggleActions: options.toggleActions ?? [],
    stopAllActions: options.stopAllActions ?? [],
    startLifecycle: options.startLifecycle ?? "start",
    emptyStopMeansAll: options.emptyStopMeansAll ?? true,
    resourceField: options.resourceField ?? null,
    resourceResolver: options.resourceResolver ?? null
  };
}

function resolveMirrorResources(message, lifecycle) {
  if (lifecycle === "stop") return [];

  const axis = String(message?.axis ?? "x").trim().toLowerCase();
  if (axis === "y" || axis === "vertical") return [makeResource("axis:y")];
  if (axis === "xy" || axis === "both") {
    return [makeResource("axis:x"), makeResource("axis:y")];
  }

  return [makeResource("axis:x")];
}

function stringIds(value) {
  const values = Array.isArray(value) ? value : [value];
  const result = [];
  const seen = new Set();

  for (const item of values) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }

  return result;
}

function makeResource(identity, selectors = [identity]) {
  return {
    identity,
    selectors: Array.from(new Set(selectors))
  };
}

function resolveLaserResources(message) {
  const laserId = stringIds(message?.laserId)[0] ?? null;
  const sourceId = stringIds(message?.sourceTokenId)[0] ?? null;
  const targetIds = stringIds(message?.targetTokenIds);
  const selectors = [];

  if (laserId) selectors.push(`laser:${laserId}`);
  if (sourceId) selectors.push(`source:${sourceId}`);
  for (const id of targetIds) selectors.push(`token:${id}`);

  if (selectors.length === 0) return [];

  const identity = laserId
    ? `laser:${laserId}`
    : `network:${[sourceId, ...targetIds].filter(Boolean).join(":")}`;

  return [makeResource(identity, selectors)];
}

function resolveBeamResources(message, lifecycle) {
  const beamIds = [
    ...stringIds(message?.beamId),
    ...stringIds(message?.beamIds)
  ];
  const directSources = [
    ...stringIds(message?.sourceTokenId),
    ...stringIds(message?.sourceTokenIds)
  ];
  const tokenIds = stringIds(message?.tokenIds);
  const sourceIds = lifecycle === "stop"
    ? [...directSources, ...tokenIds]
    : [...directSources, ...(tokenIds.length ? [tokenIds[0]] : [])];
  const selectors = [];

  for (const id of beamIds) selectors.push(`beam:${id}`);
  for (const id of sourceIds) selectors.push(`source:${id}`);
  if (lifecycle !== "stop") {
    for (const id of tokenIds) selectors.push(`token:${id}`);
  }

  if (selectors.length === 0) return [];

  const identity = beamIds.length
    ? `beam:${beamIds.join(":")}`
    : `network:${tokenIds.join(":") || sourceIds.join(":")}`;

  return [makeResource(identity, selectors)];
}

function resolveResources(descriptor, message, lifecycle) {
  if (typeof descriptor.resourceResolver === "function") {
    return descriptor.resourceResolver(message, lifecycle);
  }

  if (descriptor.resourceField) {
    return stringIds(message?.[descriptor.resourceField]).map((id) =>
      makeResource(`${descriptor.resourceField}:${id}`)
    );
  }

  return [makeResource(GLOBAL_RESOURCE)];
}

function ensureLedger(runtime) {
  if (!(runtime.targetedFxLedger instanceof Map)) {
    runtime.targetedFxLedger = new Map();
  }

  if (!(runtime.__targetedFxLedgerTimers instanceof Map)) {
    runtime.__targetedFxLedgerTimers = new Map();
  }

  return runtime.targetedFxLedger;
}

function clearEntryTimer(runtime, key) {
  const timers = runtime.__targetedFxLedgerTimers;
  const timer = timers?.get(key);

  if (timer !== undefined) clearTimeout(timer);
  timers?.delete(key);
}

function deleteEntry(runtime, key) {
  clearEntryTimer(runtime, key);
  runtime.targetedFxLedger?.delete(key);
}

function scheduleExpiry(runtime, entry, now) {
  clearEntryTimer(runtime, entry.key);
  if (entry.expiresAt === null) return;

  const delay = Math.max(0, entry.expiresAt - now);
  const timer = setTimeout(() => {
    const current = runtime.targetedFxLedger?.get(entry.key);
    if (!current || current.expiresAt !== entry.expiresAt) return;
    deleteEntry(runtime, entry.key);
  }, delay);

  timer?.unref?.();
  runtime.__targetedFxLedgerTimers.set(entry.key, timer);
}

function durationFor(descriptor, message, previous, lifecycle) {
  if (descriptor.key === "screenRotate") {
    if (message?.holdWhenFinished === true || message?.returnWhenFinished === false) return 0;
  }

  if (descriptor.key === "tileFlow" && message?.completionMode === "retain") return 0;

  if (lifecycle === "update" && !Number.isFinite(message?.durationMs) && previous) {
    return previous.durationMs;
  }

  const value = Number.isFinite(message?.durationMs)
    ? Number(message.durationMs)
    : descriptor.defaultDurationMs;

  return Math.max(0, value);
}

function usersFor(message) {
  return normalizeFxAudience(message?.audience).userIds;
}

function resourceMatches(entry, resources) {
  if (resources.length === 0) return true;

  const selectors = new Set(resources.flatMap((resource) => resource.selectors));
  return entry.selectors.some((selector) => selectors.has(selector));
}

function removeMatching(runtime, descriptor, userIds, resources) {
  const targetUsers = userIds.length ? new Set(userIds) : null;

  for (const [key, entry] of ensureLedger(runtime)) {
    if (entry.effectKey !== descriptor.key) continue;
    if (targetUsers && !targetUsers.has(entry.userId)) continue;
    if (!resourceMatches(entry, resources)) continue;
    deleteEntry(runtime, key);
  }
}

function putEntry(runtime, descriptor, userId, resource, message, lifecycle, now) {
  const key = `${descriptor.key}|${userId}|${resource.identity}`;
  const previous = ensureLedger(runtime).get(key) ?? null;
  const durationMs = durationFor(descriptor, message, previous, lifecycle);
  const startedAt = lifecycle === "update" && previous ? previous.startedAt : now;
  const expiresAt = durationMs > 0 ? startedAt + durationMs : null;
  const entry = {
    key,
    effectKey: descriptor.key,
    effectLabel: descriptor.label,
    action: message.action,
    userId,
    resourceId: resource.identity,
    selectors: [...resource.selectors],
    startedAt,
    updatedAt: now,
    durationMs,
    expiresAt
  };

  ensureLedger(runtime).set(key, entry);
  scheduleExpiry(runtime, entry, now);
}

function activate(runtime, descriptor, lifecycle, message, userIds, now) {
  const resources = resolveResources(descriptor, message, lifecycle);

  // Resource-based effects cannot start without a valid target. Screen/canvas
  // effects always resolve to the global resource.
  if (resources.length === 0) return;

  if (userIds.length === 0) {
    if (lifecycle === "update") {
      for (const entry of ensureLedger(runtime).values()) {
        if (entry.effectKey !== descriptor.key) continue;
        if (!resourceMatches(entry, resources)) continue;
        putEntry(runtime, descriptor, entry.userId, {
          identity: entry.resourceId,
          selectors: entry.selectors
        }, message, lifecycle, now);
      }
      return;
    }

    // A broadcast start supersedes matching targeted state, so it no longer
    // needs a private-effect reminder.
    removeMatching(runtime, descriptor, [], resources);
    return;
  }

  for (const userId of userIds) {
    for (const resource of resources) {
      putEntry(runtime, descriptor, userId, resource, message, lifecycle, now);
    }
  }
}

function toggle(runtime, descriptor, message, userIds, now) {
  const resources = resolveResources(descriptor, message, "toggle");
  if (resources.length === 0) return;

  const recipients = userIds.length > 0
    ? userIds
    : Array.from(new Set(
      Array.from(ensureLedger(runtime).values())
        .filter((entry) => entry.effectKey === descriptor.key)
        .map((entry) => entry.userId)
    ));

  for (const userId of recipients) {
    for (const resource of resources) {
      const matches = Array.from(ensureLedger(runtime).values()).filter((entry) =>
        entry.effectKey === descriptor.key &&
        entry.userId === userId &&
        resourceMatches(entry, [resource])
      );

      if (matches.length > 0) {
        for (const entry of matches) deleteEntry(runtime, entry.key);
      } else if (userIds.length > 0) {
        putEntry(runtime, descriptor, userId, resource, message, "start", now);
      }
    }
  }
}

export function clearTargetedFxLedger(runtime) {
  if (!runtime) return;

  for (const key of runtime.__targetedFxLedgerTimers?.keys?.() ?? []) {
    clearEntryTimer(runtime, key);
  }

  runtime.targetedFxLedger?.clear?.();
}

export function getActiveTargetedFx(runtime, now = Date.now()) {
  const ledger = ensureLedger(runtime);

  for (const [key, entry] of ledger) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) {
      deleteEntry(runtime, key);
    }
  }

  return Array.from(ledger.values(), (entry) => ({ ...entry, selectors: [...entry.selectors] }));
}

function observeLedgerMessage(runtime, message, userIds, now) {
  if (message?.action === ACTION_GLOBAL_RESET) {
    clearTargetedFxLedger(runtime);
    return;
  }

  const lifecycleInfo = ACTIONS.get(message?.action);
  if (!lifecycleInfo) return;

  const { descriptor, lifecycle } = lifecycleInfo;

  if (lifecycle === "stop" || lifecycle === "stopAll") {
    const resources = lifecycle === "stopAll"
      ? []
      : resolveResources(descriptor, message, lifecycle);
    if (lifecycle === "stop" && resources.length === 0 && !descriptor.emptyStopMeansAll) return;
    removeMatching(runtime, descriptor, userIds, resources);
    return;
  }

  if (lifecycle === "toggle") {
    toggle(runtime, descriptor, message, userIds, now);
    return;
  }

  activate(runtime, descriptor, lifecycle, message, userIds, now);
}

function localLedgerState(runtime) {
  if (!runtime.__targetedFxLocalState || typeof runtime.__targetedFxLocalState !== "object") {
    runtime.__targetedFxLocalState = {};
  }

  return runtime.__targetedFxLocalState;
}

export function observeLocalTargetedFxMessage(runtime, message, currentUserId, now = Date.now()) {
  if (!runtime) return;

  const state = localLedgerState(runtime);
  if (message?.action === ACTION_GLOBAL_RESET) {
    clearTargetedFxLedger(state);
    return;
  }

  const userId = String(currentUserId ?? "").trim();
  if (!userId) return;

  const userIds = usersFor(message);
  if (userIds.length > 0 && !userIds.includes(userId)) return;

  // A recipient stores only its own slice of a multi-user targeted packet.
  // Untargeted lifecycle packets still update/remove matching targeted state.
  const scopedUserIds = userIds.length > 0 ? [userId] : [];
  observeLedgerMessage(state, message, scopedUserIds, now);
}

export function getLocalTargetedFxSnapshot(runtime, now = Date.now()) {
  if (!runtime) return [];

  return getActiveTargetedFx(localLedgerState(runtime), now).map((entry) => ({
    effectKey: entry.effectKey,
    action: entry.action,
    resourceId: entry.resourceId,
    selectors: [...entry.selectors],
    elapsedMs: Math.max(0, now - entry.startedAt),
    remainingMs: entry.expiresAt === null
      ? null
      : Math.max(0, entry.expiresAt - now)
  }));
}

export function reconcileTargetedFxUser(runtime, userId, snapshot, now = Date.now()) {
  if (!runtime) return;

  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return;

  for (const [key, entry] of ensureLedger(runtime)) {
    if (entry.userId === normalizedUserId) deleteEntry(runtime, key);
  }

  if (!Array.isArray(snapshot)) return;

  for (const item of snapshot) {
    const descriptor = EFFECTS_BY_KEY.get(item?.effectKey);
    const resourceId = String(item?.resourceId ?? "").trim();
    const selectors = stringIds(item?.selectors);
    if (!descriptor || !resourceId || selectors.length === 0) continue;

    const elapsedMs = Number.isFinite(item?.elapsedMs)
      ? Math.max(0, Number(item.elapsedMs))
      : 0;
    const remainingMs = item?.remainingMs === null
      ? null
      : Number.isFinite(item?.remainingMs)
        ? Math.max(0, Number(item.remainingMs))
        : null;
    if (remainingMs === 0) continue;

    const entry = {
      key: `${descriptor.key}|${normalizedUserId}|${resourceId}`,
      effectKey: descriptor.key,
      effectLabel: descriptor.label,
      action: typeof item?.action === "string" ? item.action : descriptor.startAction,
      userId: normalizedUserId,
      resourceId,
      selectors,
      startedAt: now - elapsedMs,
      updatedAt: now,
      durationMs: remainingMs === null ? 0 : elapsedMs + remainingMs,
      expiresAt: remainingMs === null ? null : now + remainingMs
    };

    ensureLedger(runtime).set(entry.key, entry);
    scheduleExpiry(runtime, entry, now);
  }
}

export function observeTargetedFxMessage(runtime, message, now = Date.now()) {
  if (!runtime || globalThis.game?.user?.isGM !== true) return;
  const userIds = message?.action === ACTION_GLOBAL_RESET ? [] : usersFor(message);
  observeLedgerMessage(runtime, message, userIds, now);
}
