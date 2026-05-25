// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\index.js

/**
 * FX Bus - Effects Registry
 */

import { registerTokenOscillationFx } from "./tokenOscillationFx.js";
import { registerTokenLaserFx } from "./tokenLaserFx.js";
import { registerTokenRecoilFx } from "./tokenRecoilFx.js";

import { registerScreenShakeFx } from "./screenShakeFx.js";
import { registerScreenPulseFx } from "./screenPulseFx.js";
import { registerScreenVignetteFx } from "./screenVignetteFx.js";
import { registerScreenChromAbFx } from "./screenChromAbFx.js";
import { registerScreenNoiseFx } from "./screenNoiseFx.js";
import { registerScreenBlurFx } from "./screenBlurFx.js";
import { registerScreenSmearFx } from "./screenSmearFx.js";
import { registerScreenStreakFx } from "./screenStreakFx.js";
import { registerScreenMonochromeFx } from "./screenMonochromeFx.js";
import { registerScreenRotateFx } from "./screenRotateFx.js";

import { registerTileOscillationFx } from "./tileOscillationFx.js";

import { registerFxbusResetFx } from "./fxbusResetFx.js";

export function registerBuiltInEffects(runtime) {
  registerTokenOscillationFx(runtime);
  registerTokenLaserFx(runtime);
  registerTokenRecoilFx(runtime);

  registerScreenShakeFx(runtime);
  registerScreenPulseFx(runtime);
  registerScreenVignetteFx(runtime);
  registerScreenChromAbFx(runtime);
  registerScreenNoiseFx(runtime);
  registerScreenBlurFx(runtime);
  registerScreenSmearFx(runtime);
  registerScreenStreakFx(runtime);
  registerScreenMonochromeFx(runtime);
  registerScreenRotateFx(runtime);

  registerTileOscillationFx(runtime);

  registerFxbusResetFx(runtime);
}