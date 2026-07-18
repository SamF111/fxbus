// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\shared\motionSync.js

/**
 * FX Bus - Motion Sync shared runtime helper
 *
 * Motion Sync is intentionally client-local and visual-only. It provides a
 * shared phase origin for independently running oscillation effects without
 * attaching documents or changing Scene data.
 */

const TWO_PI = Math.PI * 2;
const DEG_TO_RAD = Math.PI / 180;

export function getMotionSyncGroups(runtime) {
  runtime.motionSyncGroups ??= new Map();
  return runtime.motionSyncGroups;
}

export function normaliseSyncGroup(value) {
  const group = typeof value === "string" ? value.trim() : "";
  return group.length > 0 ? group : null;
}

export function normaliseSyncPhaseDeg(value) {
  const phase = Number(value);
  if (!Number.isFinite(phase)) return 0;

  const wrapped = phase % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function getOrCreateMotionSyncGroup(runtime, groupId, nowMs) {
  const groups = getMotionSyncGroups(runtime);
  let group = groups.get(groupId);

  if (!group) {
    group = {
      id: groupId,
      originMs: nowMs,
      members: new Set(),
      memberDetails: new Map(),
      freqHz: null,
      latestDetails: null,
      latestMemberKey: null,
      latestUpdatedAtMs: nowMs
    };
    groups.set(groupId, group);
    return group;
  }

  if (!(group.members instanceof Set)) group.members = new Set();
  if (!(group.memberDetails instanceof Map)) group.memberDetails = new Map();

  return group;
}

export function joinMotionSyncGroup(runtime, groupId, memberKey, details = {}, nowMs = performance.now()) {
  if (!groupId || !memberKey) return null;

  const group = getOrCreateMotionSyncGroup(runtime, groupId, nowMs);
  group.members.add(memberKey);

  const nextDetails = normaliseMotionSyncDetails(details);
  group.memberDetails.set(memberKey, nextDetails);

  if (Number.isFinite(nextDetails.freqHz)) {
    group.freqHz = nextDetails.freqHz;
  }

  group.latestDetails = nextDetails;
  group.latestMemberKey = memberKey;
  group.latestUpdatedAtMs = nowMs;

  return group;
}

export function leaveMotionSyncGroup(runtime, groupId, memberKey) {
  if (!runtime?.motionSyncGroups || !groupId || !memberKey) return;

  const groups = getMotionSyncGroups(runtime);
  const group = groups.get(groupId);
  if (!group) return;

  group.members?.delete?.(memberKey);
  group.memberDetails?.delete?.(memberKey);

  if (!group.members || group.members.size === 0) {
    groups.delete(groupId);
    return;
  }
}

export function getMotionSyncPhaseRad(runtime, groupId, freqHz, syncPhaseDeg, nowMs = performance.now()) {
  if (!runtime?.motionSyncGroups || !groupId) return null;

  const group = getMotionSyncGroups(runtime).get(groupId);
  if (!group) return null;

  const frequency = Number.isFinite(group.freqHz)
    ? group.freqHz
    : Number(freqHz);
  if (!Number.isFinite(frequency)) return null;

  const elapsedSeconds = (nowMs - group.originMs) / 1000;
  return (TWO_PI * frequency * elapsedSeconds) + (normaliseSyncPhaseDeg(syncPhaseDeg) * DEG_TO_RAD);
}

export function sampleMotionSyncWaves(phaseRad) {
  const phase = Number(phaseRad);
  if (!Number.isFinite(phase)) return null;

  return {
    rollWave: Math.sin(phase),
    bobWave: Math.sin(phase),
    swayWave: Math.cos(phase)
  };
}

function normaliseMotionSyncDetails(details) {
  if (typeof details === "number" || typeof details === "string") {
    const freqHz = Number(details);

    return {
      freqHz: Number.isFinite(freqHz) ? freqHz : null
    };
  }

  if (!details || typeof details !== "object") {
    return {
      freqHz: null
    };
  }

  const freqHz = Number(details.freqHz);

  return {
    ...details,
    freqHz: Number.isFinite(freqHz) ? freqHz : null
  };
}
