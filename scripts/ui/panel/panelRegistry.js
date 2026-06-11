// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelRegistry.js

/**
 * FX Bus - Panel Registry
 *
 * Purpose:
 * - Own the GM panel's effect catalogue.
 * - Build grouped category/tab metadata for the panel.
 * - Provide tab and category lookup helpers.
 * - Keep effect imports and template-partial paths out of the ApplicationV2 app.
 *
 * Developer note:
 * - New GM panel tabs are registered here.
 * - Add the tab import, template path, and category entry in buildGroups().
 */

import {
  MODULE_ID
} from "../../constants.js";

import { tokenOscTabDef } from "../tabs/tokenOscTab.js";
import { tokenLaserTabDef } from "../tabs/tokenLaserTab.js";
import { tokenBeamTabDef } from "../tabs/tokenBeamTab.js";
import { tokenRecoilTabDef } from "../tabs/tokenRecoilTab.js";
import { tokenDollyZoomTabDef } from "../tabs/tokenDollyZoomTab.js";

import { tileOscTabDef } from "../tabs/tileOscTab.js";
import { tileFlickerTabDef } from "../tabs/tileFlickerTab.js";
import { tileFlowTabDef } from "../tabs/tileFlowTab.js";

import { screenShakeTabDef } from "../tabs/screenShakeTab.js";
import { screenRotateTabDef } from "../tabs/screenRotateTab.js";
import { screenPulseTabDef } from "../tabs/screenPulseTab.js";
import { screenVignetteTabDef } from "../tabs/screenVignetteTab.js";
import { screenChromAbTabDef } from "../tabs/screenChromAbTab.js";
import { screenNoiseTabDef } from "../tabs/screenNoiseTab.js";
import { screenBlurTabDef } from "../tabs/screenBlurTab.js";
import { screenSmearTabDef } from "../tabs/screenSmearTab.js";
import { screenStreakTabDef } from "../tabs/screenStreakTab.js";
import { screenMonochromeTabDef } from "../tabs/screenMonochromeTab.js";

import { canvasMirrorTabDef } from "../tabs/canvasMirrorTab.js";

import { resetTabDef } from "../tabs/resetTab.js";

export const TAB_PARTIALS = [
  `modules/${MODULE_ID}/templates/tabs/tokenOscTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tokenLaserTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tokenBeamTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tokenRecoilTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tokenDollyZoomTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tileOscTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tileFlickerTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/tileFlowTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenShakeTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenRotateTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/canvasMirrorTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenPulseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenVignetteTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenChromAbTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenNoiseTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenBlurTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenSmearTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenStreakTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/screenMonochromeTab.hbs`,
  `modules/${MODULE_ID}/templates/tabs/resetTab.hbs`
];

function relabelTab(tabDef, label) {
  /**
   * Large comment:
   * Return the same tab definition with a GUI-only label override.
   *
   * This does not rename tab ids, files, action strings, socket actions, or effect
   * implementation names. It only changes the label presented in the panel.
   */
  return {
    ...tabDef,
    label
  };
}

export function buildGroups() {
  /**
   * Large comment:
   * Build the grouped GUI model used by the GM panel.
   *
   * Category ids are presentation ids:
   * - token
   * - tile
   * - screen
   * - canvas
   * - reset
   *
   * Tab ids remain implementation-facing ids so existing tab definitions, DOM
   * selectors, macro builders, and action strings stay stable.
   */
  const tokenOsc = tokenOscTabDef();
  const tokenLaser = tokenLaserTabDef();
  const tokenBeam = tokenBeamTabDef();
  const tokenRecoil = tokenRecoilTabDef();
  const tokenDollyZoom = tokenDollyZoomTabDef();

  const tileOsc = tileOscTabDef();
  const tileFlicker = tileFlickerTabDef();
  const tileFlow = tileFlowTabDef();

  const screenShake = screenShakeTabDef();
  const screenPulse = screenPulseTabDef();
  const screenVignette = screenVignetteTabDef();
  const screenChromAb = screenChromAbTabDef();
  const screenNoise = screenNoiseTabDef();
  const screenBlur = screenBlurTabDef();
  const screenSmear = screenSmearTabDef();
  const screenStreak = screenStreakTabDef();
  const screenMonochrome = screenMonochromeTabDef();

  const screenRotate = relabelTab(screenRotateTabDef(), "Canvas Roll");
  const canvasMirror = canvasMirrorTabDef();

  return [
    {
      id: "token",
      label: "Token",
      tabs: [
        tokenOsc,
        relabelTab(tokenLaser, "Token Tether"),
        relabelTab(tokenBeam, "Token Laser"),
        tokenRecoil,
        tokenDollyZoom
      ]
    },
    {
      id: "tile",
      label: "Tile",
      tabs: [
        tileOsc,
        tileFlicker,
        tileFlow
      ]
    },
    {
      id: "screen",
      label: "Screen",
      tabs: [
        screenShake,
        screenPulse,
        screenVignette,
        screenChromAb,
        screenNoise,
        screenBlur,
        screenSmear,
        screenStreak,
        screenMonochrome
      ]
    },
    {
      id: "canvas",
      label: "Canvas",
      tabs: [
        screenRotate,
        canvasMirror
      ]
    },
    {
      id: "reset",
      label: "Reset",
      tabs: [
        resetTabDef()
      ]
    }
  ];
}

export function flattenGroups(groups) {
  /**
   * Large comment:
   * Flatten all grouped tab definitions into a single list for legacy operations.
   *
   * Existing code paths such as tab wiring and tab-id lookup are still easier and
   * safer against current tab implementations when backed by a flat list.
   */
  return groups.flatMap((group) => group.tabs);
}

export function getGroupById(groups, categoryId) {
  const id = String(categoryId ?? "");
  if (!id) return null;

  return groups.find((group) => group?.id === id) ?? null;
}

export function getTabDefById(app, tabId) {
  /**
   * Large comment:
   * Resolve a tab definition from the app's flattened tab list.
   *
   * This centralises tab lookup so macro export and any future tab-level metadata
   * can share the same lookup logic.
   */
  const id = String(tabId ?? "");
  if (!id) return null;

  return app?._tabs?.find?.((tab) => tab?.id === id) ?? null;
}

export function getTabDefInCategory(app, categoryId, tabId) {
  /**
   * Large comment:
   * Resolve a tab definition from one category.
   *
   * This prevents duplicate tab ids in future categories from accidentally
   * targeting the wrong tab. Current tab ids are unique, but the grouped model
   * should still be category-aware.
   */
  const group = getGroupById(app?._groups ?? [], categoryId);
  if (!group) return null;

  const id = String(tabId ?? "");
  if (!id) return null;

  return group.tabs.find((tab) => tab?.id === id) ?? null;
}

export function getFirstTabIdForCategory(groups, categoryId) {
  const group = getGroupById(groups, categoryId);
  return group?.tabs?.[0]?.id ?? null;
}

export function findCategoryForTab(groups, tabId) {
  /**
   * Large comment:
   * Resolve the first category containing a tab id.
   *
   * This maintains backward compatibility with old calls that only pass startTab.
   * For example:
   * - openFxBusGmControlPanel({ startTab: "pulse" })
   *
   * New calls should prefer:
   * - openFxBusGmControlPanel({ startCategory: "screen", startTab: "pulse" })
   */
  const id = String(tabId ?? "");
  if (!id) return null;

  for (const group of groups) {
    if (group.tabs.some((tab) => tab?.id === id)) return group.id;
  }

  return null;
}

export function decorateGroupsForContext(groups, activeCategory) {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    active: group.id === activeCategory
  }));
}

export function decorateTabsForContext(group, activeTab) {
  return (group?.tabs ?? []).map((tab) => ({
    id: tab.id,
    label: tab.label,
    active: tab.id === activeTab
  }));
}