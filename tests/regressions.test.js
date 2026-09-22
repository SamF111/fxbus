import { jest } from "@jest/globals";
import { registerScreenPulseFx } from "../scripts/effects/screenPulseFx.js";
import { screenBlurTabDef } from "../scripts/ui/tabs/screenBlurTab.js";
import { screenChromAbTabDef } from "../scripts/ui/tabs/screenChromAbTab.js";
import { screenNoiseTabDef } from "../scripts/ui/tabs/screenNoiseTab.js";
import { screenSmearTabDef } from "../scripts/ui/tabs/screenSmearTab.js";

class FakePoint {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

class FakeGraphics {
  constructor() {
    this.alpha = 0;
    this.parent = null;
  }

  clear() {}
  beginFill() {}
  drawRect() {}
  endFill() {}
  destroy() {}
}

function installPulseEnvironment() {
  const ticker = {
    deltaMS: 500,
    add: jest.fn(),
    remove: jest.fn()
  };
  const stage = {
    children: [],
    addChild(child) {
      child.parent = this;
      this.children.push(child);
    },
    removeChild(child) {
      child.parent = null;
      this.children = this.children.filter((entry) => entry !== child);
    },
    toLocal(point) {
      return point;
    }
  };

  globalThis.PIXI = {
    Point: FakePoint,
    Graphics: FakeGraphics,
    BLEND_MODES: {
      NORMAL: 0,
      SCREEN: 1,
      ADD: 2,
      MULTIPLY: 3,
      OVERLAY: 4
    }
  };
  globalThis.canvas = {
    app: {
      stage,
      renderer: { screen: { width: 1920, height: 1080 } },
      ticker
    }
  };

  return { ticker };
}

function makePulseRuntime() {
  return {
    handlers: new Map(),
    screenFx: new Map(),
    tickers: new Map()
  };
}

function input(value, checked = false) {
  return {
    value,
    checked,
    disabled: false,
    style: {},
    addEventListener: jest.fn()
  };
}

function durationRoot(tabId, checkboxName, durationName, duration = "4500") {
  const fields = {
    [checkboxName]: input("", true),
    [durationName]: input(duration)
  };
  const panel = {
    querySelector(selector) {
      const name = selector.match(/\[name="([^"]+)"\]/)?.[1];
      return name ? fields[name] ?? null : null;
    }
  };

  return {
    fields,
    root: {
      querySelector(selector) {
        return selector.includes(`data-tab="${tabId}"`) ? panel : null;
      }
    }
  };
}

describe("FX Bus regression coverage", () => {
  afterEach(() => {
    delete globalThis.PIXI;
    delete globalThis.canvas;
    delete globalThis.foundry;
    delete globalThis.Hooks;
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.fxbus;
  });

  test("registers one local-only effect cleanup for canvas teardown", async () => {
    class ApplicationV2 {}

    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2,
          HandlebarsApplicationMixin: (Base) => class extends Base {}
        },
        handlebars: {
          loadTemplates: jest.fn(),
          getTemplate: jest.fn()
        }
      }
    };
    globalThis.Hooks = {
      once: jest.fn(),
      on: jest.fn()
    };
    globalThis.game = {
      socket: { emit: jest.fn() }
    };
    globalThis.ui = { notifications: {} };

    const { registerCanvasTeardownCleanup } = await import("../scripts/fxbus.js");
    const reset = jest.fn();
    const runtime = {
      handlers: new Map([["fx.bus.reset", reset]])
    };

    registerCanvasTeardownCleanup(runtime);
    registerCanvasTeardownCleanup(runtime);

    expect(Hooks.on).toHaveBeenCalledWith(
      "canvasTearDown",
      expect.any(Function)
    );
    expect(Hooks.on).toHaveBeenCalledTimes(1);

    const cleanup = Hooks.on.mock.calls[0][1];
    cleanup();

    expect(reset).toHaveBeenCalledWith({ action: "fx.bus.reset" });
    expect(game.socket.emit).not.toHaveBeenCalled();
  });

  test("Screen Pulse in-out envelope starts and ends at zero and peaks halfway", () => {
    installPulseEnvironment();
    const runtime = makePulseRuntime();
    registerScreenPulseFx(runtime);

    runtime.handlers.get("fx.screenPulse.start")({
      mode: "static",
      durationMs: 1000,
      alpha: 1,
      ease: "inOut"
    });
    const overlay = runtime.__screenPulseOverlay;
    const tick = runtime.tickers.get("screenPulse");

    expect(overlay.alpha).toBeCloseTo(0);

    tick();
    expect(overlay.alpha).toBeCloseTo(1);

    tick();
    expect(overlay.alpha).toBeCloseTo(0);
    expect(runtime.__screenPulseOverlay).toBeNull();
  });

  test("Screen Pulse honours the Overlay blend-mode option", () => {
    installPulseEnvironment();
    const runtime = makePulseRuntime();
    registerScreenPulseFx(runtime);

    runtime.handlers.get("fx.screenPulse.start")({
      mode: "static",
      durationMs: 0,
      alpha: 1,
      blendMode: "OVERLAY"
    });

    expect(runtime.__screenPulseOverlay.blendMode).toBe(PIXI.BLEND_MODES.OVERLAY);
  });

  test("Screen Pulse falls back to Screen when PIXI has no Overlay mode", () => {
    installPulseEnvironment();
    delete PIXI.BLEND_MODES.OVERLAY;
    const runtime = makePulseRuntime();
    registerScreenPulseFx(runtime);

    runtime.handlers.get("fx.screenPulse.start")({
      mode: "static",
      durationMs: 0,
      alpha: 1,
      blendMode: "OVERLAY"
    });

    expect(runtime.__screenPulseOverlay.blendMode).toBe(PIXI.BLEND_MODES.SCREEN);
  });

  test.each([
    ["an explicit SCREEN value", "SCREEN"],
    ["an omitted legacy value", undefined]
  ])("Screen Pulse preserves %s as Screen blending", (_label, blendMode) => {
    installPulseEnvironment();
    const runtime = makePulseRuntime();
    registerScreenPulseFx(runtime);

    runtime.handlers.get("fx.screenPulse.start")({
      mode: "static",
      durationMs: 0,
      alpha: 1,
      ...(blendMode === undefined ? {} : { blendMode })
    });

    expect(runtime.__screenPulseOverlay.blendMode).toBe(PIXI.BLEND_MODES.SCREEN);
  });

  const durationCases = [
    ["Blur", screenBlurTabDef, "blur", "blurUntilStopped", "blurDurationMs"],
    ["Chromatic Aberration", screenChromAbTabDef, "chromab", "chromAbUntilStopped", "chromAbDurationMs"],
    ["Noise", screenNoiseTabDef, "noise", "noiseUntilStopped", "noiseDurationMs"],
    ["Smear", screenSmearTabDef, "smear", "smearUntilStopped", "smearDurationMs"]
  ];

  for (const [label, getTab, tabId, checkboxName, durationName] of durationCases) {
    test(`${label} preserves its configured duration while emitting indefinite duration`, () => {
      const { root, fields } = durationRoot(
        tabId,
        checkboxName,
        durationName
      );
      const tab = getTab();

      tab.wire(root, { emit: jest.fn() }, new AbortController().signal);

      expect(fields[durationName].disabled).toBe(true);
      expect(fields[durationName].value).toBe("4500");
      expect(tab.buildApplyPayload(root, {}).durationMs).toBe(0);

      fields[checkboxName].checked = false;
      expect(tab.buildApplyPayload(root, {}).durationMs).toBe(4500);
    });
  }
});
