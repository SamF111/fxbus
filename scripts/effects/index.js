/**
 * FX Bus (Foundry VTT v12+)
 * Effects registration.
 *
 * Responsibilities:
 * - Register all built-in FX handlers onto runtime.handlers.
 * - Keep effect modules isolated and composable.
 */

import { registerTokenOscillationFx } from "./tokenOscillationFx.js";
import { registerScreenShakeFx } from "./screenShakeFx.js";
import { registerScreenPulseFx } from "./screenPulseFx.js";
import { registerScreenVignetteFx } from "./screenVignetteFx.js";
import { registerFxBusResetFx } from "./fxbusResetFx.js";

/**
 * Register all built-in effects.
 *
 * @param {object} runtime
 */
export function registerBuiltInEffects(runtime) {
  registerTokenOscillationFx(runtime);
  registerScreenShakeFx(runtime);
  registerScreenPulseFx(runtime);
  registerScreenVignetteFx(runtime);
  registerFxBusResetFx(runtime);
}
