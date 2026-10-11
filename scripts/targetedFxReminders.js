// D:\FoundryVTT\Data\modules\fxbus\scripts\targetedFxReminders.js

import { getActiveTargetedFx } from "./targetedFxLedger.js";

export const DEFAULT_TARGETED_FX_REMINDER_SECONDS = 30;

const REMINDER_FLAG = "targetedFxReminder";
const REMINDER_PREFIX = "Targeted FX reminder:";

function formatDuration(totalMs) {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function userName(userId) {
  const user = globalThis.game?.users?.get?.(userId);
  const name = String(user?.name ?? "").trim();
  return name || userId;
}

function groupEntries(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const key = `${entry.effectKey}|${entry.userId}`;
    let group = groups.get(key);

    if (!group) {
      group = {
        effectKey: entry.effectKey,
        effectLabel: entry.effectLabel,
        userId: entry.userId,
        startedAt: entry.startedAt,
        resources: new Set(),
        hasIndefinite: false,
        nearestExpiry: null
      };
      groups.set(key, group);
    }

    group.startedAt = Math.min(group.startedAt, entry.startedAt);
    group.resources.add(entry.resourceId);

    if (entry.expiresAt === null) {
      group.hasIndefinite = true;
    } else if (group.nearestExpiry === null) {
      group.nearestExpiry = entry.expiresAt;
    } else {
      group.nearestExpiry = Math.min(group.nearestExpiry, entry.expiresAt);
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const effectOrder = a.effectLabel.localeCompare(b.effectLabel);
    if (effectOrder !== 0) return effectOrder;
    return userName(a.userId).localeCompare(userName(b.userId));
  });
}

function reminderGroups(runtime, now) {
  return groupEntries(getActiveTargetedFx(runtime, now));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function groupDisplayDetails(group, now) {
  const details = [
    userName(group.userId),
    `Active for ${formatDuration(now - group.startedAt)}`,
    group.hasIndefinite
      ? "Until stopped"
      : `${formatDuration(group.nearestExpiry - now)} remaining`
  ];
  const resourceCount = group.resources.size;

  if (resourceCount > 1) details.push(`${resourceCount} targets`);
  return details;
}

function messageValues() {
  const messages = globalThis.game?.messages;
  if (Array.isArray(messages?.contents)) return messages.contents;
  if (typeof messages?.values === "function") return Array.from(messages.values());
  if (Array.isArray(messages)) return messages;
  return [];
}

function reminderFlag(message) {
  const direct = message?.flags?.fxbus?.[REMINDER_FLAG];
  if (direct !== undefined) return direct;

  try {
    return message?.getFlag?.("fxbus", REMINDER_FLAG);
  } catch {
    return undefined;
  }
}

function isCurrentGmReminder(message, userId) {
  const flag = reminderFlag(message);
  if (flag && typeof flag === "object") {
    return String(flag.recipientUserId ?? "") === userId;
  }

  const whisper = Array.from(message?.whisper ?? [], (id) => String(id));
  return whisper.includes(userId) &&
    String(message?.speaker?.alias ?? "") === "FX Bus" &&
    String(message?.content ?? "").includes(REMINDER_PREFIX);
}

async function deleteOutdatedGmReminders(userId, keepMessageId) {
  const outdated = messageValues().filter((message) => {
    const messageId = String(message?.id ?? message?._id ?? "");
    return messageId !== String(keepMessageId ?? "") &&
      isCurrentGmReminder(message, userId);
  });

  await Promise.all(outdated.map(async (message) => {
    if (typeof message?.delete !== "function") return;

    try {
      await message.delete();
    } catch (error) {
      console.warn("[FX Bus] outdated targeted reminder cleanup failed", error);
    }
  }));
}

export async function clearTargetedFxReminderIfInactive(runtime) {
  if (globalThis.game?.user?.isGM !== true) return false;
  if (getActiveTargetedFx(runtime).length > 0) return false;

  const userId = String(
    globalThis.game?.user?.id ?? globalThis.game?.userId ?? ""
  ).trim();
  if (!userId) return false;

  await deleteOutdatedGmReminders(userId);
  return true;
}

function notifyCurrentGm(message, content = message) {
  const userId = String(
    globalThis.game?.user?.id ?? globalThis.game?.userId ?? ""
  ).trim();
  const createChatMessage = globalThis.ChatMessage?.create;

  if (userId && typeof createChatMessage === "function") {
    try {
      const result = createChatMessage.call(globalThis.ChatMessage, {
        content,
        flags: {
          fxbus: {
            [REMINDER_FLAG]: { recipientUserId: userId }
          }
        },
        speaker: { alias: "FX Bus" },
        whisper: [userId]
      });

      Promise.resolve(result)
        .then((created) => deleteOutdatedGmReminders(userId, created?.id ?? created?._id))
        .catch((error) => {
          console.warn("[FX Bus] targeted reminder whisper failed", error);
          globalThis.ui?.notifications?.info?.(message, { permanent: false });
        });
      return;
    } catch (error) {
      console.warn("[FX Bus] targeted reminder whisper failed", error);
    }
  }

  globalThis.ui?.notifications?.info?.(message, { permanent: false });
}

export function buildTargetedFxReminder(runtime, now = Date.now()) {
  const groups = reminderGroups(runtime, now);
  if (groups.length === 0) return null;

  const summaries = groups.map((group) => {
    const elapsed = formatDuration(now - group.startedAt);
    const resourceCount = group.resources.size;
    const resourceText = resourceCount > 1 ? `, ${resourceCount} targets` : "";
    const lifetimeText = group.hasIndefinite
      ? "until stopped"
      : `${formatDuration(group.nearestExpiry - now)} remaining`;

    return `${group.effectLabel} → ${userName(group.userId)} ` +
      `(active ${elapsed}, ${lifetimeText}${resourceText})`;
  });

  return `Targeted FX reminder: ${summaries.join("; ")}.`;
}

export function buildTargetedFxReminderContent(runtime, now = Date.now()) {
  const groups = reminderGroups(runtime, now);
  if (groups.length === 0) return null;

  const rows = groups.map((group) => {
    const effectLabel = escapeHtml(group.effectLabel);
    const details = groupDisplayDetails(group, now)
      .map((detail) => escapeHtml(detail))
      .join(" · ");

    return `<div class="fxbus-reminder-effect">` +
      `<div class="fxbus-reminder-effect-name">${effectLabel}</div>` +
      `<div class="fxbus-reminder-effect-meta">${details}</div>` +
      `</div>`;
  }).join("");

  const count = groups.length;
  const countLabel = `${count} active`;

  return `<section class="fxbus-targeted-reminder" aria-label="Targeted FX reminder">` +
    `<div class="fxbus-reminder-summary">` +
    `<span class="fxbus-reminder-count">${countLabel}</span>` +
    `</div>` +
    `<div class="fxbus-reminder-effects">${rows}</div>` +
    `</section>`;
}

export function stopTargetedFxReminders(runtime) {
  if (!runtime) return;

  if (runtime.__targetedFxReminderTimer !== undefined) {
    clearInterval(runtime.__targetedFxReminderTimer);
  }

  runtime.__targetedFxReminderTimer = undefined;
  runtime.__targetedFxReminderIntervalMs = undefined;
}

export function startTargetedFxReminders(runtime, options = {}) {
  if (!runtime) return false;

  stopTargetedFxReminders(runtime);
  if (globalThis.game?.user?.isGM !== true) return false;

  const requestedMs = Number(options.intervalMs);
  const intervalMs = Number.isFinite(requestedMs)
    ? Math.max(0, requestedMs)
    : DEFAULT_TARGETED_FX_REMINDER_SECONDS * 1000;

  if (intervalMs === 0) return false;

  const notify = () => {
    if (globalThis.game?.user?.isGM !== true) {
      stopTargetedFxReminders(runtime);
      return;
    }

    const now = Date.now();
    const message = buildTargetedFxReminder(runtime, now);
    if (!message) {
      void clearTargetedFxReminderIfInactive(runtime);
      return;
    }

    notifyCurrentGm(
      message,
      buildTargetedFxReminderContent(runtime, now) ?? message
    );
  };

  const timer = setInterval(notify, intervalMs);
  timer?.unref?.();

  runtime.__targetedFxReminderTimer = timer;
  runtime.__targetedFxReminderIntervalMs = intervalMs;
  return true;
}

export function restartTargetedFxReminders(runtime, intervalSeconds) {
  const seconds = Number(intervalSeconds);
  const safeSeconds = Number.isFinite(seconds)
    ? Math.max(0, seconds)
    : DEFAULT_TARGETED_FX_REMINDER_SECONDS;

  return startTargetedFxReminders(runtime, { intervalMs: safeSeconds * 1000 });
}
