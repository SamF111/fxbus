import { jest } from "@jest/globals";
import {
  dispatchFx,
  emitFx,
  registerFxSocket,
  validateOutboundFxAudienceRecipients
} from "../scripts/socket.js";
import { observeTargetedFxMessage } from "../scripts/targetedFxLedger.js";

function installSocketEnvironment(users = new Map()) {
  let listener = null;

  globalThis.game = {
    users: { get: jest.fn((id) => users.get(id) ?? null) },
    socket: {
      on: jest.fn((_name, fn) => {
        listener = fn;
      }),
      emit: jest.fn()
    }
  };
  globalThis.ui = { notifications: { warn: jest.fn() } };
  globalThis.CONST = { USER_ROLES: { TRUSTED: 2 } };

  return {
    get listener() {
      return listener;
    }
  };
}

function runtime(handler = jest.fn()) {
  return {
    socketName: "module.fxbus",
    handlers: new Map([["fx.test", handler]])
  };
}

describe("FX Bus socket dispatch", () => {
  afterEach(() => {
    delete globalThis.canvas;
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.CONST;
    jest.restoreAllMocks();
  });

  test.each([
    ["Trusted", { id: "trusted", name: "Trusted", role: 2 }],
    ["Assistant", { id: "assistant", name: "Assistant", role: 3 }],
    ["GM", { id: "gm", name: "GM", role: 4, isGM: true }]
  ])("accepts packets from a %s user", (_label, sender) => {
    const handler = jest.fn();
    const env = installSocketEnvironment(new Map([[sender.id, sender]]));
    const rt = runtime(handler);
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(rt);
    const message = {
      action: "fx.test",
      value: 42,
      __fxbus: { userId: sender.id, userName: sender.name }
    };
    env.listener(message);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(message);
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  test.each([
    ["normal player", { id: "player", name: "Player", role: 1 }, "player"],
    ["unknown user", null, "missing"],
    ["missing metadata", null, null]
  ])("rejects a packet from a %s", (_label, sender, senderId) => {
    const users = sender ? new Map([[sender.id, sender]]) : new Map();
    const handler = jest.fn();
    const env = installSocketEnvironment(users);
    const rt = runtime(handler);
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(rt);
    env.listener({
      action: "fx.test",
      ...(senderId ? { __fxbus: { userId: senderId } } : {})
    });

    expect(handler).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
  });

  test("registers only one listener for a runtime", () => {
    installSocketEnvironment();
    const rt = runtime();

    registerFxSocket(rt);
    registerFxSocket(rt);

    expect(game.socket.on).toHaveBeenCalledTimes(1);
  });

  test("local dispatch ignores malformed and unknown actions", () => {
    const handler = jest.fn();
    const rt = runtime(handler);

    dispatchFx(rt, null);
    dispatchFx(rt, "fx.test");
    dispatchFx(rt, {});
    dispatchFx(rt, { action: "" });
    dispatchFx(rt, { action: "fx.unknown" });

    expect(handler).not.toHaveBeenCalled();
  });

  test.each([
    ["an omitted audience", undefined],
    ["an empty audience", { userIds: [] }],
    ["a matching audience", { userIds: ["current-user", "other-user"] }]
  ])("local dispatch applies %s", (_label, audience) => {
    installSocketEnvironment();
    game.userId = "current-user";
    const handler = jest.fn();
    const rt = runtime(handler);
    const message = {
      action: "fx.test",
      ...(audience === undefined ? {} : { audience })
    };

    dispatchFx(rt, message);

    expect(handler).toHaveBeenCalledWith(message);
  });

  test("local dispatch ignores a valid packet addressed to other users", () => {
    installSocketEnvironment();
    game.userId = "current-user";
    const handler = jest.fn();

    dispatchFx(runtime(handler), {
      action: "fx.test",
      audience: { userIds: ["other-user"] }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  test("local dispatch warns and rejects a malformed audience", () => {
    installSocketEnvironment();
    game.userId = "current-user";
    const handler = jest.fn();
    jest.spyOn(console, "warn").mockImplementation(() => {});

    dispatchFx(runtime(handler), {
      action: "fx.test",
      audience: { userIds: "other-user" }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
  });

  test.each([
    { userIds: ["other-user"] },
    { userIds: "malformed" }
  ])("global reset ignores audience and always dispatches: %p", (audience) => {
    installSocketEnvironment();
    game.userId = "current-user";
    const reset = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    };

    dispatchFx(rt, { action: "fx.bus.reset", audience });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  test("socket receipt applies a targeted packet only on a selected client", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const env = installSocketEnvironment(new Map([[gm.id, gm]]));
    game.userId = "selected-player";
    const handler = jest.fn();
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(runtime(handler));
    env.listener({
      action: "fx.test",
      audience: { userIds: ["selected-player"] },
      __fxbus: { userId: gm.id, userName: gm.name }
    });

    expect(handler).toHaveBeenCalledTimes(1);

    game.userId = "other-player";
    env.listener({
      action: "fx.test",
      audience: { userIds: ["selected-player"] },
      __fxbus: { userId: gm.id, userName: gm.name }
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("selected recipient acknowledges successfully applied targeted state", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const player = { id: "selected-player", name: "Player", role: 1, active: true };
    const env = installSocketEnvironment(new Map([[gm.id, gm], [player.id, player]]));
    game.user = player;
    game.userId = player.id;
    const handler = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenBlur.start", handler]])
    };
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(rt);
    env.listener({
      action: "fx.screenBlur.start",
      durationMs: 0,
      audience: { userIds: [player.id] },
      __fxbus: { userId: gm.id, userName: gm.name, messageId: "fx-1" }
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({
        action: "fx.bus.sync.ack",
        requestId: "fx-1",
        requestedByUserId: gm.id,
        userId: player.id,
        status: "applied",
        entries: [expect.objectContaining({ effectKey: "screenBlur" })]
      })
    );
  });

  test("photosensitive recipients suppress an effect, warn, and acknowledge failure", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const player = { id: "selected-player", name: "Player", role: 1, active: true };
    const env = installSocketEnvironment(new Map([[gm.id, gm], [player.id, player]]));
    globalThis.canvas = { photosensitiveMode: true };
    game.user = player;
    game.userId = player.id;
    const handler = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenShake.start", handler]])
    };
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});

    registerFxSocket(rt);
    env.listener({
      action: "fx.screenShake.start",
      audience: { userIds: [player.id] },
      __fxbus: { userId: gm.id, userName: gm.name, messageId: "fx-safe-1" }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus suppressed Screen Shake because Photosensitive Mode is enabled."
    );
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({
        action: "fx.bus.sync.ack",
        requestId: "fx-safe-1",
        requestedByUserId: gm.id,
        userId: player.id,
        status: "failed",
        entries: []
      })
    );
  });

  test("photosensitive recipients can still stop effects", () => {
    installSocketEnvironment();
    globalThis.canvas = { photosensitiveMode: true };
    game.userId = "current-user";
    const handler = jest.fn();

    dispatchFx({
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenShake.stop", handler]])
    }, { action: "fx.screenShake.stop" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  test("a photosensitive GM does not retain reminder state for a suppressed self-target", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true, active: true };
    installSocketEnvironment(new Map([[gm.id, gm]]));
    globalThis.canvas = { photosensitiveMode: true };
    game.user = gm;
    game.userId = gm.id;
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenBlur.start", jest.fn()]])
    };
    const message = {
      action: "fx.screenBlur.start",
      durationMs: 0,
      audience: { userIds: [gm.id] }
    };
    jest.spyOn(console, "warn").mockImplementation(() => {});

    // Emission records intended targeted state before local application.
    observeTargetedFxMessage(rt, message);
    expect(rt.targetedFxLedger.size).toBe(1);

    expect(dispatchFx(rt, message)).toBe(false);
    expect(rt.targetedFxLedger.size).toBe(0);
  });

  test("GM accepts a state response from an ordinary player", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const player = { id: "player", name: "Player", role: 1, active: true };
    const env = installSocketEnvironment(new Map([[gm.id, gm], [player.id, player]]));
    game.user = gm;
    game.userId = gm.id;
    const rt = runtime();
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(rt);
    env.listener({
      action: "fx.bus.sync.response",
      requestId: "sync-1",
      requestedByUserId: gm.id,
      userId: player.id,
      entries: [{
        effectKey: "screenBlur",
        action: "fx.screenBlur.start",
        resourceId: "global",
        selectors: ["global"],
        elapsedMs: 1_000,
        remainingMs: null
      }],
      __fxbus: { userId: player.id, userName: player.name }
    });

    expect(Array.from(rt.targetedFxLedger.values())).toEqual([
      expect.objectContaining({ effectKey: "screenBlur", userId: player.id })
    ]);
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  test("a non-target GM observes a targeted packet without rendering it", () => {
    const sender = { id: "assistant", name: "Assistant", role: 3, isGM: false };
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const env = installSocketEnvironment(new Map([[sender.id, sender]]));
    game.user = gm;
    game.userId = gm.id;
    const handler = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenBlur.start", handler]])
    };
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(rt);
    env.listener({
      action: "fx.screenBlur.start",
      durationMs: 0,
      audience: { userIds: ["player-a"] },
      __fxbus: { userId: sender.id, userName: sender.name }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(Array.from(rt.targetedFxLedger.values())).toEqual([
      expect.objectContaining({
        effectKey: "screenBlur",
        userId: "player-a",
        expiresAt: null
      })
    ]);
  });

  test("emitFx enriches fallback-runtime packets before local and remote dispatch", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    installSocketEnvironment(new Map([[gm.id, gm]]));
    game.user = gm;
    game.userId = gm.id;
    const handler = jest.fn();
    const rt = runtime(handler);
    const payload = {
      action: "fx.test",
      value: 7,
      __fxbus: { userId: "stale-or-forged" }
    };

    emitFx(rt, payload);

    const enriched = game.socket.emit.mock.calls[0][1];
    expect(handler).toHaveBeenCalledWith(enriched);
    expect(enriched).toMatchObject({
      ...payload,
      __fxbus: {
        userId: "gm",
        userName: "GM",
        isGM: true,
        role: 4
      }
    });
    expect(enriched.__fxbus.ts).toEqual(expect.any(Number));
  });

  test("emitFx broadcasts a packet that the receiver trust gate accepts", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const env = installSocketEnvironment(new Map([[gm.id, gm]]));
    game.user = gm;
    game.userId = gm.id;
    const localHandler = jest.fn();
    const remoteHandler = jest.fn();
    const senderRuntime = runtime(localHandler);
    const receiverRuntime = runtime(remoteHandler);
    jest.spyOn(console, "warn").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxSocket(receiverRuntime);
    emitFx(senderRuntime, { action: "fx.test", value: 7 });
    const emittedPayload = game.socket.emit.mock.calls[0][1];
    env.listener(emittedPayload);

    expect(localHandler).toHaveBeenCalledTimes(1);
    expect(remoteHandler).toHaveBeenCalledTimes(1);
  });

  test("emitFx delegates to a current runtime instead of duplicating emission", () => {
    installSocketEnvironment();
    const emit = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map(),
      emit
    };
    const payload = { action: "fx.test", value: 7 };

    emitFx(rt, payload);

    expect(emit).toHaveBeenCalledWith(payload);
    expect(game.socket.emit).not.toHaveBeenCalled();
  });

  test("emitFx fallback does not apply an untrusted packet locally", () => {
    const player = { id: "player", name: "Player", role: 1, isGM: false };
    installSocketEnvironment(new Map([[player.id, player]]));
    game.user = player;
    game.userId = player.id;
    const handler = jest.fn();
    const rt = runtime(handler);

    emitFx(rt, { action: "fx.test" });

    expect(handler).not.toHaveBeenCalled();
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({
        action: "fx.test",
        __fxbus: expect.objectContaining({ userId: "player", role: 1 })
      })
    );
  });

  test("emitFx broadcasts a valid targeted packet without applying it to an unselected sender", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const player = { id: "player-a", name: "Player A", role: 1, active: true };
    installSocketEnvironment(new Map([[gm.id, gm], [player.id, player]]));
    game.user = gm;
    game.userId = gm.id;
    const handler = jest.fn();
    const payload = {
      action: "fx.test",
      audience: { userIds: ["player-a"] }
    };

    emitFx(runtime(handler), payload);

    expect(handler).not.toHaveBeenCalled();
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining(payload)
    );
  });

  test("emitFx records targeted outbound state for an unselected GM", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const player = { id: "player-a", name: "Player A", role: 1, active: true };
    installSocketEnvironment(new Map([[gm.id, gm], [player.id, player]]));
    game.user = gm;
    game.userId = gm.id;
    const handler = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenBlur.start", handler]])
    };

    emitFx(rt, {
      action: "fx.screenBlur.start",
      durationMs: 0,
      audience: { userIds: ["player-a"] }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(Array.from(rt.targetedFxLedger.values())).toEqual([
      expect.objectContaining({ effectKey: "screenBlur", userId: "player-a" })
    ]);
  });

  test("blocks an outbound targeted packet when a recipient is offline", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    const player = { id: "player-a", name: "Player A", role: 1, active: false };
    installSocketEnvironment(new Map([[gm.id, gm], [player.id, player]]));
    game.user = gm;
    game.userId = gm.id;
    const handler = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.screenBlur.start", handler]])
    };
    jest.spyOn(console, "warn").mockImplementation(() => {});

    emitFx(rt, {
      action: "fx.screenBlur.start",
      durationMs: 0,
      audience: { userIds: [player.id] }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(game.socket.emit).not.toHaveBeenCalled();
    expect(rt.targetedFxLedger).toBeUndefined();
    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus did not send 'fx.screenBlur.start': unavailable recipient: Player A (offline)."
    );
  });

  test("blocks an outbound targeted packet when a recipient was deleted", () => {
    installSocketEnvironment();
    jest.spyOn(console, "warn").mockImplementation(() => {});

    expect(validateOutboundFxAudienceRecipients({
      action: "fx.screenShake.start",
      audience: { userIds: ["deleted-player"] }
    })).toBe(false);

    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus did not send 'fx.screenShake.start': unavailable recipient: deleted-player (deleted)."
    );
  });

  test("emitFx rejects a malformed audience before local or socket dispatch", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    installSocketEnvironment(new Map([[gm.id, gm]]));
    game.user = gm;
    game.userId = gm.id;
    const handler = jest.fn();
    jest.spyOn(console, "warn").mockImplementation(() => {});

    emitFx(runtime(handler), {
      action: "fx.test",
      audience: { userIds: null }
    });

    expect(handler).not.toHaveBeenCalled();
    expect(game.socket.emit).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledTimes(1);
  });

  test("emitFx applies and broadcasts reset even when it carries a malformed audience", () => {
    const gm = { id: "gm", name: "GM", role: 4, isGM: true };
    installSocketEnvironment(new Map([[gm.id, gm]]));
    game.user = gm;
    game.userId = gm.id;
    const reset = jest.fn();
    const rt = {
      socketName: "module.fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    };
    const payload = {
      action: "fx.bus.reset",
      audience: { userIds: "stale-selector" }
    };

    emitFx(rt, payload);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining(payload)
    );
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });
});
