// D:\FoundryVTT\Data\modules\fxbus\scripts\targetedFxSync.js

import { normalizeFxAudience } from "./audience.js";
import {
  getActiveTargetedFx,
  getLocalTargetedFxSnapshot,
  reconcileTargetedFxUser
} from "./targetedFxLedger.js";
import { clearTargetedFxReminderIfInactive } from "./targetedFxReminders.js";

export const TARGETED_FX_SYNC_REQUEST = "fx.bus.sync.request";
export const TARGETED_FX_SYNC_RESPONSE = "fx.bus.sync.response";
export const TARGETED_FX_SYNC_ACK = "fx.bus.sync.ack";
export const DEFAULT_TARGETED_FX_SYNC_SECONDS = 30;

let requestSequence = 0;

function currentUserId() {
  return String(globalThis.game?.userId ?? globalThis.game?.user?.id ?? "").trim();
}

function nextRequestId() {
  requestSequence += 1;
  return `${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function senderUser(message) {
  const userId = String(message?.__fxbus?.userId ?? "").trim();
  return userId ? globalThis.game?.users?.get?.(userId) ?? null : null;
}

function controlMetadata(messageId = nextRequestId()) {
  const user = globalThis.game?.user;

  return {
    userId: currentUserId(),
    userName: user?.name,
    isGM: user?.isGM === true,
    role: user?.role ?? user?.data?.role ?? null,
    ts: Date.now(),
    messageId
  };
}

function emitControl(runtime, payload) {
  if (!runtime?.socketName || !globalThis.game?.socket?.emit) return false;

  try {
    globalThis.game.socket.emit(runtime.socketName, {
      ...payload,
      __fxbus: controlMetadata(payload.requestId)
    });
    return true;
  } catch (error) {
    console.warn("[FX Bus] targeted state sync emit failed", error);
    return false;
  }
}

function worldUsers() {
  const users = globalThis.game?.users;
  if (Array.isArray(users?.contents)) return users.contents;
  if (typeof users?.values === "function") return Array.from(users.values());
  if (Array.isArray(users)) return users;
  return [];
}

function clearUnavailableUsers(runtime, now) {
  const userIds = new Set(
    getActiveTargetedFx(runtime, now).map((entry) => entry.userId)
  );

  for (const userId of userIds) {
    const user = globalThis.game?.users?.get?.(userId) ?? null;
    if (!user || user.active !== true) {
      reconcileTargetedFxUser(runtime, userId, [], now);
    }
  }
}

export function isTargetedFxSyncAction(action) {
  return action === TARGETED_FX_SYNC_REQUEST ||
    action === TARGETED_FX_SYNC_RESPONSE ||
    action === TARGETED_FX_SYNC_ACK;
}

export function requestTargetedFxSync(runtime, now = Date.now()) {
  if (globalThis.game?.user?.isGM !== true) return false;

  clearUnavailableUsers(runtime, now);

  if (!(runtime.__targetedFxSyncMisses instanceof Map)) {
    runtime.__targetedFxSyncMisses = new Map();
  }

  for (const userId of runtime.__targetedFxSyncPending?.userIds ?? []) {
    const misses = (runtime.__targetedFxSyncMisses.get(userId) ?? 0) + 1;
    runtime.__targetedFxSyncMisses.set(userId, misses);
    if (misses >= 2) reconcileTargetedFxUser(runtime, userId, [], now);
  }

  const requestId = nextRequestId();
  runtime.__targetedFxSyncRequestId = requestId;
  runtime.__targetedFxSyncPending = {
    requestId,
    userIds: new Set(
      worldUsers()
        .filter((user) => user?.active === true && String(user?.id ?? "") !== currentUserId())
        .map((user) => String(user.id))
    )
  };

  return emitControl(runtime, {
    action: TARGETED_FX_SYNC_REQUEST,
    requestId,
    requestedByUserId: currentUserId()
  });
}

export function acknowledgeTargetedFxMessage(runtime, message, status = "applied") {
  let userIds;

  try {
    userIds = normalizeFxAudience(message?.audience).userIds;
  } catch {
    return false;
  }

  const userId = currentUserId();
  const requestedByUserId = String(message?.__fxbus?.userId ?? "").trim();
  const requestId = String(message?.__fxbus?.messageId ?? "").trim();

  if (!userId || !requestedByUserId || !requestId || !userIds.includes(userId)) {
    return false;
  }

  return emitControl(runtime, {
    action: TARGETED_FX_SYNC_ACK,
    requestId,
    requestedByUserId,
    userId,
    status: status === "applied" ? "applied" : "failed",
    entries: getLocalTargetedFxSnapshot(runtime)
  });
}

function respondToRequest(runtime, message) {
  const sender = senderUser(message);
  const requestId = String(message?.requestId ?? "").trim();
  const requestedByUserId = String(message?.requestedByUserId ?? "").trim();

  if (!sender?.isGM || !requestId || requestedByUserId !== String(sender.id)) return;

  emitControl(runtime, {
    action: TARGETED_FX_SYNC_RESPONSE,
    requestId,
    requestedByUserId,
    userId: currentUserId(),
    entries: getLocalTargetedFxSnapshot(runtime)
  });
}

function consumeClientState(runtime, message, now) {
  if (globalThis.game?.user?.isGM !== true) return;

  const sender = senderUser(message);
  const senderId = String(sender?.id ?? "").trim();
  const userId = String(message?.userId ?? "").trim();
  const requestedByUserId = String(message?.requestedByUserId ?? "").trim();

  if (!senderId || senderId !== userId || requestedByUserId !== currentUserId()) return;

  reconcileTargetedFxUser(runtime, userId, message?.entries, now);
  void clearTargetedFxReminderIfInactive(runtime);

  if (message.action === TARGETED_FX_SYNC_RESPONSE &&
      message.requestId === runtime.__targetedFxSyncPending?.requestId) {
    runtime.__targetedFxSyncPending.userIds.delete(userId);
  }
  runtime.__targetedFxSyncMisses?.delete?.(userId);

  if (!(runtime.__targetedFxLastConfirmedAt instanceof Map)) {
    runtime.__targetedFxLastConfirmedAt = new Map();
  }
  runtime.__targetedFxLastConfirmedAt.set(userId, now);
}

export function handleTargetedFxSyncMessage(runtime, message, now = Date.now()) {
  if (!isTargetedFxSyncAction(message?.action)) return false;

  if (message.action === TARGETED_FX_SYNC_REQUEST) {
    respondToRequest(runtime, message);
  } else {
    consumeClientState(runtime, message, now);
  }

  return true;
}

export function stopTargetedFxSync(runtime) {
  if (!runtime) return;
  if (runtime.__targetedFxSyncTimer !== undefined) {
    clearInterval(runtime.__targetedFxSyncTimer);
  }
  runtime.__targetedFxSyncTimer = undefined;
  runtime.__targetedFxSyncPending = undefined;
}

export function registerTargetedFxSyncHooks(runtime, hooks = globalThis.Hooks) {
  if (!runtime || globalThis.game?.user?.isGM !== true || !hooks?.on) return false;
  if (runtime.__targetedFxSyncHooksRegistered) return true;

  const userConnected = (user, connected) => {
    const userId = String(user?.id ?? "").trim();
    if (!userId || userId === currentUserId()) return;

    if (connected === false) {
      reconcileTargetedFxUser(runtime, userId, []);
      void clearTargetedFxReminderIfInactive(runtime);
      runtime.__targetedFxSyncPending?.userIds?.delete?.(userId);
      runtime.__targetedFxSyncMisses?.delete?.(userId);
      return;
    }

    if (connected === true) requestTargetedFxSync(runtime);
  };

  const deleteUser = (user) => {
    const userId = String(user?.id ?? "").trim();
    if (!userId) return;

    reconcileTargetedFxUser(runtime, userId, []);
    void clearTargetedFxReminderIfInactive(runtime);
    runtime.__targetedFxSyncPending?.userIds?.delete?.(userId);
    runtime.__targetedFxSyncMisses?.delete?.(userId);
  };

  runtime.__targetedFxSyncHookRegistrations = [
    ["userConnected", hooks.on("userConnected", userConnected)],
    ["deleteUser", hooks.on("deleteUser", deleteUser)]
  ];
  runtime.__targetedFxSyncHooksRegistered = true;
  return true;
}

export function startTargetedFxSync(runtime, options = {}) {
  if (!runtime) return false;

  stopTargetedFxSync(runtime);
  if (globalThis.game?.user?.isGM !== true) return false;

  const requestedMs = Number(options.intervalMs);
  const intervalMs = Number.isFinite(requestedMs)
    ? Math.max(1_000, requestedMs)
    : DEFAULT_TARGETED_FX_SYNC_SECONDS * 1000;

  requestTargetedFxSync(runtime);

  const timer = setInterval(() => requestTargetedFxSync(runtime), intervalMs);
  timer?.unref?.();
  runtime.__targetedFxSyncTimer = timer;
  runtime.__targetedFxSyncIntervalMs = intervalMs;
  return true;
}
