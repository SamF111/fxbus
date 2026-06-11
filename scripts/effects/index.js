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
import { registerTokenBeamFx } from "./tokenBeamFx.js";
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

import { registerCanvasMirrorFx } from "./canvasMirrorFx.js";

import { registerTileOscillationFx } from "./tileOscillationFx.js";
import { registerTileRotationFx } from "./tileRotationFx.js";
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
   *
   * Naming note:
   * - Token Laser is the older token-to-token tether/link implementation.
   * - Token Beam is the new single-origin power beam implementation, exposed in
   *   the UI as a true token laser.
   */
  registerTokenOscillationFx(runtime);
  registerTokenLaserFx(runtime);
  registerTokenBeamFx(runtime);
  registerTokenRecoilFx(runtime);
  registerTokenDollyZoomFx(runtime);

  /**
   * Large comment:
   * Register stable production screen effects.
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

  /**
   * Large comment:
   * Register stable production canvas effects.
   *
   * Screen Rotate is internally named as a screen effect because that is how the
   * existing implementation is structured, even if the UI may present it under
   * Canvas. Canvas Mirror is a true canvas-output effect because it mirrors the
   * rendered canvas element rather than mutating PIXI scene objects.
   */
  registerScreenRotateFx(runtime);
  registerCanvasMirrorFx(runtime);

  /**
   * Large comment:
   * Register stable production tile effects.
   *
   * Tile Rotation is an indefinite visual-only tile rotation effect intended for
   * orbiting props, gears, fans, magic circles, rotating planets, and similar
   * environmental motion.
   */
  registerTileOscillationFx(runtime);
  registerTileRotationFx(runtime);
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