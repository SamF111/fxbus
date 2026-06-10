// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\index.js

/**
 * FX Bus - Effects Registry
 *
 * Purpose:
 * - Register all built-in production effects.
 * - Register a separate experimental effects bundle from one place.
 *
 * Why this exists:
 * - The main registry should stay stable for production effects.
 * - Experimental effects can still be registered from experimentalFx.js.
 * - Effects that graduate out of experimental status should be imported and
 *   registered directly here.
 */

import { registerTokenOscillationFx } from "./tokenOscillationFx.js";
import { registerTokenLaserFx } from "./tokenLaserFx.js";
import { registerTokenRecoilFx } from "./tokenRecoilFx.js";
import { registerTokenDollyZoomFx } from "./tokenDollyZoomFx.js";

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
import { registerTileFlickerFx } from "./tileFlickerFx.js";
import { registerTileFlowFx } from "./tileFlowFx.js";

import { registerExperimentalFx } from "./experimentalFx.js";

import { registerFxbusResetFx } from "./fxbusResetFx.js";

export function registerBuiltInEffects(runtime) {
  /**
   * Large comment:
   * Register stable production token effects.
   *
   * These are token-related visual effects intended to be part of the normal
   * FX Bus runtime.
   */
  registerTokenOscillationFx(runtime);
  registerTokenLaserFx(runtime);
  registerTokenRecoilFx(runtime);
  registerTokenDollyZoomFx(runtime);

  /**
   * Large comment:
   * Register stable production screen and canvas effects.
   *
   * Screen Rotate is internally named as a screen effect because that is how the
   * existing implementation is structured, even if the UI may present it under
   * Canvas.
   */
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

  /**
   * Large comment:
   * Register stable production tile effects.
   */
  registerTileOscillationFx(runtime);
  registerTileFlickerFx(runtime);
  registerTileFlowFx(runtime);

  /**
   * Large comment:
   * Register experimental effects in one place.
   *
   * This may currently be a dummy no-op function. Keep the call so future
   * temporary experiments can be added without changing this file every time.
   */
  registerExperimentalFx(runtime);

  /**
   * Large comment:
   * Register Reset last so it can stop production and experimental effects.
   */
  registerFxbusResetFx(runtime);
}