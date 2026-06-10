// D:\FoundryVTT\Data\modules\fxbus\scripts\socket.js

/**
 * FX Bus (Foundry VTT v12+)
 * Socket registration + message dispatch.
 *
 * Key facts:
 * - Use "module.<id>" for module sockets.
 * - The emitting client does NOT receive the broadcast.
 * - Therefore: when you emit, also dispatch locally.
 *
 * Trust policy:
 * - GM packets are accepted.
 * - Assistant packets are accepted.
 * - Trusted player packets are accepted.
 * - Normal player packets are rejected on receipt.
 * - Rejected packets show a warning on the receiving client.
 *
 * Provenance:
 * - Messages may contain __fxbus metadata added by the runtime emitter.
 * - This file logs sender attribution on receipt, rejection, and dispatch errors.
 *
 * Security note:
 * - This is a receiver-side policy gate for normal Foundry users.
 * - It is not cryptographic protection against a malicious client deliberately
 *   forging payload metadata.
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

function getTrustedRoleValue() {
  /**
   * Large comment:
   * Resolve Foundry's Trusted role value without hardcoding where possible.
   *
   * Foundry's usual role order is:
   * - NONE = 0
   * - PLAYER = 1
   * - TRUSTED = 2
   * - ASSISTANT = 3
   * - GAMEMASTER = 4
   *
   * Using TRUSTED as the minimum allowed role automatically permits Assistant
   * and GM users as well.
   */
  const trusted = globalThis.CONST?.USER_ROLES?.TRUSTED;
  return Number.isFinite(trusted) ? trusted : 2;
}

function getUserRole(user) {
  /**
   * Large comment:
   * Read a Foundry user role defensively across likely data shapes.
   * Current Foundry normally exposes user.role directly, but this helper avoids
   * fragile assumptions if the object shape differs.
   */
  const role =
    user?.role ??
    user?.data?.role ??
    user?.system?.role ??
    null;

  const n = Number(role);
  return Number.isFinite(n) ? n : null;
}

function getSenderUser(message) {
  /**
   * Large comment:
   * Resolve the Foundry User object that sent this FX Bus packet.
   *
   * FX Bus runtime.emit() adds __fxbus.userId before broadcasting.
   * If that metadata is absent or does not resolve to a real user, the packet
   * is treated as untrusted and rejected.
   */
  const senderId = message?.__fxbus?.userId;

  if (typeof senderId !== "string" || senderId.trim().length === 0) {
    return null;
  }

  return game.users?.get?.(senderId) ?? null;
}

function isTrustedFxBusSender(message) {
  /**
   * Large comment:
   * Decide whether a received FX Bus socket packet is allowed to dispatch.
   *
   * Allowed:
   * - GM
   * - Assistant
   * - Trusted player
   *
   * Rejected:
   * - Normal player
   * - No-access user
   * - Missing sender metadata
   * - Unknown sender id
   * - Malformed sender role
   */
  const sender = getSenderUser(message);
  if (!sender) return false;

  if (sender.isGM === true) return true;

  const role = getUserRole(sender);
  if (role === null) return false;

  return role >= getTrustedRoleValue();
}

function getReadableSenderRole(user) {
  /**
   * Large comment:
   * Convert a Foundry role number into a readable label for logs and warnings.
   */
  if (!user) return "Unknown";

  if (user.isGM === true) return "GM";

  const role = getUserRole(user);

  switch (role) {
    case 0:
      return "None";
    case 1:
      return "Player";
    case 2:
      return "Trusted";
    case 3:
      return "Assistant";
    case 4:
      return "GM";
    default:
      return role === null ? "Unknown" : `Role ${role}`;
  }
}

function logMessageProvenance(prefix, message) {
  try {
    const meta = message?.__fxbus;
    const action = message?.action;

    if (!meta) return;

    const sender = getSenderUser(message);
    const who = meta.userName ?? sender?.name ?? meta.userId ?? "unknown";
    const role = getReadableSenderRole(sender);
    const ts = Number.isFinite(meta.ts) ? new Date(meta.ts).toISOString() : null;

    if (ts) {
      console.log(`[FX Bus] ${prefix}`, { action, from: who, role, ts });
    } else {
      console.log(`[FX Bus] ${prefix}`, { action, from: who, role });
    }
  } catch {
    // ignore
  }
}

function warnRejectedPayload(message) {
  /**
   * Large comment:
   * Warn when a received FX Bus payload is rejected by the trust policy.
   *
   * This is intentionally visible through ui.notifications so normal-player
   * macro attempts are not silent. The warning appears on clients that receive
   * and reject the packet.
   */
  const sender = getSenderUser(message);
  const meta = message?.__fxbus;

  const action =
    typeof message?.action === "string" && message.action.trim().length
      ? message.action
      : "unknown action";

  const userName =
    String(meta?.userName ?? sender?.name ?? meta?.userId ?? "unknown user").trim() ||
    "unknown user";

  const role = getReadableSenderRole(sender);

  console.warn("[FX Bus] rejected untrusted socket payload", {
    action,
    userId: meta?.userId ?? null,
    userName,
    role,
    requiredMinimumRole: "Trusted"
  });

  ui.notifications?.warn?.(
    `FX Bus rejected '${action}' from ${userName} (${role}): sender must be Trusted, Assistant, or GM.`
  );
}

export function dispatchFx(runtime, message) {
  try {
    if (!isPlainObject(message)) return;

    const action = message.action;
    if (typeof action !== "string" || action.trim().length === 0) return;

    const handler = runtime.handlers.get(action);
    if (typeof handler !== "function") return;

    handler(message);
  } catch (err) {
    try {
      logMessageProvenance("dispatch error", message);
    } catch {
      // ignore
    }

    console.error("[FX Bus] Local dispatch error:", err);
  }
}

export function registerFxSocket(runtime) {
  if (!runtime || !runtime.socketName || !runtime.handlers) {
    throw new Error("[FX Bus] registerFxSocket: invalid runtime.");
  }

  const socket = game.socket;
  if (!socket) {
    console.warn("[FX Bus] game.socket unavailable. FX Bus will not receive messages.");
    return;
  }

  if (runtime.__socketRegistered) return;
  runtime.__socketRegistered = true;

  socket.on(runtime.socketName, (message) => {
    try {
      if (!isPlainObject(message)) return;

      // Receiver-side provenance log: who triggered this FX.
      logMessageProvenance("recv", message);

      if (!isTrustedFxBusSender(message)) {
        warnRejectedPayload(message);
        return;
      }

      dispatchFx(runtime, message);
    } catch (err) {
      try {
        logMessageProvenance("socket error", message);
      } catch {
        // ignore
      }

      console.error("[FX Bus] Socket dispatch error:", err);
    }
  });
}

/**
 * Emit to other clients AND apply locally on the emitter.
 *
 * @param {object} runtime
 * @param {object} payload
 */
export function emitFx(runtime, payload) {
  if (!runtime?.socketName) throw new Error("[FX Bus] emitFx: invalid runtime.");
  if (!isPlainObject(payload)) throw new Error("[FX Bus] emitFx: payload must be an object.");

  dispatchFx(runtime, payload);
  return game.socket.emit(runtime.socketName, payload);
}