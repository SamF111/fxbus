import { tokenOscTabDef } from "../scripts/ui/tabs/tokenOscTab.js";
import { tileOscTabDef } from "../scripts/ui/tabs/tileOscTab.js";
import { readFileSync } from "node:fs";

function input(value, checked = false) {
  return {
    value,
    checked,
    disabled: false,
    style: {},
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    dispatch(type) {
      this.listeners.get(type)?.({ type });
    }
  };
}

function makeRoot(fields, tabId) {
  const panel = {
    querySelector(selector) {
      const name = selector.match(/input\[name="([^"]+)"\]/)?.[1];
      return name ? fields[name] ?? null : null;
    }
  };

  return {
    querySelector(selector) {
      return selector.includes(`data-tab="${tabId}"`) ? panel : null;
    }
  };
}

function setSelectedTokens(tokenIds) {
  globalThis.canvas = {
    tokens: {
      controlled: tokenIds.map((id) => ({ id }))
    },
    tiles: {
      controlled: []
    }
  };
}

function setSelectedTiles(tileIds) {
  delete globalThis.fxbus;

  globalThis.canvas = {
    tokens: {
      controlled: []
    },
    tiles: {
      controlled: tileIds.map((id) => ({ id }))
    }
  };
}

function tokenFields(overrides = {}) {
  return {
    oscRollDeg: input("3"),
    oscBobPx: input("8"),
    oscSwayPx: input("2"),
    oscFreqHz: input("0.35"),
    oscNoise: input("0.2"),
    oscRandomPhase: input("", true),
    tokenOscMotionSync: input("", false),
    tokenOscSyncGroup: input("motion-1"),
    tokenOscSyncPhaseDeg: input("0"),
    ...overrides
  };
}

function tileFields(overrides = {}) {
  return {
    tileOscRotationDeg: input("3"),
    tileOscBobPx: input("8"),
    tileOscSwayPx: input("2"),
    tileOscScalePct: input("0"),
    tileOscFreqHz: input("0.35"),
    tileOscRandomPhase: input("", true),
    tileOscMotionSync: input("", false),
    tileOscSyncGroup: input("motion-1"),
    tileOscSyncPhaseDeg: input("0"),
    ...overrides
  };
}

describe("Motion Sync template defaults", () => {
  test("token tab starts with Motion Sync off and a disabled default group name", () => {
    const template = readFileSync("templates/tabs/tokenOscTab.hbs", "utf8");

    expect(template).toContain('<input type="checkbox" name="tokenOscMotionSync"/>');
    expect(template).toContain('name="tokenOscSyncGroup" value="motion-1" disabled');
  });

  test("tile tab starts with Motion Sync off and a disabled default group name", () => {
    const template = readFileSync("templates/tabs/tileOscTab.hbs", "utf8");

    expect(template).toContain('<input type="checkbox" name="tileOscMotionSync"/>');
    expect(template).toContain('name="tileOscSyncGroup" value="motion-1" disabled');
  });
});

describe("Token Oscillation tab Motion Sync payloads", () => {
  afterEach(() => {
    delete globalThis.canvas;
    delete globalThis.fxbus;
  });

  test("omits sync fields and preserves random phase for legacy payloads", () => {
    setSelectedTokens(["tok-a"]);

    const payload = tokenOscTabDef().buildApplyPayload(
      makeRoot(tokenFields(), "osc"),
      { tokenFx: new Map() }
    );

    expect(payload).toMatchObject({
      action: "fx.tokenOsc.start",
      tokenIds: ["tok-a"],
      rollDeg: 3,
      bobPx: 8,
      swayPx: 2,
      freqHz: 0.35,
      noise: 0.2,
      randomPhase: true
    });
    expect(payload).not.toHaveProperty("syncGroup");
    expect(payload).not.toHaveProperty("syncPhaseDeg");
  });

  test("includes trimmed sync fields and disables random phase when active", () => {
    setSelectedTokens(["tok-a"]);

    const payload = tokenOscTabDef().buildApplyPayload(
      makeRoot(
        tokenFields({
          tokenOscMotionSync: input("", true),
          tokenOscSyncGroup: input(" airship-1 "),
          tokenOscSyncPhaseDeg: input("180")
        }),
        "osc"
      ),
      { tokenFx: new Map() }
    );

    expect(payload).toMatchObject({
      action: "fx.tokenOsc.start",
      tokenIds: ["tok-a"],
      randomPhase: false,
      syncGroup: "airship-1",
      syncPhaseDeg: 180
    });
  });

  test("blank checked sync group falls back to legacy random phase behavior", () => {
    setSelectedTokens(["tok-a"]);

    const payload = tokenOscTabDef().buildApplyPayload(
      makeRoot(
        tokenFields({
          tokenOscMotionSync: input("", true),
          tokenOscSyncGroup: input("   ")
        }),
        "osc"
      ),
      { tokenFx: new Map() }
    );

    expect(payload.randomPhase).toBe(true);
    expect(payload).not.toHaveProperty("syncGroup");
    expect(payload).not.toHaveProperty("syncPhaseDeg");
  });

  test("wire unlocks sync fields and disables random phase when checked", () => {
    const fields = tokenFields();
    const root = makeRoot(fields, "osc");

    tokenOscTabDef().wire(root, {}, new AbortController().signal);

    expect(fields.tokenOscSyncGroup.disabled).toBe(true);
    expect(fields.tokenOscSyncPhaseDeg.disabled).toBe(true);
    expect(fields.oscRandomPhase.disabled).toBe(false);

    fields.tokenOscMotionSync.checked = true;
    fields.tokenOscMotionSync.dispatch("input");

    expect(fields.tokenOscSyncGroup.disabled).toBe(false);
    expect(fields.tokenOscSyncPhaseDeg.disabled).toBe(false);
    expect(fields.oscRandomPhase.disabled).toBe(true);

    fields.tokenOscMotionSync.checked = false;
    fields.tokenOscMotionSync.dispatch("change");

    expect(fields.tokenOscSyncGroup.disabled).toBe(true);
    expect(fields.tokenOscSyncPhaseDeg.disabled).toBe(true);
    expect(fields.oscRandomPhase.disabled).toBe(false);
  });
});

describe("Tile Oscillation tab Motion Sync payloads", () => {
  afterEach(() => {
    delete globalThis.canvas;
    delete globalThis.fxbus;
  });

  test("omits sync fields and preserves random phase for legacy payloads", () => {
    setSelectedTiles(["tile-a"]);

    const payload = tileOscTabDef().buildApplyPayload(
      makeRoot(tileFields(), "tileOsc"),
      { tileFx: new Map() }
    );

    expect(payload).toMatchObject({
      action: "fx.tileOscillation.start",
      tileIds: ["tile-a"],
      rotationDeg: 3,
      bobPx: 8,
      swayPx: 2,
      scalePct: 0,
      freqHz: 0.35,
      randomPhase: true
    });
    expect(payload).not.toHaveProperty("syncGroup");
    expect(payload).not.toHaveProperty("syncPhaseDeg");
  });

  test("includes trimmed sync fields and disables random phase when active", () => {
    setSelectedTiles(["tile-a"]);

    const payload = tileOscTabDef().buildApplyPayload(
      makeRoot(
        tileFields({
          tileOscMotionSync: input("", true),
          tileOscSyncGroup: input(" airship-1 "),
          tileOscSyncPhaseDeg: input("180")
        }),
        "tileOsc"
      ),
      { tileFx: new Map() }
    );

    expect(payload).toMatchObject({
      action: "fx.tileOscillation.start",
      tileIds: ["tile-a"],
      randomPhase: false,
      syncGroup: "airship-1",
      syncPhaseDeg: 180
    });
  });

  test("blank checked sync group falls back to legacy random phase behavior", () => {
    setSelectedTiles(["tile-a"]);

    const payload = tileOscTabDef().buildApplyPayload(
      makeRoot(
        tileFields({
          tileOscMotionSync: input("", true),
          tileOscSyncGroup: input("   ")
        }),
        "tileOsc"
      ),
      { tileFx: new Map() }
    );

    expect(payload.randomPhase).toBe(true);
    expect(payload).not.toHaveProperty("syncGroup");
    expect(payload).not.toHaveProperty("syncPhaseDeg");
  });

  test("wire unlocks sync fields and disables random phase when checked", () => {
    const fields = tileFields();
    const root = makeRoot(fields, "tileOsc");

    tileOscTabDef().wire(root, {}, new AbortController().signal);

    expect(fields.tileOscSyncGroup.disabled).toBe(true);
    expect(fields.tileOscSyncPhaseDeg.disabled).toBe(true);
    expect(fields.tileOscRandomPhase.disabled).toBe(false);

    fields.tileOscMotionSync.checked = true;
    fields.tileOscMotionSync.dispatch("input");

    expect(fields.tileOscSyncGroup.disabled).toBe(false);
    expect(fields.tileOscSyncPhaseDeg.disabled).toBe(false);
    expect(fields.tileOscRandomPhase.disabled).toBe(true);

    fields.tileOscMotionSync.checked = false;
    fields.tileOscMotionSync.dispatch("change");

    expect(fields.tileOscSyncGroup.disabled).toBe(true);
    expect(fields.tileOscSyncPhaseDeg.disabled).toBe(true);
    expect(fields.tileOscRandomPhase.disabled).toBe(false);
  });
});
