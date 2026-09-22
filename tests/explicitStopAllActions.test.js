import { registerTileOscillationFx } from "../scripts/effects/tileOscillationFx.js";
import { registerTokenOscillationFx } from "../scripts/effects/tokenOscillationFx.js";
import { registerTokenRecoilFx } from "../scripts/effects/tokenRecoilFx.js";

function runtime() {
  return {
    handlers: new Map(),
    tickers: new Map(),
    tokenFx: new Map(),
    tileFx: new Map()
  };
}

describe("explicit Stop All actions", () => {
  afterEach(() => {
    delete globalThis.fxbusTokenOscillation;
  });

  test.each([
    [registerTokenOscillationFx, "fx.tokenOsc.stopAll"],
    [registerTokenRecoilFx, "fx.tokenRecoil.stopAll"],
    [registerTileOscillationFx, "fx.tileOscillation.stopAll"]
  ])("registers %s", (register, action) => {
    const fxRuntime = runtime();

    register(fxRuntime);

    expect(fxRuntime.handlers.get(action)).toEqual(expect.any(Function));
  });
});
