import { jest } from "@jest/globals";
import { fxbusBuildMacroSource } from "../scripts/util/fxbusMacroUtils.js";

describe("FX Bus generated macros", () => {
  afterEach(() => {
    delete globalThis.fxbus;
    delete globalThis.ui;
    delete globalThis.game;
  });

  test("legacy untargeted payloads execute through the shared runtime unchanged", () => {
    const emit = jest.fn();
    globalThis.fxbus = { emit };
    globalThis.ui = { notifications: { error: jest.fn() } };
    const payload = {
      action: "fx.screenShake.start",
      intensityPx: 12,
      durationMs: 800
    };
    const source = fxbusBuildMacroSource("Screen Shake", payload);

    Function(source)();

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(payload);
    expect(source).not.toContain("recipient");
  });

  test("preserves payload strings that contain template-literal characters", () => {
    const emit = jest.fn();
    globalThis.fxbus = { emit };
    globalThis.ui = { notifications: { error: jest.fn() } };
    const payload = {
      action: "fx.test",
      label: "`${danger}` and \\ paths"
    };

    Function(fxbusBuildMacroSource("Macro `${name}`", payload))();

    expect(emit).toHaveBeenCalledWith(payload);
  });

  test("fails visibly when the FX Bus runtime is unavailable", () => {
    globalThis.ui = { notifications: { error: jest.fn() } };
    const source = fxbusBuildMacroSource("Missing Runtime", {
      action: "fx.test"
    });

    expect(() => Function(source)()).toThrow("FX Bus runtime not available.");
    expect(ui.notifications.error).toHaveBeenCalledWith(
      "FX Bus runtime not available."
    );
  });

  test("rejects non-object payloads", () => {
    expect(() => fxbusBuildMacroSource("Bad", null)).toThrow(
      "payload must be an object"
    );
  });

  test("deprecated forceSocket requests use the safe runtime emitter", () => {
    const emit = jest.fn();
    globalThis.fxbus = { emit };
    globalThis.ui = { notifications: { error: jest.fn() } };
    globalThis.game = { socket: { emit: jest.fn() } };
    const payload = { action: "fx.test", value: 9 };
    const source = fxbusBuildMacroSource("Legacy Builder", payload, {
      forceSocket: true,
      socketNamespace: "module.legacy"
    });

    Function(source)();

    expect(emit).toHaveBeenCalledWith(payload);
    expect(game.socket.emit).not.toHaveBeenCalled();
    expect(source).not.toContain("game.socket.emit");
  });
});
