import { jest } from "@jest/globals";
import {
  registerLocalFxPreference,
  registerReducedMotionListener
} from "../scripts/localFxPreference.js";

function settingOptions(settings, key) {
  return settings.register.mock.calls.find((call) => call[1] === key)?.[2];
}

describe("FX Bus local effect preference", () => {
  afterEach(() => {
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.canvas;
    delete globalThis.window;
    jest.restoreAllMocks();
  });

  test("registers an accessible client-only opt-out", () => {
    const settings = { register: jest.fn() };

    expect(registerLocalFxPreference({
      id: "fxbus",
      handlers: new Map()
    }, settings)).toBe(true);

    expect(settings.register).toHaveBeenCalledWith(
      "fxbus",
      "disableLocalFx",
      expect.objectContaining({
        scope: "client",
        config: true,
        type: Boolean,
        default: false,
        onChange: expect.any(Function)
      })
    );
    expect(settings.register).toHaveBeenCalledWith(
      "fxbus",
      "respectReducedMotion",
      expect.objectContaining({
        name: "Block FX when reduced motion is enabled",
        hint: expect.stringContaining("Turn this off to allow full FX on this client."),
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: expect.any(Function)
      })
    );
  });

  test("enabling the opt-out resets only the local runtime", () => {
    const reset = jest.fn();
    const settings = { register: jest.fn() };
    const notifications = { warn: jest.fn(), info: jest.fn() };
    const runtime = {
      id: "fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    };
    globalThis.game = {
      userId: "player",
      settings: { get: jest.fn(() => true) },
      socket: { emit: jest.fn() }
    };

    registerLocalFxPreference(runtime, settings, notifications);
    const options = settingOptions(settings, "disableLocalFx");
    options.onChange(true);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(game.socket.emit).not.toHaveBeenCalled();
    expect(notifications.warn).toHaveBeenCalledWith(
      "FX Bus effects are now disabled on this client."
    );
  });

  test("re-enabling effects informs the local user without dispatching", () => {
    const settings = { register: jest.fn() };
    const notifications = { warn: jest.fn(), info: jest.fn() };
    const reset = jest.fn();

    registerLocalFxPreference({
      id: "fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    }, settings, notifications);
    settingOptions(settings, "disableLocalFx").onChange(false);

    expect(reset).not.toHaveBeenCalled();
    expect(notifications.info).toHaveBeenCalledWith(
      "FX Bus effects are now enabled on this client."
    );
  });

  test("resolves notifications when the setting changes, not only during init", () => {
    const settings = { register: jest.fn() };
    const reset = jest.fn();

    registerLocalFxPreference({
      id: "fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    }, settings);

    globalThis.ui = { notifications: { warn: jest.fn(), info: jest.fn() } };
    settingOptions(settings, "disableLocalFx").onChange(true);

    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus effects are now disabled on this client."
    );
  });

  test("enabling reduced-motion support clears local effects when requested", () => {
    const settings = { register: jest.fn() };
    const notifications = { warn: jest.fn(), info: jest.fn() };
    const reset = jest.fn();
    const windowRef = {
      matchMedia: jest.fn(() => ({
        matches: true,
        addEventListener: jest.fn()
      }))
    };

    registerLocalFxPreference({
      id: "fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    }, settings, notifications, windowRef);
    settingOptions(settings, "respectReducedMotion").onChange(true);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(notifications.warn).toHaveBeenCalledWith(
      "FX Bus effects were cleared because this browser reports reduced motion. " +
      "To allow full effects, turn off \"Block FX when reduced motion is enabled\" in " +
      "Configure Settings → Module Settings → FX Bus."
    );
  });

  test("a live reduced-motion change clears local effects when enabled", () => {
    let listener;
    const settings = {
      get: jest.fn(() => true),
      register: jest.fn()
    };
    const notifications = { warn: jest.fn() };
    const reset = jest.fn();
    const runtime = {
      id: "fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    };
    const windowRef = {
      matchMedia: jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn((_type, fn) => {
          listener = fn;
        })
      }))
    };

    expect(registerReducedMotionListener(
      runtime,
      settings,
      notifications,
      windowRef
    )).toBe(true);
    listener({ matches: true });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(notifications.warn).toHaveBeenCalledWith(
      "FX Bus effects were cleared because this browser now reports reduced motion. " +
      "To allow full effects, turn off \"Block FX when reduced motion is enabled\" in " +
      "Configure Settings → Module Settings → FX Bus."
    );
  });

  test("a live reduced-motion change is ignored when its client policy is disabled", () => {
    let listener;
    const settings = { get: jest.fn(() => false) };
    const reset = jest.fn();
    const runtime = {
      id: "fxbus",
      handlers: new Map([["fx.bus.reset", reset]])
    };
    const windowRef = {
      matchMedia: jest.fn(() => ({
        matches: false,
        addEventListener: jest.fn((_type, fn) => {
          listener = fn;
        })
      }))
    };

    registerReducedMotionListener(runtime, settings, undefined, windowRef);
    listener({ matches: true });

    expect(reset).not.toHaveBeenCalled();
  });
});
