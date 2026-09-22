// D:\FoundryVTT\Data\modules\fxbus\scripts\localFxPreference.js

import { dispatchFx } from "./socket.js";
import {
  LOCAL_FX_DISABLED_SETTING,
  REDUCED_MOTION_QUERY,
  REDUCED_MOTION_SETTING_NAME,
  REDUCED_MOTION_SETTINGS_PATH,
  RESPECT_REDUCED_MOTION_SETTING
} from "./photosensitive.js";

const ACTION_GLOBAL_RESET = "fx.bus.reset";

/**
 * Register a client-only opt-out available to every Foundry user.
 *
 * Turning the preference on performs a local Reset immediately. It deliberately
 * calls the dispatcher rather than runtime.emit(), so no socket packet is sent
 * and no other user's effects are changed.
 */
export function registerLocalFxPreference(
  runtime,
  settings = globalThis.game?.settings,
  notifications = globalThis.ui?.notifications,
  windowRef = globalThis.window
) {
  if (!runtime?.id || !settings?.register) return false;

  settings.register(runtime.id, LOCAL_FX_DISABLED_SETTING, {
    name: "Disable FX Bus effects on this client",
    hint: "Immediately clears local FX and suppresses future FX Bus effects on this client. Stop and Reset actions remain available. This does not affect other users.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: (disabled) => {
      const currentNotifications = notifications ?? globalThis.ui?.notifications;

      if (disabled === true) {
        dispatchFx(runtime, { action: ACTION_GLOBAL_RESET });
        currentNotifications?.warn?.("FX Bus effects are now disabled on this client.");
      } else {
        currentNotifications?.info?.("FX Bus effects are now enabled on this client.");
      }
    }
  });

  settings.register(runtime.id, RESPECT_REDUCED_MOTION_SETTING, {
    name: REDUCED_MOTION_SETTING_NAME,
    hint: "Blocks FX Bus effects completely when this browser or device requests reduced motion. Turn this off to allow full FX on this client. Stop and Reset actions remain available; no reduced or lite effects are substituted.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (enabled) => {
      const currentNotifications = notifications ?? globalThis.ui?.notifications;
      const reducedMotionRequested = windowRef
        ?.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;

      if (enabled === true && reducedMotionRequested) {
        dispatchFx(runtime, { action: ACTION_GLOBAL_RESET });
        currentNotifications?.warn?.(
          "FX Bus effects were cleared because this browser reports reduced motion. " +
          `To allow full effects, turn off "${REDUCED_MOTION_SETTING_NAME}" in ` +
          `${REDUCED_MOTION_SETTINGS_PATH}.`
        );
      } else if (enabled === true) {
        currentNotifications?.info?.(
          "FX Bus will respect this client's system reduced-motion preference."
        );
      } else {
        currentNotifications?.info?.(
          "FX Bus will ignore this client's system reduced-motion preference."
        );
      }
    }
  });

  registerReducedMotionListener(runtime, settings, notifications, windowRef);

  return true;
}

export function registerReducedMotionListener(
  runtime,
  settings = globalThis.game?.settings,
  notifications = globalThis.ui?.notifications,
  windowRef = globalThis.window
) {
  if (!runtime || runtime.__reducedMotionListenerRegistered) return false;

  const media = windowRef?.matchMedia?.(REDUCED_MOTION_QUERY);
  if (!media) return false;

  const onChange = (event) => {
    if (event?.matches !== true) return;

    let enabled = false;
    try {
      enabled = settings?.get?.(
        runtime.id,
        RESPECT_REDUCED_MOTION_SETTING
      ) === true;
    } catch {
      return;
    }

    if (!enabled) return;

    dispatchFx(runtime, { action: ACTION_GLOBAL_RESET });
    const currentNotifications = notifications ?? globalThis.ui?.notifications;
    currentNotifications?.warn?.(
      "FX Bus effects were cleared because this browser now reports reduced motion. " +
      `To allow full effects, turn off "${REDUCED_MOTION_SETTING_NAME}" in ` +
      `${REDUCED_MOTION_SETTINGS_PATH}.`
    );
  };

  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", onChange);
  } else if (typeof media.addListener === "function") {
    media.addListener(onChange);
  } else {
    return false;
  }

  runtime.__reducedMotionListenerRegistered = true;
  runtime.__reducedMotionMedia = media;
  runtime.__reducedMotionListener = onChange;
  return true;
}
