/**
 * FX Bus (Foundry VTT v12+)
 * Client-side listener entrypoint.
 *
 * Responsibilities:
 * - Ensure a single global runtime instance exists on every client.
 * - Register the FX socket listener on ready.
 * - Register built-in effect handlers (oscillation + screen shake).
 * - Provide a single emit surface that applies locally then broadcasts.
 *
 * Constraints:
 * - Visual-only. No document updates. No token persistence.
 * - Effects must snapshot and restore render transforms exactly.
 */

import { registerFxSocket } from "./socket.js";
import { registerBuiltInEffects } from "./effects/index.js";

const RUNTIME_KEY = "fxbus";

function getOrCreateRuntime() {
  if (globalThis[RUNTIME_KEY]) return globalThis[RUNTIME_KEY];

  const runtime = {
    id: "fxbus",
    version: "0.1.0",
    socketName: "module.fxbus",

    tickers: new Map(),  // Map(effectName -> tickerFn)
    tokenFx: new Map(),  // Map(effectName -> Map(tokenId -> state))
    screenFx: new Map(), // Map(effectName -> state)

    handlers: new Map(), // Map(action -> (payload) => void)

    /**
     * Emit an FX message:
     * - Apply locally (emitter does not receive its own socket broadcast).
     * - Broadcast to all other connected clients.
     *
     * @param {object} payload
     */
    emit(payload) {
      const action = payload?.action;
      const handler = this.handlers.get(action);
      if (typeof handler === "function") handler(payload);

      game.socket.emit(this.socketName, payload);
    }
  };

  globalThis[RUNTIME_KEY] = runtime;
  return runtime;
}

Hooks.once("init", () => {
  getOrCreateRuntime();
});

Hooks.once("ready", () => {
  const runtime = getOrCreateRuntime();

  registerBuiltInEffects(runtime);
  registerFxSocket(runtime);

  console.log(`[FX Bus] Ready. Socket: ${runtime.socketName}. Handlers: ${runtime.handlers.size}.`);
});
