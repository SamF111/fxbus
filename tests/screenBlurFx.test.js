import { jest } from "@jest/globals";
import { registerScreenBlurFx } from "../scripts/effects/screenBlurFx.js";

function installCanvas() {
  globalThis.canvas = {
    stage: { filters: null },
    app: {
      ticker: {
        add: jest.fn(),
        remove: jest.fn(),
        deltaMS: 16
      }
    }
  };
}

function runtime() {
  return {
    handlers: new Map(),
    tickers: new Map()
  };
}

describe("Screen Blur PIXI compatibility", () => {
  beforeEach(() => {
    installCanvas();
  });

  afterEach(() => {
    delete globalThis.PIXI;
    delete globalThis.canvas;
  });

  test("prefers the current direct PIXI.BlurFilter constructor", () => {
    const DirectBlurFilter = jest.fn(function DirectBlurFilter() {
      this.blur = 0;
    });
    const LegacyBlurFilter = jest.fn(function LegacyBlurFilter() {
      this.blur = 0;
    });
    globalThis.PIXI = {
      BlurFilter: DirectBlurFilter,
      filters: { BlurFilter: LegacyBlurFilter }
    };

    const rt = runtime();
    registerScreenBlurFx(rt);
    rt.handlers.get("fx.screenBlur.start")({ strength: 6, quality: 4 });

    expect(DirectBlurFilter).toHaveBeenCalledTimes(1);
    expect(LegacyBlurFilter).not.toHaveBeenCalled();
    expect(canvas.stage.filters).toHaveLength(1);
    expect(canvas.stage.filters[0]).toBeInstanceOf(DirectBlurFilter);
  });

  test("falls back to the legacy PIXI.filters.BlurFilter constructor", () => {
    const LegacyBlurFilter = jest.fn(function LegacyBlurFilter() {
      this.blur = 0;
    });
    globalThis.PIXI = {
      filters: { BlurFilter: LegacyBlurFilter }
    };

    const rt = runtime();
    registerScreenBlurFx(rt);
    rt.handlers.get("fx.screenBlur.start")({ strength: 6, quality: 4 });

    expect(LegacyBlurFilter).toHaveBeenCalledTimes(1);
    expect(canvas.stage.filters[0]).toBeInstanceOf(LegacyBlurFilter);
  });
});
