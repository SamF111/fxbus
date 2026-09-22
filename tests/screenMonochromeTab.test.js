import { screenMonochromeTabDef } from "../scripts/ui/tabs/screenMonochromeTab.js";

describe("Screen Monochrome Apply action", () => {
  test("uses update semantics so Apply starts or updates", () => {
    const values = new Map([
      ['input[name="monoUntilStopped"]', { checked: false }],
      ['input[name="monoDurationMs"]', { value: "5000" }],
      ['input[name="monoFadeInMs"]', { value: "300" }],
      ['input[name="monoFadeOutMs"]', { value: "400" }],
      ['input[name="monoContrast"]', { value: "1.4" }],
      ['input[name="monoBrightness"]', { value: "0.9" }],
      ['input[name="monoAlpha"]', { value: "0.8" }]
    ]);
    const panel = {
      querySelector: (selector) => values.get(selector) ?? null
    };
    const root = {
      querySelector: (selector) => selector.includes('data-tab="monochrome"')
        ? panel
        : null
    };

    expect(screenMonochromeTabDef().buildApplyPayload(root)).toEqual({
      action: "fx.screenMonochrome.update",
      durationMs: 5000,
      fadeInMs: 300,
      fadeOutMs: 400,
      contrast: 1.4,
      brightness: 0.9,
      alpha: 0.8
    });
  });
});
