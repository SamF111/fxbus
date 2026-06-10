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
 * - Registers the hook on init.
 * - Does not force a controls re-render, avoiding cross-module control-state races.
 *
 * Toolbar model:
 * - FX Bus controls are contextual launchers.
 * - FX Bus does not register or enter a custom canvas layer.
 * - The standalone FX Bus toolbar icon preserves the current native Foundry
 *   control and opens the matching FX Bus panel category.
 *
 * Trust model:
 * - Normal players are allowed to emit packets.
 * - Normal player packets are not applied locally.
 * - Normal player packets are still broadcast so receivers can reject and warn.
 * - Trusted players, Assistant users, and GMs apply locally and broadcast.
 * - Receiver-side trust enforcement remains in socket.js.
 *
 * Provenance:
 * - emit() enriches outgoing payloads with __fxbus sender metadata.
 * - Handlers receive the enriched payload.
 * - Broadcast uses the enriched payload so receivers can log sender identity.
 */

import { registerFxSocket } from "./socket.js";
import { registerBuiltInEffects } from "./effects/index.js";
import { registerFxBusSceneControls } from "./ui/controls.js";

const RUNTIME_KEY = "fxbus";

function getModule() {
  /**
   * Large comment:
   * Resolve module metadata from Foundry's loaded module registry.
   *
   * This is the single source of truth for id, version, title, and related
   * module metadata from module.json. Runtime code should not hard-code version
   * strings or duplicate module metadata.
   */
  const mod = game.modules.get(RUNTIME_KEY);

  if (!mod) {
    throw new Error(`[FX Bus] Module "${RUNTIME_KEY}" not found in game.modules.`);
  }

  return mod;
}

function getTrustedRoleValue() {
  /**
   * Large comment:
   * Resolve Foundry's Trusted role value without hardcoding where possible.
   *
   * Foundry's usual role order is:
   * - NONE = 0
   * - PLAYER = 1
   * - TRUSTED = 2
   * - ASSISTANT = 3
   * - GAMEMASTER = 4
   *
   * Trusted is the minimum role allowed to apply FX locally.
   */
  const trusted = globalThis.CONST?.USER_ROLES?.TRUSTED;
  return Number.isFinite(trusted) ? trusted : 2;
}

function getCurrentUserRole() {
  /**
   * Large comment:
   * Read the current Foundry user role defensively across likely data shapes.
   * Current Foundry normally exposes game.user.role directly.
   */
  const role =
    game.user?.role ??
    game.user?.data?.role ??
    game.user?.system?.role ??
    null;

  const n = Number(role);
  return Number.isFinite(n) ? n : null;
}

function currentUserCanApplyFxLocally() {
  /**
   * Large comment:
   * Decide whether this client should apply its own emitted FX locally.
   *
   * Normal players may still emit packets, but their local client must not
   * apply the FX because receiving clients will reject the same packet.
   */
  if (game.user?.isGM === true) return true;

  const role = getCurrentUserRole();
  if (role === null) return false;

  return role >= getTrustedRoleValue();
}

function warnSkippedLocalApply(action) {
  /**
   * Large comment:
   * Warn the emitting user when their packet is broadcast but not applied
   * locally due to role restrictions.
   */
  console.warn("[FX Bus] skipped local apply for untrusted emitter", {
    action,
    userId: game.userId,
    userName: game.user?.name,
    role: getCurrentUserRole(),
    requiredMinimumRole: "Trusted"
  });

  ui.notifications?.warn?.(
    `FX Bus sent '${action}', but did not apply it locally because your user role is not Trusted, Assistant, or GM.`
  );
}

function buildSenderMetadata() {
  /**
   * Large comment:
   * Build provenance metadata for every locally emitted FX Bus payload.
   *
   * This stays under __fxbus so effect payload fields remain clean and existing
   * macros do not need to know about sender bookkeeping.
   */
  return {
    userId: game.userId,
    userName: game.user?.name,
    isGM: game.user?.isGM === true,
    role: getCurrentUserRole(),
    ts: Date.now()
  };
}

function logEmit(runtime, action, enriched) {
  /**
   * Large comment:
   * Log outbound effect requests with enough context to diagnose socket and
   * macro behaviour, while remaining tolerant of odd console/object states.
   */
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
}

function handleLocalPayload(runtime, action, enriched, t0) {
  /**
   * Large comment:
   * Apply an emitted payload locally before broadcasting it to other clients.
   *
   * This is skipped for normal players because receiver-side trust policy will
   * reject their packets. Skipping local application keeps all clients
   * consistent.
   */
  const handler = runtime.handlers.get(action);

  if (typeof handler !== "function") {
    console.warn("[FX Bus] no handler", {
      action,
      from: enriched.__fxbus
    });
    return;
  }

  try {
    handler(enriched);

    const dt = Math.round((performance.now() - t0) * 1000) / 1000;

    console.log("[FX Bus] handled", {
      action,
      ms: dt,
      from: enriched.__fxbus
    });
  } catch (err) {
    console.error("[FX Bus] handler error", {
      action,
      err,
      from: enriched.__fxbus
    });
  }
}

function broadcastPayload(runtime, action, enriched) {
  /**
   * Large comment:
   * Broadcast an enriched FX Bus payload to other connected clients.
   *
   * The socket layer receives the enriched payload and applies its own
   * receiver-side trust policy before dispatching.
   */
  try {
    game.socket.emit(runtime.socketName, enriched);

    console.log("[FX Bus] broadcast", {
      action,
      from: enriched.__fxbus
    });
  } catch (err) {
    console.error("[FX Bus] socket emit failed", {
      action,
      err,
      from: enriched.__fxbus
    });
  }
}

function getOrCreateRuntime() {
  /**
   * Large comment:
   * Create the shared FX Bus runtime once and expose it at globalThis.fxbus.
   *
   * Runtime responsibilities:
   * - Store per-effect local state maps.
   * - Store registered action handlers.
   * - Store active PIXI tickers.
   * - Provide emit(), which may apply locally and always broadcasts.
   *
   * emit() always:
   * - Validates the action.
   * - Enriches payloads with sender metadata under __fxbus.
   * - Applies locally only if the current user is Trusted, Assistant, or GM.
   * - Still broadcasts normal-player packets so receivers can reject and warn.
   */
  if (globalThis[RUNTIME_KEY]) return globalThis[RUNTIME_KEY];

  const mod = getModule();
  const socketName = `module.${mod.id}`;

  const runtime = {
    id: mod.id,
    version: mod.version,
    title: mod.title,
    socketName,

    tickers: new Map(),
    tokenFx: new Map(),
    tileFx: new Map(),
    screenFx: new Map(),
    handlers: new Map(),

    emit(payload) {
      const action = payload?.action;
      if (typeof action !== "string" || action.trim().length === 0) return;

      const t0 = performance.now();

      const enriched = {
        ...payload,
        action,
        __fxbus: buildSenderMetadata()
      };

      logEmit(runtime, action, enriched);

      if (currentUserCanApplyFxLocally()) {
        handleLocalPayload(runtime, action, enriched, t0);
      } else {
        warnSkippedLocalApply(action);
      }

      broadcastPayload(runtime, action, enriched);
    }
  };

  globalThis[RUNTIME_KEY] = runtime;
  return runtime;
}

/* -------------------------------------------- */
/* INIT                                         */
/* -------------------------------------------- */

Hooks.once("init", () => {
  const runtime = getOrCreateRuntime();

  game.settings.register(runtime.id, "uiState", {
    name: "FX Bus UI State",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  registerFxBusSceneControls();

  console.log(`[FX Bus] Init | v${runtime.version}`);
});

/* -------------------------------------------- */
/* READY                                        */
/* -------------------------------------------- */

Hooks.once("ready", () => {
  const runtime = getOrCreateRuntime();

  registerBuiltInEffects(runtime);
  registerFxSocket(runtime);

  console.log(
    `[FX Bus] Ready | v${runtime.version} | handlers=${runtime.handlers.size} | socket=${runtime.socketName}`
  );
});