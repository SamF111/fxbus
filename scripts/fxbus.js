/**
 * FX Bus (Foundry VTT v12+ / v13)
 * Client-side listener entrypoint.
 *
 * Guarantees:
 * - globalThis.fxbus exists from init.
 * - globalThis.fxbus.emit exists from init.
 * - UI state is persisted per-client.
 */

import { registerFxSocket } from "./socket.js";
import { registerBuiltInEffects } from "./effects/index.js";
import { registerFxBusSceneControls } from "./ui/controls.js";

const RUNTIME_KEY = "fxbus";

function getOrCreateRuntime() {
  if (globalThis[RUNTIME_KEY]) return globalThis[RUNTIME_KEY];

  const runtime = {
    id: "fxbus",
    version: "0.2.0",
    socketName: "module.fxbus",

    tickers: new Map(),
    tokenFx: new Map(),
    screenFx: new Map(),
    handlers: new Map(),

	emit(payload) {
	  const action = payload?.action;
	  if (typeof action !== "string") return;

	  const t0 = performance.now();

	  // Log outgoing intent (GM-side control surface)
	  try {
		console.log("[FX Bus] emit", {
		  action,
		  payload: { ...payload },
		  socket: runtime.socketName
		});
	  } catch {
		console.log("[FX Bus] emit", action);
	  }

	  // Local apply
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

	  // Broadcast to other clients
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
  // Ensure runtime exists immediately
  getOrCreateRuntime();

  // Register per-client UI persistence
  game.settings.register("fxbus", "uiState", {
    name: "FX Bus UI State",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  // Register left-toolbar controls
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
