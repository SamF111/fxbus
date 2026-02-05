// D:\FoundryVTT\Data\modules\fxbus\scripts\fxbus.js

/**
 * FX Bus (Foundry VTT v13)
 * Client-side listener entrypoint.
 *
 * Guarantees:
 * - globalThis.fxbus exists from init.
 * - globalThis.fxbus.emit exists from init.
 * - UI state is persisted per-client.
 *
 * Toolbar injection:
 * - Uses getSceneControlButtons during UI controls construction.
 * - Registers the hook on init (setup would also work).
 * - Does not force a controls re-render (avoids cross-module control-state races).
 *
 * Provenance:
 * - emit() enriches outgoing payloads with __fxbus sender metadata (userId, userName, isGM, ts).
 * - Handlers receive the enriched payload.
 * - Broadcast uses the enriched payload so receivers can log sender identity.
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
   *
   * emit() also:
   * - enriches payloads with sender metadata under __fxbus
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

      const enriched = {
        ...payload,
        __fxbus: {
          userId: game.userId,
          userName: game.user?.name,
          isGM: game.user?.isGM === true,
          ts: Date.now()
        }
      };

      try {
        console.log("[FX Bus] emit", {
          action,
          from: enriched.__fxbus,
          payload: { ...enriched },
          socket: runtime.socketName
        });
      } catch {
        console.log("[FX Bus] emit", action);
      }

      const handler = runtime.handlers.get(action);
      if (typeof handler === "function") {
        try {
          handler(enriched);
          const dt = Math.round((performance.now() - t0) * 1000) / 1000;
          console.log("[FX Bus] handled", { action, ms: dt, from: enriched.__fxbus });
        } catch (err) {
          console.error("[FX Bus] handler error", { action, err, from: enriched.__fxbus });
        }
      } else {
        console.warn("[FX Bus] no handler", { action, from: enriched.__fxbus });
      }

      try {
        game.socket.emit(runtime.socketName, enriched);
        console.log("[FX Bus] broadcast", { action, from: enriched.__fxbus });
      } catch (err) {
        console.error("[FX Bus] socket emit failed", { action, err, from: enriched.__fxbus });
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

  registerFxBusSceneControls();
});

/* -------------------------------------------- */
/* READY                                        */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  const runtime = getOrCreateRuntime();

  registerBuiltInEffects(runtime);
  registerFxSocket(runtime);

  console.log(
    `[FX Bus] Ready | handlers=${runtime.handlers.size} | socket=${runtime.socketName}`
  );
});
