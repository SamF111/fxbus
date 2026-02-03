/**
 * FX Bus - Action keys (public contract)
 *
 * Rules:
 * - Keys are stable once released.
 * - Semantics are stable once released.
 * - Add new keys; never repurpose existing keys.
 */

export const ACTIONS = Object.freeze({
  TOKEN_OSC_START: "tokenOscStart",
  TOKEN_OSC_UPDATE: "tokenOscUpdate",
  TOKEN_OSC_STOP: "tokenOscStop",

  SCREEN_SHAKE_START: "screenShakeStart",
  SCREEN_SHAKE_STOP: "screenShakeStop"
});
