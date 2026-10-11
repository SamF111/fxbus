// D:\FoundryVTT\Data\modules\fxbus\scripts\audience.js

function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

/**
 * Normalize the optional recipient selector carried by an FX Bus packet.
 *
 * Compatibility contract:
 * - An omitted audience means everyone.
 * - An empty userIds array also means everyone.
 * - A non-empty userIds array targets those Foundry user ids.
 * - Malformed selectors throw so callers can reject them instead of accidentally
 *   turning them into a broadcast.
 */
export function normalizeFxAudience(audience) {
  if (audience === undefined) return { userIds: [] };

  if (!isPlainObject(audience) || !Array.isArray(audience.userIds)) {
    throw new TypeError("[FX Bus] audience.userIds must be an array.");
  }

  const userIds = [];
  const seen = new Set();

  for (const value of audience.userIds) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new TypeError("[FX Bus] audience.userIds must contain only non-empty strings.");
    }

    const userId = value.trim();
    if (seen.has(userId)) continue;

    seen.add(userId);
    userIds.push(userId);
  }

  return { userIds };
}

/**
 * Return whether an audience includes the current Foundry user.
 *
 * This deliberately delegates validation to normalizeFxAudience(). A malformed
 * selector therefore never matches by accident.
 */
export function matchesFxAudience(audience, currentUserId) {
  const { userIds } = normalizeFxAudience(audience);

  if (userIds.length === 0) return true;
  if (typeof currentUserId !== "string" || currentUserId.trim().length === 0) return false;

  return userIds.includes(currentUserId.trim());
}