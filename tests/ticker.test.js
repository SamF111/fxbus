import { jest } from "@jest/globals";
import { cleanupTicker, ensureTicker } from "../scripts/ticker.js";

describe("shared ticker management", () => {
  let ticker;

  beforeEach(() => {
    ticker = {
      deltaMS: 20,
      add: jest.fn(),
      remove: jest.fn()
    };
    globalThis.canvas = { app: { ticker } };
  });

  afterEach(() => {
    delete globalThis.canvas;
    jest.restoreAllMocks();
  });

  test("passes PIXI deltaMS to the registered effect callback", () => {
    const runtime = { tickers: new Map() };
    const tick = jest.fn();

    ensureTicker(runtime, "effect", tick);
    runtime.tickers.get("effect")();

    expect(tick).toHaveBeenCalledWith(20);
  });

  test("replaces an existing callback under the same effect name", () => {
    const runtime = { tickers: new Map() };
    const first = jest.fn();
    const second = jest.fn();

    ensureTicker(runtime, "effect", first);
    const firstWrapper = runtime.tickers.get("effect");
    ensureTicker(runtime, "effect", second);

    expect(ticker.remove).toHaveBeenCalledWith(firstWrapper);
    expect(runtime.tickers.get("effect")).not.toBe(firstWrapper);
    expect(ticker.add).toHaveBeenCalledTimes(2);
  });

  test("removes a failing callback so it cannot repeatedly throw", () => {
    const runtime = { tickers: new Map() };
    const error = new Error("tick failed");
    jest.spyOn(console, "error").mockImplementation(() => {});

    ensureTicker(runtime, "effect", () => {
      throw error;
    });
    const wrapper = runtime.tickers.get("effect");
    wrapper();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("effect tick failed; resetting local FX"),
      error
    );
    expect(ticker.remove).toHaveBeenCalledWith(wrapper);
    expect(runtime.tickers.has("effect")).toBe(false);
  });

  test("a tick failure invokes the global reset handler locally", () => {
    const reset = jest.fn();
    const runtime = {
      tickers: new Map(),
      handlers: new Map([["fx.bus.reset", reset]])
    };
    const error = new Error("tick failed");
    jest.spyOn(console, "error").mockImplementation(() => {});

    ensureTicker(runtime, "screenShake", () => {
      throw error;
    });
    runtime.tickers.get("screenShake")();

    expect(reset).toHaveBeenCalledWith({
      action: "fx.bus.reset",
      reason: "tickerError",
      effectName: "screenShake"
    });
  });

  test("a recovery-reset failure is contained", () => {
    const resetError = new Error("reset failed");
    const reset = jest.fn(() => {
      throw resetError;
    });
    const runtime = {
      tickers: new Map(),
      handlers: new Map([["fx.bus.reset", reset]])
    };
    jest.spyOn(console, "error").mockImplementation(() => {});

    ensureTicker(runtime, "effect", () => {
      throw new Error("tick failed");
    });

    expect(() => runtime.tickers.get("effect")()).not.toThrow();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("ticker recovery reset failed"),
      expect.objectContaining({ resetError })
    );
    expect(runtime.tickers.has("effect")).toBe(false);
  });

  test("cleanup is a no-op when an effect has no ticker", () => {
    const runtime = { tickers: new Map() };

    cleanupTicker(runtime, "missing");

    expect(ticker.remove).not.toHaveBeenCalled();
  });
});
