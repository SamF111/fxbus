/**
 * FX Bus - Scene Controls (Foundry v13)
 *
 * UX:
 * - One left-toolbar group "FX Bus"
 * - One button per effect: opens panel focused on that tab
 * - One hard reset button: immediately resets all FX
 *
 * Does not hijack token selection.
 */

import { openFxBusGmControlPanel } from "./gmControlPanel.js";

export function registerFxBusSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    if (!controls || typeof controls !== "object" || Array.isArray(controls)) return;
    if (controls.fxbus) return;

    controls.fxbus = {
      name: "fxbus",
      title: "FX Bus",
      icon: "fas fa-bolt",
      layer: "TokenLayer",
      visible: true,
      tools: {
        "fxbus-osc": {
          name: "fxbus-osc",
          title: "Token Oscillation",
          icon: "fas fa-ship",
          button: true,
          visible: true,
          onClick: () => openFxBusGmControlPanel({ startTab: "osc" })
        },
        "fxbus-shake": {
          name: "fxbus-shake",
          title: "Screen Shake",
          icon: "fas fa-wave-square",
          button: true,
          visible: true,
          onClick: () => openFxBusGmControlPanel({ startTab: "shake" })
        },
        "fxbus-pulse": {
          name: "fxbus-pulse",
          title: "Screen Pulse",
          icon: "fas fa-exclamation-triangle",
          button: true,
          visible: true,
          onClick: () => openFxBusGmControlPanel({ startTab: "pulse" })
        },
        "fxbus-vignette": {
          name: "fxbus-vignette",
          title: "Vignette",
          icon: "fas fa-circle",
          button: true,
          visible: true,
          onClick: () => openFxBusGmControlPanel({ startTab: "vignette" })
        },
        "fxbus-reset": {
          name: "fxbus-reset",
          title: "Reset All FX",
          icon: "fas fa-ban",
          button: true,
          visible: true,
          onClick: () => {
            const runtime = globalThis.fxbus;
            if (!runtime?.emit) return;
            runtime.emit({ action: "fx.bus.reset" });
          }
        }
      }
    };

    console.log("[FX Bus] Injected FX Bus left-toolbar buttons.");
  });
}
