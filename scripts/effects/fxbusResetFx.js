// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\fxbusResetFx.js

/**
 * FX Bus - Global Reset FX
 *
 * Purpose:
 * - Stop ALL FX and restore visuals to the pre-FX baseline.
 *
 * Mechanism:
 * - Dispatch each effect's STOP action so that it can restore its own snapshots.
 * - Dispatch hard-reset handlers where available for defensive orphan cleanup.
 * - Then hard-clean tickers and residual maps as a backstop.
 *
 * Assumptions:
 * - Token effects are stored in runtime.tokenFx as Map(effectName -> Map(tokenId -> state)).
 * - Tile effects are stored in runtime.tileFx as Map(effectName -> Map(tileId -> state)).
 * - Screen effects are stored in runtime.screenFx as Map(effectName -> state).
 * - Each effect provides a stop handler registered on runtime.handlers for its stop action.
 * - Some effects may provide a hard reset handler for orphaned PIXI cleanup.
 * - Ticker utilities manage runtime.tickers as Map(effectName -> wrappedTickerFn) and must be removed via cleanupTicker().
 */

import { cleanupTicker } from "../ticker.js";

const ACTION_RESET = "fx.bus.reset";

// Token stop actions
const TOKEN_OSC_STOP = "fx.tokenOsc.stop";
const TOKEN_OSC_STOP_LEGACY = "tokenOscStop";
const TOKEN_LASER_STOP_ALL = "fx.tokenLaser.stopAll";
const TOKEN_LASER_HARD_RESET = "fx.tokenLaser.hardReset";

// Tile stop actions
const TILE_OSC_STOP = "fx.tileOscillation.stop";
const TILE_OSC_STOP_LEGACY = "tileOscStop";

// Screen stop actions
const SCREEN_SHAKE_STOP = "fx.screenShake.stop";
const SCREEN_PULSE_STOP = "fx.screenPulse.stop";
const SCREEN_VIGNETTE_STOP = "fx.screenVignette.stop";
const CHROM_AB_STOP = "fx.chromAb.stop";
const NOISE_STOP = "fx.noise.stop";
const SCREEN_BLUR_STOP = "fx.screenBlur.stop";
const SCREEN_SMEAR_STOP = "fx.screenSmear.stop";
const SCREEN_STREAK_STOP = "fx.screenStreak.stop";
const SCREEN_MONOCHROME_STOP = "fx.screenMonochrome.stop";
const SCREEN_COLOUR_SHIFT_STOP = "fx.screenColourShift.stop";

export function registerFxbusResetFx(runtime) {
  if (!runtime?.handlers) {
    throw new Error("[FX Bus] fxbusResetFx: invalid runtime.");
  }

  runtime.handlers.set(ACTION_RESET, () => onReset(runtime));
}

function safeCallHandler(runtime, action, payload) {
  /**
   * Large comment:
   * Call an effect stop handler without allowing one broken effect to block
   * the rest of the global reset.
   *
   * Reset must be defensive: its job is to recover the visual state even after
   * partial effect failure, missing handlers, or stale runtime maps.
   */
  const fn = runtime.handlers.get(action);

  if (typeof fn !== "function") {
    console.warn("[FX Bus] reset: missing handler", { action });
    return;
  }

  try {
    fn(payload ?? { action });
  } catch (err) {
    console.error("[FX Bus] reset: handler threw", { action, err });
  }
}

function hasHandler(runtime, action) {
  return typeof runtime?.handlers?.get?.(action) === "function";
}

function collectIdsFromNestedFxMap(rootMap) {
  /**
   * Large comment:
   * Collect placeable ids from a nested FX map.
   *
   * Expected shape:
   *   Map(effectName -> Map(placeableId -> state))
   *
   * Compatibility shape:
   *   Map(placeableId -> state)
   *
   * Plain object fallbacks are included because reset should recover from older
   * local builds rather than assuming a perfect current runtime.
   */
  const ids = new Set();

  if (!rootMap) return [];

  if (rootMap instanceof Map) {
    for (const [key, value] of rootMap.entries()) {
      if (value instanceof Map) {
        for (const id of value.keys()) {
          if (typeof id === "string" && id.length > 0) ids.add(id);
        }
        continue;
      }

      if (typeof key === "string" && key.length > 0) {
        ids.add(key);
      }
    }

    return Array.from(ids);
  }

  if (typeof rootMap === "object") {
    for (const [key, value] of Object.entries(rootMap)) {
      if (value instanceof Map) {
        for (const id of value.keys()) {
          if (typeof id === "string" && id.length > 0) ids.add(id);
        }
        continue;
      }

      if (value && typeof value === "object") {
        for (const id of Object.keys(value)) {
          if (typeof id === "string" && id.length > 0) ids.add(id);
        }
        continue;
      }

      if (typeof key === "string" && key.length > 0) {
        ids.add(key);
      }
    }
  }

  return Array.from(ids);
}

function stopIfPresent(runtime, action, payload) {
  if (!hasHandler(runtime, action)) return;
  safeCallHandler(runtime, action, payload ?? { action });
}

function backstopTickerCleanup(runtime) {
  /**
   * Large comment:
   * Remove every remaining effect ticker after all stop handlers have had a
   * chance to restore their own snapshots.
   *
   * This is a backstop only. It should not replace proper stop handlers because
   * raw ticker removal alone cannot restore render transforms, stage offsets,
   * filters, or overlays.
   */
  try {
    const names = Array.from(runtime?.tickers?.keys?.() ?? []);

    for (const effectName of names) {
      cleanupTicker(runtime, effectName);
    }
  } catch (err) {
    console.warn("[FX Bus] reset: ticker cleanup issue", err);
  }
}

function clearMapLike(value) {
  /**
   * Large comment:
   * Clear Map-like runtime state without assuming the container exists.
   *
   * Tile FX state is optional because older runtime creation does not initialise
   * runtime.tileFx. The tile effect can create it lazily.
   */
  if (!value) return;

  if (typeof value.clear === "function") {
    value.clear();
    return;
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      delete value[key];
    }
  }
}

function onReset(runtime) {
  /**
   * Large comment:
   * Global reset order matters:
   *
   * 1. Stop token effects using explicit handlers so token transforms and token-linked overlays restore.
   * 2. Hard-reset token laser containers to remove orphaned PIXI graphics on desynchronised clients.
   * 3. Stop tile effects using explicit tileIds so tile transforms restore.
   * 4. Stop screen effects so stage offsets, filters, and overlays restore.
   * 5. Remove any residual tickers.
   * 6. Clear runtime maps as a final backstop.
   */
  const tokenIds = collectIdsFromNestedFxMap(runtime.tokenFx);

  if (tokenIds.length > 0) {
    if (hasHandler(runtime, TOKEN_OSC_STOP)) {
      safeCallHandler(runtime, TOKEN_OSC_STOP, {
        action: TOKEN_OSC_STOP,
        tokenIds
      });
    } else if (hasHandler(runtime, TOKEN_OSC_STOP_LEGACY)) {
      safeCallHandler(runtime, TOKEN_OSC_STOP_LEGACY, {
        action: TOKEN_OSC_STOP_LEGACY,
        tokenIds
      });
    }
  }

  stopIfPresent(runtime, TOKEN_LASER_STOP_ALL, {
    action: TOKEN_LASER_STOP_ALL
  });

  stopIfPresent(runtime, TOKEN_LASER_HARD_RESET, {
    action: TOKEN_LASER_HARD_RESET
  });

  const tileIds = collectIdsFromNestedFxMap(runtime.tileFx);

  if (tileIds.length > 0) {
    if (hasHandler(runtime, TILE_OSC_STOP)) {
      safeCallHandler(runtime, TILE_OSC_STOP, {
        action: TILE_OSC_STOP,
        tileIds
      });
    } else if (hasHandler(runtime, TILE_OSC_STOP_LEGACY)) {
      safeCallHandler(runtime, TILE_OSC_STOP_LEGACY, {
        action: TILE_OSC_STOP_LEGACY,
        tileIds
      });
    }
  }

  stopIfPresent(runtime, SCREEN_SHAKE_STOP);
  stopIfPresent(runtime, SCREEN_PULSE_STOP);
  stopIfPresent(runtime, SCREEN_VIGNETTE_STOP);
  stopIfPresent(runtime, CHROM_AB_STOP);
  stopIfPresent(runtime, NOISE_STOP);
  stopIfPresent(runtime, SCREEN_BLUR_STOP);
  stopIfPresent(runtime, SCREEN_SMEAR_STOP);
  stopIfPresent(runtime, SCREEN_STREAK_STOP);
  stopIfPresent(runtime, SCREEN_COLOUR_SHIFT_STOP);

  stopIfPresent(runtime, SCREEN_MONOCHROME_STOP, {
    action: SCREEN_MONOCHROME_STOP,
    immediate: true
  });

  backstopTickerCleanup(runtime);

  clearMapLike(runtime.tokenFx);
  clearMapLike(runtime.tileFx);
  clearMapLike(runtime.screenFx);

  console.log("[FX Bus] Global reset executed (restored).");
}