import { jest } from "@jest/globals";
import {
  getActiveTargetedFx,
  observeLocalTargetedFxMessage,
  observeTargetedFxMessage
} from "../scripts/targetedFxLedger.js";
import {
  acknowledgeTargetedFxMessage,
  handleTargetedFxSyncMessage,
  registerTargetedFxSyncHooks,
  requestTargetedFxSync,
  startTargetedFxSync,
  stopTargetedFxSync,
  TARGETED_FX_SYNC_ACK,
  TARGETED_FX_SYNC_REQUEST,
  TARGETED_FX_SYNC_RESPONSE
} from "../scripts/targetedFxSync.js";

function installGame(currentUser, users) {
  globalThis.game = {
    user: currentUser,
    userId: currentUser.id,
    users: new Map(users.map((user) => [user.id, user])),
    socket: { emit: jest.fn() }
  };
}

function targeted(action, userIds, extra = {}) {
  return { action, audience: { userIds }, ...extra };
}

describe("targeted FX state synchronization", () => {
  const gm = { id: "gm", name: "GM", role: 4, isGM: true, active: true };
  const alice = { id: "alice", name: "Alice", role: 1, isGM: false, active: true };
  const bob = { id: "bob", name: "Bob", role: 1, isGM: false, active: false };

  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.game;
  });

  test("GM requests snapshots and immediately removes offline recipient state", () => {
    installGame(gm, [gm, alice, bob]);
    const runtime = { socketName: "module.fxbus" };

    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["alice", "bob"], { durationMs: 0 }),
      1_000
    );

    expect(requestTargetedFxSync(runtime, 2_000)).toBe(true);

    expect(getActiveTargetedFx(runtime, 2_000)).toEqual([
      expect.objectContaining({ effectKey: "screenBlur", userId: "alice" })
    ]);
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({
        action: TARGETED_FX_SYNC_REQUEST,
        requestedByUserId: "gm",
        requestId: expect.any(String)
      })
    );
  });

  test("clears stale state after two unanswered sync cycles", () => {
    installGame(gm, [gm, alice]);
    const runtime = { socketName: "module.fxbus" };
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["alice"], { durationMs: 0 }),
      1_000
    );

    requestTargetedFxSync(runtime, 2_000);
    requestTargetedFxSync(runtime, 3_000);
    expect(getActiveTargetedFx(runtime, 3_000)).toHaveLength(1);

    requestTargetedFxSync(runtime, 4_000);
    expect(getActiveTargetedFx(runtime, 4_000)).toEqual([]);
  });

  test("recipient replies with its locally applied targeted state", () => {
    installGame(alice, [gm, alice]);
    const runtime = { socketName: "module.fxbus" };
    observeLocalTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["alice"], { durationMs: 0 }),
      "alice",
      1_000
    );

    expect(handleTargetedFxSyncMessage(runtime, {
      action: TARGETED_FX_SYNC_REQUEST,
      requestId: "sync-1",
      requestedByUserId: "gm",
      __fxbus: { userId: "gm" }
    }, 2_000)).toBe(true);

    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({
        action: TARGETED_FX_SYNC_RESPONSE,
        requestId: "sync-1",
        requestedByUserId: "gm",
        userId: "alice",
        entries: [expect.objectContaining({ effectKey: "screenBlur" })]
      })
    );
  });

  test("GM replaces one user's optimistic state with a received snapshot", () => {
    installGame(gm, [gm, alice]);
    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["alice"], { durationMs: 0 }),
      1_000
    );

    handleTargetedFxSyncMessage(runtime, {
      action: TARGETED_FX_SYNC_RESPONSE,
      requestId: "sync-1",
      requestedByUserId: "gm",
      userId: "alice",
      entries: [{
        effectKey: "noise",
        action: "fx.noise.start",
        resourceId: "global",
        selectors: ["global"],
        elapsedMs: 500,
        remainingMs: null
      }],
      __fxbus: { userId: "alice" }
    }, 2_000);

    expect(getActiveTargetedFx(runtime, 2_000)).toEqual([
      expect.objectContaining({ effectKey: "noise", userId: "alice" })
    ]);
    expect(runtime.__targetedFxLastConfirmedAt.get("alice")).toBe(2_000);
  });

  test("successful targeted application emits an immediate state acknowledgement", () => {
    installGame(alice, [gm, alice]);
    const runtime = { socketName: "module.fxbus" };
    const message = targeted("fx.screenBlur.start", ["alice"], {
      durationMs: 0,
      __fxbus: { userId: "gm", messageId: "fx-7" }
    });
    observeLocalTargetedFxMessage(runtime, message, "alice", 1_000);

    expect(acknowledgeTargetedFxMessage(runtime, message, "applied")).toBe(true);
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({
        action: TARGETED_FX_SYNC_ACK,
        requestId: "fx-7",
        requestedByUserId: "gm",
        userId: "alice",
        status: "applied",
        entries: [expect.objectContaining({ effectKey: "screenBlur" })]
      })
    );
  });

  test("lifecycle hooks clear only the disconnected or deleted user and sync reconnects", () => {
    const activeBob = { ...bob, active: true };
    installGame(gm, [gm, alice, activeBob]);
    const runtime = { socketName: "module.fxbus" };
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["alice", "bob"], { durationMs: 0 }),
      1_000
    );
    const callbacks = new Map();
    const hooks = {
      on: jest.fn((name, callback) => {
        callbacks.set(name, callback);
        return `${name}-id`;
      })
    };

    expect(registerTargetedFxSyncHooks(runtime, hooks)).toBe(true);
    expect(registerTargetedFxSyncHooks(runtime, hooks)).toBe(true);
    expect(hooks.on).toHaveBeenCalledTimes(2);

    callbacks.get("userConnected")(alice, false);
    expect(getActiveTargetedFx(runtime)).toEqual([
      expect.objectContaining({ userId: "bob" })
    ]);

    callbacks.get("userConnected")(alice, true);
    expect(game.socket.emit).toHaveBeenCalledWith(
      "module.fxbus",
      expect.objectContaining({ action: TARGETED_FX_SYNC_REQUEST })
    );

    callbacks.get("deleteUser")(activeBob);
    expect(getActiveTargetedFx(runtime)).toEqual([]);
  });

  test("periodic sync starts immediately and repeats until stopped", () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    installGame(gm, [gm, alice]);
    const runtime = { socketName: "module.fxbus" };

    expect(startTargetedFxSync(runtime, { intervalMs: 5_000 })).toBe(true);
    expect(game.socket.emit).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_000);
    expect(game.socket.emit).toHaveBeenCalledTimes(2);

    stopTargetedFxSync(runtime);
    expect(jest.getTimerCount()).toBe(0);
  });
});
