// D:\FoundryVTT\Data\modules\fxbus\scripts\compat.js

/**
 * FX Bus - Foundry Compatibility Helpers
 *
 * Purpose:
 * - Centralise Foundry core version/API differences.
 * - Keep v13/v14 compatibility logic out of effect and UI files.
 * - Prefer feature detection over version detection.
 *
 * Current scope:
 * - Foundry version helpers.
 * - Scene-control collection helpers.
 * - Safe array/object control insertion helpers.
 *
 * Important:
 * - This file deliberately does not activate Token or Tile controls.
 * - Forced Token/Tiles activation is currently suspected of causing v14 crashes.
 */

/* -------------------------------------------- */
/* Foundry version helpers                       */
/* -------------------------------------------- */

export function getFoundryVersion() {
  /**
   * Large comment:
   * Return Foundry's reported version string.
   *
   * Foundry versions have historically been exposed in slightly different
   * places, so check modern and older locations.
   */
  return String(
    game?.version ??
    game?.data?.version ??
    ""
  ).trim();
}

export function getFoundryMajorVersion() {
  /**
   * Large comment:
   * Return the major Foundry version number.
   *
   * Examples:
   * - "13.351" -> 13
   * - "14.361" -> 14
   */
  const version = getFoundryVersion();
  const major = Number(version.split(".")[0]);

  return Number.isFinite(major) ? major : 0;
}

export function isFoundryV13OrNewer() {
  return getFoundryMajorVersion() >= 13;
}

export function isFoundryV14OrNewer() {
  return getFoundryMajorVersion() >= 14;
}

/* -------------------------------------------- */
/* Scene-control helpers                         */
/* -------------------------------------------- */

export function controlsCollectionToArray(controls) {
  /**
   * Large comment:
   * Convert Foundry's scene-control collection into an array.
   *
   * Foundry/module combinations may expose controls as:
   * - an array of control definitions
   * - an object map keyed by control name
   */
  if (!controls) return [];

  if (Array.isArray(controls)) return controls;

  if (typeof controls === "object") {
    return Object.values(controls);
  }

  return [];
}

export function controlToolsToArray(control) {
  /**
   * Large comment:
   * Convert a control group's tools into an array.
   *
   * Foundry/module combinations may expose tools as:
   * - an array of tool definitions
   * - an object map keyed by tool name
   */
  const tools = control?.tools;

  if (!tools) return [];

  if (Array.isArray(tools)) return tools;

  if (typeof tools === "object") {
    return Object.values(tools);
  }

  return [];
}

export function hasControlNamed(controls, controlName) {
  /**
   * Large comment:
   * Test whether a scene-control collection already contains a control group.
   */
  if (!controls || typeof controlName !== "string") return false;

  if (Array.isArray(controls)) {
    return controls.some((control) => control?.name === controlName);
  }

  if (typeof controls === "object") {
    return Boolean(controls[controlName]);
  }

  return false;
}

export function addControlDefinition(controls, controlName, controlDefinition) {
  /**
   * Large comment:
   * Insert a scene-control definition using Foundry's current collection shape.
   *
   * This supports both:
   * - v13-style/module-array control collections
   * - v14-style object-map control collections
   */
  if (!controls || typeof controls !== "object") return false;
  if (!controlName || typeof controlName !== "string") return false;
  if (!controlDefinition || typeof controlDefinition !== "object") return false;

  if (Array.isArray(controls)) {
    if (controls.some((control) => control?.name === controlName)) return false;

    controls.push(controlDefinition);
    return true;
  }

  if (controls[controlName]) return false;

  controls[controlName] = controlDefinition;
  return true;
}

export function removeControlsNamed(controls, controlNames) {
  /**
   * Large comment:
   * Remove stale scene-control groups by name.
   *
   * This is useful during development when older builds registered obsolete
   * controls such as fxbus-token or fxbus-tile.
   */
  if (!controls || typeof controls !== "object") return;
  if (!Array.isArray(controlNames)) return;

  const staleNames = new Set(controlNames);

  if (Array.isArray(controls)) {
    for (let i = controls.length - 1; i >= 0; i -= 1) {
      if (staleNames.has(controls[i]?.name)) {
        controls.splice(i, 1);
      }
    }
    return;
  }

  for (const staleName of staleNames) {
    if (controls[staleName]) delete controls[staleName];
  }
}

/* -------------------------------------------- */
/* Passive scene-control tool helpers            */
/* -------------------------------------------- */

export function makePassiveSceneTool({ name, title, icon, onActivate }) {
  /**
   * Large comment:
   * Build a passive Foundry scene-control tool.
   *
   * Passive means:
   * - it reacts to being clicked
   * - it does not force a Foundry layer/tool switch
   * - it does not call ui.controls.activate(...)
   */
  return {
    name,
    title,
    icon,
    button: true,
    visible: true,
    toggle: false,
    onChange: (_event, active) => {
      if (!active) return;

      try {
        if (typeof onActivate === "function") onActivate();
      } catch (err) {
        console.error("[FX Bus] Passive scene tool failed.", {
          name,
          title,
          err
        });
      }
    }
  };
}

export function makeHiddenSafeSceneTool() {
  /**
   * Large comment:
   * Build an inert safe tool for the FX Bus control group.
   *
   * Some Foundry control states expect a valid activeTool.
   * This gives FX Bus a valid internal tool without forcing Token/Tile selection.
   *
   * It is named "select" internally because activeTool expects a stable tool key,
   * but it is labelled "FX Bus" so it does not appear as a misleading duplicate
   * selection tool if Foundry decides to render it.
   */
  return {
    name: "select",
    title: "FX Bus",
    icon: "fas fa-bolt",
    button: false,
    visible: true,
    toggle: false,
    onChange: () => {
      // intentionally inert
    }
  };
}