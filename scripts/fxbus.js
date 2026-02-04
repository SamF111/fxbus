/**
 * FX Bus (Foundry VTT v12+ / v13)
 * Client-side listener entrypoint.
 *
 * Guarantees:
 * - globalThis.fxbus exists from init.
 * - globalThis.fxbus.emit exists from init.
 * - UI state is persisted per-client.
 *
 * Toolbar injection:
 * - getSceneControlButtons fires during UI controls construction.
 * - Register the hook by setup at the latest (init is also fine).
 * - Force a controls re-render on ready so the bolt appears without a full reload.
 */

import { registerFxSocket } from "./socket.js";
import { registerBuiltInEffects } from "./effects/index.js";
import { registerFxBusSceneControls } from "./ui/controls.js";

const MODULE_ID = "fxbus";
const RUNTIME_KEY = "fxbus";
const SOCKET_NAME = "module.fxbus";

function getOrCreateRuntime() {
  /** Large comment:
   * Create the shared runtime once and expose it at globalThis.fxbus.
   * emit() always:
   * - applies locally if a handler exists
   * - broadcasts to other clients via game.socket
   */
  if (globalThis[RUNTIME_KEY]) return globalThis[RUNTIME_KEY];

  const runtime = {
    id: MODULE_ID,
    version: "0.5.0",
    socketName: SOCKET_NAME,

    tickers: new Map(),
    tokenFx: new Map(),
    screenFx: new Map(),
    handlers: new Map(),

    emit(payload) {
      const action = payload?.action;
      if (typeof action !== "string") return;

      const t0 = performance.now();

      try {
        console.log("[FX Bus] emit", {
          action,
          payload: { ...payload },
          socket: runtime.socketName
        });
      } catch {
        console.log("[FX Bus] emit", action);
      }

      const handler = runtime.handlers.get(action);
      if (typeof handler === "function") {
        try {
          handler(payload);
          const dt = Math.round((performance.now() - t0) * 1000) / 1000;
          console.log("[FX Bus] handled", { action, ms: dt });
        } catch (err) {
          console.error("[FX Bus] handler error", { action, err });
        }
      } else {
        console.warn("[FX Bus] no handler", { action });
      }

      try {
        game.socket.emit(runtime.socketName, payload);
        console.log("[FX Bus] broadcast", { action });
      } catch (err) {
        console.error("[FX Bus] socket emit failed", { action, err });
      }
    }
  };

  globalThis[RUNTIME_KEY] = runtime;
  return runtime;
}

/* -------------------------------------------- */
/* INIT                                         */
/* -------------------------------------------- */

Hooks.once("init", () => {
  getOrCreateRuntime();

  game.settings.register(MODULE_ID, "uiState", {
    name: "FX Bus UI State",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Safe to register here; also fine in setup.
  registerFxBusSceneControls();
});

/* -------------------------------------------- */
/* READY                                        */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  const runtime = getOrCreateRuntime();

  registerBuiltInEffects(runtime);
  registerFxSocket(runtime);

  // Ensure the left-toolbar picks up our injected control group immediately.
  try {
    ui.controls.render(true);
  } catch {
    // ignore
  }

  console.log(
    `[FX Bus] Ready | handlers=${runtime.handlers.size} | socket=${runtime.socketName}`
  );
});
