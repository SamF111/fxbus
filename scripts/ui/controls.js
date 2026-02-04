/**
 * FX Bus - Scene Controls (Foundry v13)
 *
 * UX:
 * - One left-toolbar group "FX Bus"
 * - One button per effect: opens panel focused on that tab
 * - One hard reset button: immediately resets all FX
 *
 * Robustness:
 * - Supports both hook payload shapes:
 *   A) Array of controls (canonical)
 *   B) Object map of controls (legacy / module-interference)
 *
 * Foundry v13:
 * - Tools use onChange (not onClick)
 * - Prefer layer: "token" (v13 key)
 */

import { openFxBusGmControlPanel } from "./fxbusPanelApp.js";

export function registerFxBusSceneControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    if (!controls || typeof controls !== "object") return;

    function clearActiveToolSoon() {
      queueMicrotask(() => {
        try {
          ui.controls.render({ tool: null });
        } catch {
          // ignore
        }
      });
    }

    function openTab(startTab) {
      openFxBusGmControlPanel({ startTab });
      clearActiveToolSoon();
    }

    function resetAll() {
      const runtime = globalThis.fxbus;
      if (!runtime?.emit) return;
      runtime.emit({ action: "fx.bus.reset" });
      clearActiveToolSoon();
    }

    const fxbusControlAsArrayShape = {
      name: "fxbus",
      title: "FX Bus",
      icon: "fas fa-bolt",
      layer: "token",
      visible: true,
      tools: [
        {
          name: "fxbus-osc",
          title: "Token Oscillation",
          icon: "fas fa-ship",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("osc");
          }
        },
        {
          name: "fxbus-shake",
          title: "Screen Shake",
          icon: "fas fa-wave-square",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("shake");
          }
        },
        {
          name: "fxbus-pulse",
          title: "Screen Pulse",
          icon: "fas fa-exclamation-triangle",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("pulse");
          }
        },
        {
          name: "fxbus-vignette",
          title: "Vignette",
          icon: "fas fa-circle",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("vignette");
          }
        },
        {
          name: "fxbus-chromab",
          title: "Chromatic Aberration",
          icon: "fas fa-adjust",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("chromab");
          }
        },
        {
          name: "fxbus-noise",
          title: "Screen Noise",
          icon: "fas fa-braille",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("noise");
          }
        },
        {
          name: "fxbus-blur",
          title: "Screen Blur",
          icon: "fas fa-eye-slash",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("blur");
          }
        },
        {
          name: "fxbus-smear",
          title: "Screen Smear",
          icon: "fas fa-water",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("smear");
          }
        },
        {
          name: "fxbus-streak",
          title: "Screen Streak",
          icon: "fas fa-wind",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("streak");
          }
        },
        {
          name: "fxbus-reset",
          title: "Reset All FX",
          icon: "fas fa-ban",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            resetAll();
          }
        }
      ]
    };

    // A) Canonical: Array of controls
    if (Array.isArray(controls)) {
      if (controls.some((c) => c?.name === "fxbus")) return;
      controls.push(fxbusControlAsArrayShape);
      console.log("[FX Bus] Injected FX Bus left-toolbar buttons (array).");
      return;
    }

    // B) Legacy / altered: object map of controls
    if (controls.fxbus) return;

    controls.fxbus = {
      name: "fxbus",
      title: "FX Bus",
      icon: "fas fa-bolt",
      layer: "token",
      visible: true,
      tools: {
        "fxbus-osc": {
          name: "fxbus-osc",
          title: "Token Oscillation",
          icon: "fas fa-ship",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("osc");
          }
        },
        "fxbus-shake": {
          name: "fxbus-shake",
          title: "Screen Shake",
          icon: "fas fa-wave-square",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("shake");
          }
        },
        "fxbus-pulse": {
          name: "fxbus-pulse",
          title: "Screen Pulse",
          icon: "fas fa-exclamation-triangle",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("pulse");
          }
        },
        "fxbus-vignette": {
          name: "fxbus-vignette",
          title: "Vignette",
          icon: "fas fa-circle",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("vignette");
          }
        },
        "fxbus-chromab": {
          name: "fxbus-chromab",
          title: "Chromatic Aberration",
          icon: "fas fa-adjust",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("chromab");
          }
        },
        "fxbus-noise": {
          name: "fxbus-noise",
          title: "Screen Noise",
          icon: "fas fa-braille",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("noise");
          }
        },
        "fxbus-blur": {
          name: "fxbus-blur",
          title: "Screen Blur",
          icon: "fas fa-eye-slash",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("blur");
          }
        },
        "fxbus-smear": {
          name: "fxbus-smear",
          title: "Screen Smear",
          icon: "fas fa-water",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("smear");
          }
        },
        "fxbus-streak": {
          name: "fxbus-streak",
          title: "Screen Streak",
          icon: "fas fa-wind",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            openTab("streak");
          }
        },
        "fxbus-reset": {
          name: "fxbus-reset",
          title: "Reset All FX",
          icon: "fas fa-ban",
          button: true,
          visible: true,
          toggle: false,
          onChange: (_event, active) => {
            if (!active) return;
            resetAll();
          }
        }
      }
    };

    console.log("[FX Bus] Injected FX Bus left-toolbar buttons (object).");
  });
}
