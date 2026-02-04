// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\index.js

/**
 * FX Bus - Effects Registry
 */

import { registerTokenOscillationFx } from "./tokenOscillationFx.js";
import { registerScreenShakeFx } from "./screenShakeFx.js";
import { registerScreenPulseFx } from "./screenPulseFx.js";
import { registerScreenVignetteFx } from "./screenVignetteFx.js";
import { registerScreenChromAbFx } from "./screenChromAbFx.js";
import { registerScreenNoiseFx } from "./screenNoiseFx.js";
import { registerScreenBlurFx } from "./screenBlurFx.js";
import { registerScreenSmearFx } from "./screenSmearFx.js";
import { registerScreenStreakFx } from "./screenStreakFx.js";
import { registerFxbusResetFx } from "./fxbusResetFx.js";

export function registerBuiltInEffects(runtime) {
  registerTokenOscillationFx(runtime);
  registerScreenShakeFx(runtime);
  registerScreenPulseFx(runtime);
  registerScreenVignetteFx(runtime);
  registerScreenChromAbFx(runtime);
  registerScreenNoiseFx(runtime);
  registerScreenBlurFx(runtime);
  registerScreenSmearFx(runtime);
  registerScreenStreakFx(runtime);
  registerFxbusResetFx(runtime);
}
