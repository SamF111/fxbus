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

import { matchesFxAudience, normalizeFxAudience } from "./audience.js";
import {
  getLocalTargetedFxSnapshot,
  observeLocalTargetedFxMessage,
  observeTargetedFxMessage,
  reconcileTargetedFxUser
} from "./targetedFxLedger.js";
import {
  acknowledgeTargetedFxMessage,
  handleTargetedFxSyncMessage,
  isTargetedFxSyncAction
} from "./targetedFxSync.js";
import { clearTargetedFxReminderIfInactive } from "./targetedFxReminders.js";
import {
  getFxSuppressionReason,
  warnFxSuppressed
} from "./photosensitive.js";

const ACTION_GLOBAL_RESET = "fx.bus.reset";
let outboundMessageSequence = 0;

function nextOutboundMessageId() {
  outboundMessageSequence += 1;
  return `${Date.now().toString(36)}-${outboundMessageSequence.toString(36)}`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

export function enrichFxBusPayload(payload) {
  /**
   * Attach trusted-source provenance to an outbound FX Bus payload.
   *
   * Always replace caller-supplied __fxbus data so normal emission paths cannot
   * accidentally retain stale attribution from a copied or replayed packet.
   */
  if (!isPlainObject(payload)) {
    throw new Error("[FX Bus] payload must be an object.");
  }

  return {
    ...payload,
    __fxbus: {
      userId: game.userId ?? game.user?.id,
      userName: game.user?.name,
      isGM: game.user?.isGM === true,
      role: getUserRole(game.user),
      ts: Date.now(),
      messageId: nextOutboundMessageId()
    }
  };
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

export function isTrustedFxBusUser(user) {
  if (!user) return false;
  if (user.isGM === true) return true;

  const role = getUserRole(user);
  if (role === null) return false;

  return role >= getTrustedRoleValue();
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
  return isTrustedFxBusUser(sender);
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

function warnInvalidAudience(message, err) {
  const action =
    typeof message?.action === "string" && message.action.trim().length
      ? message.action
      : "unknown action";

  console.warn("[FX Bus] rejected malformed audience", {
    action,
    audience: message?.audience,
    error: err
  });

  globalThis.ui?.notifications?.warn?.(
    `FX Bus rejected '${action}': audience.userIds must be an array of non-empty user IDs.`
  );
}

function reconcileSuppressedGmState(runtime) {
  // A GM can target their own client. Socket acknowledgements do not loop back
  // to the emitter, so reconcile the reminder ledger directly with the state
  // which is actually running locally.
  if (globalThis.game?.user?.isGM !== true) return;

  const userId = globalThis.game?.userId ?? globalThis.game?.user?.id;
  if (!userId) return;

  reconcileTargetedFxUser(
    runtime,
    userId,
    getLocalTargetedFxSnapshot(runtime)
  );
  void clearTargetedFxReminderIfInactive(runtime);
}

export function validateFxMessageAudience(message) {
  // Global reset is intentionally unaddressed. Even a copied reset macro that
  // carries stale or malformed audience data must restore every client.
  if (message?.action === ACTION_GLOBAL_RESET) return true;

  try {
    normalizeFxAudience(message?.audience);
    return true;
  } catch (err) {
    warnInvalidAudience(message, err);
    return false;
  }
}

function warnUnavailableAudienceRecipients(message, unavailable) {
  const action =
    typeof message?.action === "string" && message.action.trim().length
      ? message.action
      : "unknown action";
  const details = unavailable.map(({ id, name, reason }) =>
    reason === "deleted" ? `${id} (deleted)` : `${name || id} (offline)`
  );

  console.warn("[FX Bus] targeted emit blocked for unavailable recipients", {
    action,
    unavailable
  });

  globalThis.ui?.notifications?.warn?.(
    `FX Bus did not send '${action}': unavailable recipient${details.length === 1 ? "" : "s"}: ${details.join(", ")}.`
  );
}

export function validateOutboundFxAudienceRecipients(message) {
  /**
   * Block targeted outbound packets when any selected world user cannot receive
   * them. This runs only on the emitting client; receivers still match their own
   * user id normally.
   *
   * Compatibility contract:
   * - Global Reset always emits.
   * - Omitted or empty audiences still mean Everyone.
   * - Existing targeted macros become usable again as soon as all recipients
   *   reconnect.
   */
  if (message?.action === ACTION_GLOBAL_RESET) return true;

  const { userIds } = normalizeFxAudience(message?.audience);
  if (userIds.length === 0) return true;

  const unavailable = [];

  for (const userId of userIds) {
    const user = globalThis.game?.users?.get?.(userId) ?? null;

    if (!user) {
      unavailable.push({ id: userId, name: userId, reason: "deleted" });
    } else if (user.active !== true) {
      unavailable.push({
        id: userId,
        name: String(user.name ?? userId),
        reason: "offline"
      });
    }
  }

  if (unavailable.length === 0) return true;

  warnUnavailableAudienceRecipients(message, unavailable);
  return false;
}

export function shouldApplyFxMessage(message) {
  if (message?.action === ACTION_GLOBAL_RESET) return true;
  if (!validateFxMessageAudience(message)) return false;

  const currentUserId = globalThis.game?.userId ?? globalThis.game?.user?.id;
  return matchesFxAudience(message?.audience, currentUserId);
}

export function dispatchFx(runtime, message) {
  try {
    if (!isPlainObject(message)) return false;

    const action = message.action;
    if (typeof action !== "string" || action.trim().length === 0) return false;

    if (!shouldApplyFxMessage(message)) return false;

    const suppressionReason = getFxSuppressionReason(message);
    if (suppressionReason) {
      warnFxSuppressed(message, suppressionReason);
      reconcileSuppressedGmState(runtime);
      return false;
    }

    const handler = runtime.handlers.get(action);
    if (typeof handler !== "function") return false;

    handler(message);
    observeLocalTargetedFxMessage(
      runtime,
      message,
      globalThis.game?.userId ?? globalThis.game?.user?.id
    );
    return true;
  } catch (err) {
    try {
      logMessageProvenance("dispatch error", message);
    } catch {
      // ignore
    }

    console.error("[FX Bus] Local dispatch error:", err);
    return false;
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

      // Sync responses are valid from ordinary players and are handled by a
      // narrow control-packet validator rather than the FX trust gate.
      if (isTargetedFxSyncAction(message.action)) {
        handleTargetedFxSyncMessage(runtime, message);
        return;
      }

      if (!isTrustedFxBusSender(message)) {
        warnRejectedPayload(message);
        return;
      }

      if (!validateFxMessageAudience(message)) return;

      observeTargetedFxMessage(runtime, message);
      void clearTargetedFxReminderIfInactive(runtime);
      const applied = dispatchFx(runtime, message);
      acknowledgeTargetedFxMessage(runtime, message, applied ? "applied" : "failed");
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

  // Current runtimes own logging, trust warnings, local dispatch, and socket
  // emission. Delegate whenever possible so this compatibility helper cannot
  // drift from the public runtime API again.
  if (typeof runtime.emit === "function") {
    return runtime.emit(payload);
  }

  if (!validateFxMessageAudience(payload)) return;
  if (!validateOutboundFxAudienceRecipients(payload)) return;

  // Older runtime shapes may not expose emit(). Preserve their helper contract
  // while supplying the provenance now required by the receiver trust gate.
  const enriched = enrichFxBusPayload(payload);

  observeTargetedFxMessage(runtime, enriched);
  void clearTargetedFxReminderIfInactive(runtime);

  if (isTrustedFxBusUser(game.user)) {
    dispatchFx(runtime, enriched);
  }

  return game.socket.emit(runtime.socketName, enriched);
}
