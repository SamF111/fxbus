import { jest } from "@jest/globals";
import { registerFxbusResetFx } from "../scripts/effects/fxbusResetFx.js";

const ACTIONS = [
  "fx.tokenOsc.stop",
  "fx.tokenRecoil.stop",
  "fx.tokenDollyZoom.stop",
  "fx.tokenLaser.stopAll",
  "fx.tokenLaser.hardReset",
  "fx.tokenBeam.stopAll",
  "fx.tokenBeam.hardReset",
  "fx.tileOscillation.stop",
  "fx.tileRotation.stop",
  "fx.tileFlicker.stop",
  "fx.tileFlow.stop",
  "fx.screenShake.stop",
  "fx.screenRotate.stop",
  "fx.screenPulse.stop",
  "fx.screenVignette.stop",
  "fx.chromAb.stop",
  "fx.noise.stop",
  "fx.screenBlur.stop",
  "fx.screenSmear.stop",
  "fx.screenStreak.stop",
  "fx.screenMonochrome.stop",
  "fx.canvasMirror.stop"
];

function makeRuntime() {
  const handlers = new Map(ACTIONS.map((action) => [action, jest.fn()]));

  return {
    handlers,
    tickers: new Map(),
    tokenFx: new Map([
      ["tokenOscillation", new Map([["token-a", { active: true }]])]
    ]),
    tileFx: new Map([
      ["tileRotation", new Map([["tile-a", { active: true }]])]
    ]),
    screenFx: new Map([["screenShake", { active: true }]]),
    tileCloneFx: new Map([["tile-a", {}]]),
    tileCloneContainer: new Map([["tile-a", {}]])
  };
}

describe("global FX reset", () => {
  beforeEach(() => {
    globalThis.canvas = {
      app: {
        ticker: {
          add: jest.fn(),
          remove: jest.fn()
        }
      }
    };
  });

  afterEach(() => {
    delete globalThis.canvas;
    jest.restoreAllMocks();
  });

  test("invokes every registered stop family and clears runtime state", () => {
    const runtime = makeRuntime();
    const orphanTicker = jest.fn();
    runtime.tickers.set("orphan", orphanTicker);
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxbusResetFx(runtime);
    runtime.handlers.get("fx.bus.reset")();

    for (const action of ACTIONS) {
      expect(runtime.handlers.get(action)).toHaveBeenCalled();
    }

    expect(runtime.handlers.get("fx.tokenOsc.stop")).toHaveBeenCalledWith(
      expect.objectContaining({ tokenIds: ["token-a"] })
    );
    expect(runtime.handlers.get("fx.tileRotation.stop")).toHaveBeenCalledWith(
      expect.objectContaining({
        tileIds: ["tile-a"],
        forceReset: true,
        stopMode: "reset"
      })
    );
    expect(runtime.handlers.get("fx.screenShake.stop")).toHaveBeenCalledWith(
      expect.objectContaining({ immediate: true, forceReset: true })
    );
    expect(canvas.app.ticker.remove).toHaveBeenCalledWith(orphanTicker);
    expect(runtime.tickers.size).toBe(0);
    expect(runtime.tokenFx.size).toBe(0);
    expect(runtime.tileFx.size).toBe(0);
    expect(runtime.screenFx.size).toBe(0);
    expect(runtime.tileCloneFx.size).toBe(0);
    expect(runtime.tileCloneContainer.size).toBe(0);
  });

  test("one broken stop handler does not prevent later cleanup", () => {
    const runtime = makeRuntime();
    const laterHandler = runtime.handlers.get("fx.screenRotate.stop");
    runtime.handlers.set(
      "fx.screenShake.stop",
      jest.fn(() => {
        throw new Error("broken stop");
      })
    );
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "log").mockImplementation(() => {});

    registerFxbusResetFx(runtime);
    runtime.handlers.get("fx.bus.reset")();

    expect(laterHandler).toHaveBeenCalled();
    expect(runtime.tokenFx.size).toBe(0);
    expect(runtime.tileFx.size).toBe(0);
    expect(runtime.screenFx.size).toBe(0);
  });
});
