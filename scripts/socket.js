/**
 * FX Bus (Foundry VTT v12+)
 * Socket registration + message dispatch.
 *
 * Key facts:
 * - Use "module.<id>" for module sockets.
 * - The emitting client does NOT receive the broadcast.
 * - Therefore: when you emit, also dispatch locally.
 */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && value.constructor === Object;
}

export function dispatchFx(runtime, message) {
  try {
    if (!isPlainObject(message)) return;
    const action = message.action;
    if (typeof action !== "string" || action.trim().length === 0) return;

    const handler = runtime.handlers.get(action);
    if (typeof handler !== "function") return;

    handler(message);
  } catch (err) {
    console.error("[FX Bus] Local dispatch error:", err);
  }
}

export function registerFxSocket(runtime) {
  if (!runtime || !runtime.socketName || !runtime.handlers) {
    throw new Error("[FX Bus] registerFxSocket: invalid runtime.");
  }

  const socket = game.socket;
  if (!socket) {
    console.warn("[FX Bus] game.socket unavailable. FX Bus will not receive messages.");
    return;
  }

  if (runtime.__socketRegistered) return;
  runtime.__socketRegistered = true;

  socket.on(runtime.socketName, (message) => {
    try {
      if (!isPlainObject(message)) return;
      dispatchFx(runtime, message);
    } catch (err) {
      console.error("[FX Bus] Socket dispatch error:", err);
    }
  });
}

/**
 * Emit to other clients AND apply locally on the emitter.
 *
 * @param {object} runtime
 * @param {object} payload
 */
export function emitFx(runtime, payload) {
  if (!runtime?.socketName) throw new Error("[FX Bus] emitFx: invalid runtime.");
  if (!isPlainObject(payload)) throw new Error("[FX Bus] emitFx: payload must be an object.");

  dispatchFx(runtime, payload);
  return game.socket.emit(runtime.socketName, payload);
}
