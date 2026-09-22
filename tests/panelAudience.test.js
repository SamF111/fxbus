import { jest } from "@jest/globals";
import {
  addAudienceToPayload,
  closeAudienceMenus,
  createAudienceRuntime,
  formatApplyAudienceLabel,
  formatAudienceUserLabel,
  getAudienceUsers,
  getPanelAudience,
  wireAudienceRosterRefresh
} from "../scripts/ui/panel/panelAudience.js";

function makeGame() {
  return {
    user: { id: "gm", name: "Gamemaster", isGM: true, active: true },
    users: new Map([
      ["gm", { id: "gm", name: "Gamemaster", isGM: true, active: true }],
      ["alice", { id: "alice", name: "Alice", isGM: false, active: true }],
      ["bob", { id: "bob", name: "Bob", isGM: false, active: true }],
      ["cara", { id: "cara", name: "Cara", isGM: false, active: true }],
      ["offline", { id: "offline", name: "Offline", isGM: false, active: false }]
    ])
  };
}

describe("GM panel audience targeting", () => {
  test("lists the current GM first alongside online and offline world users", () => {
    expect(getAudienceUsers(makeGame())).toEqual([
      {
        id: "gm",
        name: "Gamemaster",
        isGM: true,
        isCurrentUser: true,
        active: true
      },
      { id: "alice", name: "Alice", isGM: false, isCurrentUser: false, active: true },
      { id: "bob", name: "Bob", isGM: false, isCurrentUser: false, active: true },
      { id: "cara", name: "Cara", isGM: false, isCurrentUser: false, active: true },
      {
        id: "offline",
        name: "Offline",
        isGM: false,
        isCurrentUser: false,
        active: false
      }
    ]);
  });

  test("labels the local user clearly without hiding other GM or offline status", () => {
    expect(formatAudienceUserLabel({
      id: "gm",
      name: "Gamemaster",
      isGM: true,
      isCurrentUser: true,
      active: true
    })).toBe("Gamemaster (you)");
    expect(formatAudienceUserLabel({
      id: "assistant",
      name: "Assistant GM",
      isGM: true,
      isCurrentUser: false,
      active: true
    })).toBe("Assistant GM [GM]");
    expect(formatAudienceUserLabel({
      id: "offline",
      name: "Offline",
      isGM: false,
      isCurrentUser: false,
      active: false
    })).toBe("Offline (offline)");
  });

  test("uses concise Apply labels for everyone, one, two, and many users", () => {
    const game = makeGame();

    expect(formatApplyAudienceLabel(undefined, game)).toBe("Apply to Everyone");
    expect(formatApplyAudienceLabel({ userIds: ["bob"] }, game)).toBe("Apply to Bob");
    expect(formatApplyAudienceLabel({ userIds: ["bob", "alice"] }, game)).toBe(
      "Apply to Bob + Alice"
    );
    expect(formatApplyAudienceLabel({ userIds: ["alice", "bob", "cara"] }, game)).toBe(
      "Apply to 3 users"
    );
  });

  test("keeps legacy Everyone payloads unchanged and targets selected users", () => {
    const payload = { action: "fx.screenBlur.start", durationMs: 500 };

    expect(addAudienceToPayload(payload, undefined)).toEqual(payload);
    expect(addAudienceToPayload(payload, { userIds: ["alice"] })).toEqual({
      ...payload,
      audience: { userIds: ["alice"] }
    });
    expect(payload).not.toHaveProperty("audience");
  });

  test("always strips an audience from reset packets", () => {
    expect(addAudienceToPayload(
      { action: "fx.bus.reset", audience: { userIds: ["alice"] } },
      { userIds: ["bob"] }
    )).toEqual({ action: "fx.bus.reset" });
  });

  test("scoped runtime applies the same audience to Apply and Stop", () => {
    const emit = jest.fn();
    const runtime = { emit, tokenFx: new Map() };
    const app = { _audienceUserIds: new Set(["alice", "bob"]) };
    const scoped = createAudienceRuntime(runtime, app, { game: makeGame() });

    scoped.emit({ action: "fx.screenNoise.start" });
    scoped.emit({ action: "fx.screenNoise.stop" });

    expect(emit).toHaveBeenNthCalledWith(1, {
      action: "fx.screenNoise.start",
      audience: { userIds: ["alice", "bob"] }
    });
    expect(emit).toHaveBeenNthCalledWith(2, {
      action: "fx.screenNoise.stop",
      audience: { userIds: ["alice", "bob"] }
    });
    expect(scoped.tokenFx).toBe(runtime.tokenFx);
  });

  test("allows the current GM to target only their own client", () => {
    const emit = jest.fn();
    const app = { _audienceUserIds: new Set(["gm"]) };
    const scoped = createAudienceRuntime({ emit }, app, { game: makeGame() });

    scoped.emit({ action: "fx.screenNoise.start" });

    expect(emit).toHaveBeenCalledWith({
      action: "fx.screenNoise.start",
      audience: { userIds: ["gm"] }
    });
  });

  test("blocks a selected user who disconnected instead of broadcasting", () => {
    const game = makeGame();
    game.users.get("alice").active = false;
    const emit = jest.fn();
    const notify = jest.fn();
    const app = { _audienceUserIds: new Set(["alice"]) };
    const scoped = createAudienceRuntime({ emit }, app, { game, notify });

    scoped.emit({ action: "fx.screenPulse.start" });

    expect(emit).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      "Selected recipient is no longer connected: Alice. Choose recipients again."
    );
    expect(() => getPanelAudience(app, game)).toThrow("Alice");
  });

  test("allows offline recipients while preparing a macro", () => {
    const game = makeGame();
    const app = { _audienceUserIds: new Set(["offline"]) };

    expect(getPanelAudience(app, game, { requireConnected: false })).toEqual({
      userIds: ["offline"]
    });
    expect(() => getPanelAudience(app, game)).toThrow("Offline");
  });

  test("does not author macros for users deleted from the world", () => {
    const app = { _audienceUserIds: new Set(["missing-user"]) };

    expect(() => getPanelAudience(app, makeGame(), { requireConnected: false })).toThrow(
      "no longer exists"
    );
  });

  test("reset bypasses a stale selection and still applies to everyone", () => {
    const game = makeGame();
    game.users.get("alice").active = false;
    const emit = jest.fn();
    const notify = jest.fn();
    const app = { _audienceUserIds: new Set(["alice"]) };
    const scoped = createAudienceRuntime({ emit }, app, { game, notify });

    scoped.emit({ action: "fx.bus.reset", audience: { userIds: ["alice"] } });

    expect(emit).toHaveBeenCalledWith({ action: "fx.bus.reset" });
    expect(notify).not.toHaveBeenCalled();
  });

  test("refreshes for user lifecycle changes and removes hooks on abort", () => {
    const callbacks = new Map();
    const hooks = {
      on: jest.fn((name, callback) => {
        const id = `${name}-id`;
        callbacks.set(name, callback);
        return id;
      }),
      off: jest.fn()
    };
    const refresh = jest.fn();
    const controller = new AbortController();

    const registrations = wireAudienceRosterRefresh(refresh, controller.signal, hooks);

    expect(registrations).toHaveLength(4);
    expect(hooks.on.mock.calls.map(([name]) => name)).toEqual([
      "userConnected",
      "updateUser",
      "createUser",
      "deleteUser"
    ]);

    callbacks.get("userConnected")();
    callbacks.get("updateUser")();
    expect(refresh).toHaveBeenCalledTimes(2);

    controller.abort();
    expect(hooks.off.mock.calls).toEqual([
      ["userConnected", "userConnected-id"],
      ["updateUser", "updateUser-id"],
      ["createUser", "createUser-id"],
      ["deleteUser", "deleteUser-id"]
    ]);
  });

  test("closing the audience popup restores focus to its controlling button", () => {
    const menu = { id: "fxbus-audience-screen-blur", hidden: false };
    const focus = jest.fn();
    const toggle = {
      focus,
      getAttribute: jest.fn((name) =>
        name === "aria-controls" ? menu.id : null),
      setAttribute: jest.fn()
    };
    const root = {
      querySelectorAll: jest.fn((selector) =>
        selector === ".fxbus-audience-menu" ? [menu] : [toggle])
    };

    closeAudienceMenus(root, { restoreFocus: true });

    expect(menu.hidden).toBe(true);
    expect(toggle.setAttribute).toHaveBeenCalledWith("aria-expanded", "false");
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
