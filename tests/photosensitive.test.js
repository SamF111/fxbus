import { jest } from "@jest/globals";
import {
  FX_SUPPRESSION_REASONS,
  getFxSuppressionReason,
  isLocalFxDisabled,
  isPhotosensitiveModeEnabled,
  isReducedMotionRequested,
  shouldSuppressFxForPhotosensitiveMode,
  shouldRespectReducedMotion,
  warnFxSuppressed,
  warnPhotosensitiveFxSuppressed
} from "../scripts/photosensitive.js";

describe("FX Bus Photosensitive Mode", () => {
  afterEach(() => {
    delete globalThis.canvas;
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.window;
    jest.restoreAllMocks();
  });

  test("reads Foundry's canvas preference", () => {
    globalThis.canvas = { photosensitiveMode: true };

    expect(isPhotosensitiveModeEnabled()).toBe(true);
  });

  test("falls back to Foundry's core client setting", () => {
    globalThis.game = {
      settings: { get: jest.fn(() => true) }
    };

    expect(isPhotosensitiveModeEnabled()).toBe(true);
    expect(game.settings.get).toHaveBeenCalledWith("core", "photosensitiveMode");
  });

  test("reads the FX Bus client opt-out setting", () => {
    globalThis.game = {
      settings: {
        get: jest.fn((namespace, key) =>
          namespace === "fxbus" && key === "disableLocalFx")
      }
    };

    expect(isLocalFxDisabled()).toBe(true);
    expect(getFxSuppressionReason({ action: "fx.screenShake.start" })).toBe(
      FX_SUPPRESSION_REASONS.LOCAL_DISABLED
    );
  });

  test("reads the system reduced-motion preference and client policy", () => {
    globalThis.window = {
      matchMedia: jest.fn(() => ({ matches: true }))
    };
    globalThis.game = {
      settings: {
        get: jest.fn((namespace, key) =>
          namespace === "fxbus" && key === "respectReducedMotion")
      }
    };

    expect(isReducedMotionRequested()).toBe(true);
    expect(shouldRespectReducedMotion()).toBe(true);
    expect(getFxSuppressionReason({ action: "fx.screenRotate.start" })).toBe(
      FX_SUPPRESSION_REASONS.REDUCED_MOTION
    );
  });

  test("does not suppress for reduced motion when its client policy is disabled", () => {
    globalThis.window = {
      matchMedia: jest.fn(() => ({ matches: true }))
    };
    globalThis.game = {
      settings: { get: jest.fn(() => false) }
    };

    expect(getFxSuppressionReason({ action: "fx.screenRotate.start" })).toBeNull();
  });

  test.each([
    "fx.screenShake.start",
    "fx.screenMonochrome.update",
    "fx.tokenLaser.toggle",
    "fx.tokenRecoil.burst"
  ])("completely suppresses visual action %s", (action) => {
    globalThis.canvas = { photosensitiveMode: true };

    expect(shouldSuppressFxForPhotosensitiveMode({ action })).toBe(true);
  });

  test.each([
    "fx.screenShake.stop",
    "fx.tokenLaser.stopAll",
    "fx.tokenBeam.hardReset",
    "fx.bus.reset"
  ])("always permits cleanup action %s", (action) => {
    globalThis.canvas = { photosensitiveMode: true };

    expect(shouldSuppressFxForPhotosensitiveMode({ action })).toBe(false);
  });

  test("does not suppress effects when the preference is disabled", () => {
    globalThis.canvas = { photosensitiveMode: false };

    expect(shouldSuppressFxForPhotosensitiveMode({
      action: "fx.screenPulse.start"
    })).toBe(false);
  });

  test("warns the local user with a readable effect name", () => {
    globalThis.ui = { notifications: { warn: jest.fn() } };
    jest.spyOn(console, "warn").mockImplementation(() => {});

    warnPhotosensitiveFxSuppressed({ action: "fx.screenShake.start" });

    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus suppressed Screen Shake because Photosensitive Mode is enabled."
    );
  });

  test("warns when the user disabled local effects", () => {
    globalThis.ui = { notifications: { warn: jest.fn() } };
    jest.spyOn(console, "warn").mockImplementation(() => {});

    warnFxSuppressed(
      { action: "fx.screenPulse.start" },
      FX_SUPPRESSION_REASONS.LOCAL_DISABLED
    );

    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus suppressed Screen Pulse because effects are disabled on this client."
    );
  });

  test("warns when the system requests reduced motion", () => {
    globalThis.ui = { notifications: { warn: jest.fn() } };
    jest.spyOn(console, "warn").mockImplementation(() => {});

    warnFxSuppressed(
      { action: "fx.screenRotate.start" },
      FX_SUPPRESSION_REASONS.REDUCED_MOTION
    );

    expect(ui.notifications.warn).toHaveBeenCalledWith(
      "FX Bus suppressed Screen Roll because your system requests reduced motion."
    );
  });
});
