import { jest } from "@jest/globals";
import {
  copyActiveTabApplyToClipboard,
  copyActiveTabMacroToClipboard
} from "../scripts/ui/panel/panelMacroCopy.js";
import { buildGroups } from "../scripts/ui/panel/panelRegistry.js";
import { tokenLaserTabDef } from "../scripts/ui/tabs/tokenLaserTab.js";
import { tokenOscTabDef } from "../scripts/ui/tabs/tokenOscTab.js";
import { tokenDollyZoomTabDef } from "../scripts/ui/tabs/tokenDollyZoomTab.js";
import { tileFlowTabDef } from "../scripts/ui/tabs/tileFlowTab.js";

describe("panel macro audience authoring", () => {
  afterEach(() => {
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.navigator;
    delete globalThis.canvas;
    delete globalThis.fxbus;
  });

  test("copies a targeted macro for an offline world user", async () => {
    const writeText = jest.fn(async () => undefined);
    const tabDef = {
      id: "test-effect",
      label: "Test Effect",
      buildApplyPayload: jest.fn(() => ({
        action: "fx.screenShake.start",
        durationMs: 600
      }))
    };
    const app = {
      _activeCategory: "screen",
      _activeTab: "test-effect",
      _audienceUserIds: new Set(["offline-player"]),
      _groups: [{ id: "screen", tabs: [tabDef] }],
      _tabs: [tabDef]
    };

    globalThis.game = {
      user: { id: "gm", name: "Gamemaster", isGM: true, active: true },
      users: new Map([
        ["gm", { id: "gm", name: "Gamemaster", isGM: true, active: true }],
        ["offline-player", {
          id: "offline-player",
          name: "Offline Player",
          isGM: false,
          active: false
        }]
      ]),
      modules: new Map([["fxbus", { version: "0.8.0" }]])
    };
    globalThis.ui = {
      notifications: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } }
    });

    await copyActiveTabApplyToClipboard(app, {}, {});

    expect(writeText).toHaveBeenCalledTimes(1);
    const macroSource = writeText.mock.calls[0][0];
    expect(macroSource).toContain('"audience"');
    expect(macroSource).toContain('"offline-player"');
    expect(ui.notifications.warn).not.toHaveBeenCalled();
    expect(ui.notifications.info).toHaveBeenCalledWith("FX Bus: macro copied to clipboard.");
  });

  test("copies a scoped Stop macro with selected resources and audience", async () => {
    const writeText = jest.fn(async () => undefined);
    const tabDef = {
      id: "resource-effect",
      label: "Resource Effect",
      macroName: "FX Bus - Resource Effect",
      buildApplyPayload: jest.fn(),
      buildStopPayload: jest.fn(() => ({
        action: "fx.tokenOsc.stop",
        tokenIds: ["token-a"]
      }))
    };
    const app = {
      _activeCategory: "token",
      _activeTab: tabDef.id,
      _audienceUserIds: new Set(["offline-player"]),
      _groups: [{ id: "token", tabs: [tabDef] }],
      _tabs: [tabDef]
    };

    globalThis.game = {
      user: { id: "gm", name: "Gamemaster", isGM: true, active: true },
      users: new Map([
        ["offline-player", {
          id: "offline-player",
          name: "Offline Player",
          active: false
        }]
      ]),
      modules: new Map([["fxbus", { version: "0.8.0" }]])
    };
    globalThis.ui = {
      notifications: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } }
    });

    await copyActiveTabMacroToClipboard(app, {}, {}, "stop");

    expect(tabDef.buildStopPayload).toHaveBeenCalledTimes(1);
    const macroSource = writeText.mock.calls[0][0];
    expect(macroSource).toContain("FX Bus - Resource Effect - Stop");
    expect(macroSource).toContain('"action": "fx.tokenOsc.stop"');
    expect(macroSource).toContain('"token-a"');
    expect(macroSource).toContain('"offline-player"');
  });

  test("copies Stop All from the tab action without inheriting its audience", async () => {
    const writeText = jest.fn(async () => undefined);
    const tabDef = {
      id: "shake",
      label: "Screen Shake",
      macroName: "FX Bus - Screen Shake",
      buildApplyPayload: jest.fn()
    };
    const app = {
      _activeCategory: "screen",
      _activeTab: tabDef.id,
      _audienceUserIds: new Set(["offline-player"]),
      _groups: [{ id: "screen", tabs: [tabDef] }],
      _tabs: [tabDef]
    };
    const stopAllButton = {
      dataset: { fxbusStopAllAction: "fx.screenShake.stop" },
      closest: jest.fn(() => null)
    };
    const section = {
      querySelector: jest.fn(() => stopAllButton)
    };
    const root = {
      querySelector: jest.fn(() => section)
    };

    globalThis.game = {
      user: { id: "gm", name: "Gamemaster", isGM: true, active: true },
      users: new Map(),
      modules: new Map([["fxbus", { version: "0.8.0" }]])
    };
    globalThis.ui = {
      notifications: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } }
    });

    await copyActiveTabMacroToClipboard(app, root, {}, "stopAll");

    const macroSource = writeText.mock.calls[0][0];
    expect(macroSource).toContain("FX Bus - Screen Shake - Stop All");
    expect(macroSource).toContain('"action": "fx.screenShake.stop"');
    expect(macroSource).not.toContain('"audience"');
    expect(ui.notifications.warn).not.toHaveBeenCalled();
  });

  test("copies a screen Stop macro from its shared action with the current audience", async () => {
    const writeText = jest.fn(async () => undefined);
    const tabDef = {
      id: "shake",
      label: "Screen Shake",
      macroName: "FX Bus - Screen Shake",
      buildApplyPayload: jest.fn()
    };
    const app = {
      _activeCategory: "screen",
      _activeTab: tabDef.id,
      _audienceUserIds: new Set(["player-a"]),
      _groups: [{ id: "screen", tabs: [tabDef] }],
      _tabs: [tabDef]
    };
    const stopAllButton = {
      dataset: { fxbusStopAllAction: "fx.screenShake.stop" },
      closest: jest.fn(() => null)
    };
    const root = {
      querySelector: jest.fn(() => ({
        querySelector: jest.fn(() => stopAllButton)
      }))
    };

    globalThis.game = {
      user: { id: "gm", name: "Gamemaster", isGM: true, active: true },
      users: new Map([["player-a", {
        id: "player-a",
        name: "Player A",
        active: true
      }]]),
      modules: new Map([["fxbus", { version: "0.8.0" }]])
    };
    globalThis.ui = {
      notifications: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText } }
    });

    await copyActiveTabMacroToClipboard(app, root, {}, "stop");

    const macroSource = writeText.mock.calls[0][0];
    expect(macroSource).toContain('"action": "fx.screenShake.stop"');
    expect(macroSource).toContain('"audience"');
    expect(macroSource).toContain('"player-a"');
  });

  test("resource effect definitions expose their exact scoped Stop builders", () => {
    const tabDefs = buildGroups()
      .flatMap((group) => group.tabs)
      .reduce((byId, tabDef) => byId.set(tabDef.id, tabDef), new Map());

    for (const tabId of [
      "osc",
      "laser",
      "tokenBeam",
      "recoil",
      "tokenDollyZoom",
      "tileOsc",
      "tileRotation",
      "tileFlicker",
      "tileFlow"
    ]) {
      expect(typeof tabDefs.get(tabId)?.buildStopPayload).toBe("function");
    }
  });

  test("resource Stop builders preserve their effect-specific payload semantics", () => {
    globalThis.canvas = {
      tokens: { controlled: [{ id: "token-a" }] },
      tiles: { controlled: [{ id: "tile-a" }] }
    };

    const tokenPanel = {
      querySelector: jest.fn(() => ({ value: "cinematic-link" }))
    };
    const tilePanel = {
      querySelector: jest.fn((selector) =>
        selector.includes('name="tileFlowStopMode"')
          ? { value: "retain" }
          : null
      )
    };

    expect(tokenOscTabDef().buildStopPayload()).toEqual({
      action: "fx.tokenOsc.stop",
      tokenIds: ["token-a"]
    });
    expect(tokenLaserTabDef().buildStopPayload({
      querySelector: jest.fn(() => tokenPanel)
    })).toEqual({
      action: "fx.tokenLaser.stop",
      laserId: "cinematic-link"
    });
    expect(tokenDollyZoomTabDef().buildStopPayload()).toEqual({
      action: "fx.tokenDollyZoom.stop",
      restore: true
    });
    expect(tileFlowTabDef().buildStopPayload({
      querySelector: jest.fn(() => tilePanel)
    })).toEqual({
      action: "fx.tileFlow.stop",
      tileIds: ["tile-a"],
      stopMode: "retain"
    });
  });
});
