import { jest } from "@jest/globals";
import { copyActiveTabApplyToClipboard } from "../scripts/ui/panel/panelMacroCopy.js";

describe("panel macro audience authoring", () => {
  afterEach(() => {
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.navigator;
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
});
