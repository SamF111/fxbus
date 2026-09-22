import { jest } from "@jest/globals";
import {
  buildAuthoritativeToggleMacroSource,
  buildAuthoritativeTogglePayload
} from "../scripts/ui/tabs/tokenLaserTab.js";
import { createAudienceRuntime } from "../scripts/ui/panel/panelAudience.js";

const START_PAYLOAD = {
  action: "fx.tokenLaser.start",
  laserId: "party-link",
  sourceTokenId: "source-token",
  targetTokenIds: ["target-token"]
};

function ledgerEntry(userId, laserId = "party-link") {
  return {
    effectKey: "tokenLaser",
    userId,
    resourceId: `laser:${laserId}`,
    selectors: [`laser:${laserId}`]
  };
}

function panelRoot(laserId = "party-link") {
  const fields = { laserId: { value: laserId } };
  const panel = {
    querySelector(selector) {
      const name = selector.match(/\[name="([^"]+)"\]/)?.[1];
      return name ? fields[name] ?? null : null;
    }
  };

  return {
    querySelector(selector) {
      return selector.includes('data-tab="laser"') ? panel : null;
    }
  };
}

function panelGame() {
  return {
    user: { id: "gm", active: true, isGM: true },
    users: new Map([
      ["gm", { id: "gm", active: true, isGM: true }],
      ["player-a", { id: "player-a", active: true, isGM: false }],
      ["player-b", { id: "player-b", active: true, isGM: false }]
    ])
  };
}

describe("Token Tether targeted macro toggle", () => {
  beforeEach(() => {
    globalThis.game = { user: { isGM: true } };
    globalThis.ui = { notifications: { error: jest.fn() } };
  });

  afterEach(() => {
    delete globalThis.fxbus;
    delete globalThis.ui;
    delete globalThis.game;
    delete globalThis.canvas;
  });

  test("uses the targeted ledger for a start, stop, start sequence", () => {
    const audience = { userIds: ["player-a"] };
    const targetedFxLedger = new Map();
    const localTethers = new Map([["party-link", { active: true }]]);
    const emitted = [];
    const emit = jest.fn((payload) => {
      emitted.push(payload);
      if (payload.action === "fx.tokenLaser.start") {
        targetedFxLedger.set("active", ledgerEntry("player-a"));
      } else {
        targetedFxLedger.clear();
      }
    });
    globalThis.fxbus = {
      emit,
      targetedFxLedger,
      tokenFx: new Map([["tokenLaser", localTethers]])
    };
    const source = buildAuthoritativeToggleMacroSource(
      START_PAYLOAD,
      "Targeted Tether",
      {},
      audience
    );

    Function(source)();
    Function(source)();
    Function(source)();

    expect(emitted.map(({ action }) => action)).toEqual([
      "fx.tokenLaser.start",
      "fx.tokenLaser.stop",
      "fx.tokenLaser.start"
    ]);
    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ audience }),
      {
        action: "fx.tokenLaser.stop",
        laserId: "party-link",
        audience
      }
    ]));
  });

  test("stops the whole selected audience if any selected recipient is active", () => {
    const audience = { userIds: ["player-a", "player-b"] };
    const emit = jest.fn();
    globalThis.fxbus = {
      emit,
      targetedFxLedger: new Map([
        ["active-b", ledgerEntry("player-b")],
        ["other-user", ledgerEntry("player-c")],
        ["other-tether", ledgerEntry("player-a", "different-link")]
      ]),
      tokenFx: new Map([["tokenLaser", new Map()]])
    };

    Function(buildAuthoritativeToggleMacroSource(
      START_PAYLOAD,
      "Group Tether",
      {},
      audience
    ))();

    expect(emit).toHaveBeenCalledWith({
      action: "fx.tokenLaser.stop",
      laserId: "party-link",
      audience
    });
  });

  test("keeps Everyone macros on the existing GM-local render state", () => {
    const emit = jest.fn();
    const localTethers = new Map([["party-link", { active: true }]]);
    globalThis.fxbus = {
      emit,
      targetedFxLedger: new Map([["targeted", ledgerEntry("player-a")]]),
      tokenFx: new Map([["tokenLaser", localTethers]])
    };
    const source = buildAuthoritativeToggleMacroSource(
      START_PAYLOAD,
      "Everyone Tether",
      {},
      undefined
    );

    Function(source)();
    localTethers.clear();
    Function(source)();

    expect(emit.mock.calls.map(([payload]) => payload.action)).toEqual([
      "fx.tokenLaser.stop",
      "fx.tokenLaser.start"
    ]);
    expect(emit.mock.calls[0][0]).not.toHaveProperty("audience");
    expect(emit.mock.calls[1][0]).not.toHaveProperty("audience");
  });
});

describe("Token Tether panel audience toggle", () => {
  afterEach(() => {
    delete globalThis.canvas;
  });

  test("starts for a targeted audience when only the GM-local tether is active", () => {
    globalThis.canvas = {
      tokens: { controlled: [{ id: "source-token" }, { id: "target-token" }] }
    };
    const app = { _audienceUserIds: new Set(["player-a"]) };
    const runtime = {
      emit: jest.fn(),
      targetedFxLedger: new Map(),
      tokenFx: new Map([["tokenLaser", new Map([["party-link", {}]])]])
    };
    const scoped = createAudienceRuntime(runtime, app, { game: panelGame() });

    scoped.emit(buildAuthoritativeTogglePayload(panelRoot(), scoped));

    expect(runtime.emit).toHaveBeenCalledWith(expect.objectContaining({
      action: "fx.tokenLaser.start",
      laserId: "party-link",
      audience: { userIds: ["player-a"] }
    }));
  });

  test("stops all selected recipients when any targeted recipient is active", () => {
    const app = { _audienceUserIds: new Set(["player-a", "player-b"]) };
    const runtime = {
      emit: jest.fn(),
      targetedFxLedger: new Map([
        ["active-b", ledgerEntry("player-b")]
      ]),
      tokenFx: new Map([["tokenLaser", new Map()]])
    };
    const scoped = createAudienceRuntime(runtime, app, { game: panelGame() });

    scoped.emit(buildAuthoritativeTogglePayload(panelRoot(), scoped));

    expect(runtime.emit).toHaveBeenCalledWith({
      action: "fx.tokenLaser.stop",
      laserId: "party-link",
      audience: { userIds: ["player-a", "player-b"] }
    });
  });

  test("keeps the Everyone button on GM-local render state", () => {
    const app = { _audienceUserIds: new Set() };
    const runtime = {
      emit: jest.fn(),
      targetedFxLedger: new Map([["targeted", ledgerEntry("player-a")]]),
      tokenFx: new Map([["tokenLaser", new Map([["party-link", {}]])]])
    };
    const scoped = createAudienceRuntime(runtime, app, { game: panelGame() });

    scoped.emit(buildAuthoritativeTogglePayload(panelRoot(), scoped));

    expect(runtime.emit).toHaveBeenCalledWith({
      action: "fx.tokenLaser.stop",
      laserId: "party-link"
    });
  });
});
