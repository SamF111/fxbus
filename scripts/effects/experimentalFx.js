// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\experimentalFx.js

/**
 * FX Bus - Experimental Effects Registry
 *
 * Purpose:
 * - Provide a stable import target for experimental effects.
 * - Allow the main effects registry to call registerExperimentalFx(runtime)
 *   without caring whether any temporary experiments are currently active.
 *
 * Current experimental effect:
 * - None
 *
 * Notes:
 * - Keep this file as a no-op registry so index.js does not need to change every
 *   time the experimental slot is empty.
 * - Short-lived experiments may be added here temporarily.
 * - Stable effects should live in their own effect files and be registered from
 *   effects/index.js.
 */

export function registerExperimentalFx(_runtime) {
  /**
   * Large comment:
   * Register temporary experimental effects.
   *
   * This is intentionally a dummy no-op while there are no active experimental
   * effects. Keep the exported function in place so the main effects registry can
   * safely import and call it.
   */
}