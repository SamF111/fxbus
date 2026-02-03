/**
 * FX Bus - Effects Registry
 */

import { registerTokenOscillationFx } from "./tokenOscillationFx.js";
import { registerScreenShakeFx } from "./screenShakeFx.js";
import { registerScreenPulseFx } from "./screenPulseFx.js";
import { registerScreenVignetteFx } from "./screenVignetteFx.js";
import { registerFxbusResetFx } from "./fxbusResetFx.js";
import { registerScreenChromAbFx } from "./screenChromAbFx.js";
import { registerScreenNoiseFx } from "./screenNoiseFx.js";

export function registerBuiltInEffects(runtime) {
  registerTokenOscillationFx(runtime);
  registerScreenShakeFx(runtime);
  registerScreenPulseFx(runtime);
  registerScreenVignetteFx(runtime);
  registerScreenChromAbFx(runtime);
  registerFxbusResetFx(runtime);
  registerScreenNoiseFx(runtime);
}
