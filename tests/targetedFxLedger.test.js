import { jest } from "@jest/globals";
import {
  clearTargetedFxLedger,
  getActiveTargetedFx,
  getLocalTargetedFxSnapshot,
  observeLocalTargetedFxMessage,
  reconcileTargetedFxUser,
  observeTargetedFxMessage
} from "../scripts/targetedFxLedger.js";

function runtime() {
  return {};
}

function targeted(action, userIds, extra = {}) {
  return {
    action,
    audience: { userIds },
    ...extra
  };
}

describe("GM targeted FX ledger", () => {
  beforeEach(() => {
    globalThis.game = {
      user: { id: "gm", name: "GM", isGM: true }
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.game;
  });

  test("records a targeted effect once per recipient and resource", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.tileFlow.start", ["player-a", "player-b"], {
        tileIds: ["tile-1", "tile-2"],
        durationMs: 0
      }),
      1_000
    );

    const active = getActiveTargetedFx(rt, 1_000);
    expect(active).toHaveLength(4);
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          effectKey: "tileFlow",
          effectLabel: "Tile Flow",
          userId: "player-a",
          resourceId: "tileIds:tile-1",
          startedAt: 1_000,
          durationMs: 0,
          expiresAt: null
        }),
        expect.objectContaining({
          effectKey: "tileFlow",
          userId: "player-b",
          resourceId: "tileIds:tile-2"
        })
      ])
    );
  });

  test("does not record broadcast effects or observe on non-GM clients", () => {
    const rt = runtime();

    observeTargetedFxMessage(rt, {
      action: "fx.screenBlur.start",
      durationMs: 0
    });
    observeTargetedFxMessage(
      rt,
      targeted("fx.screenBlur.start", [], { durationMs: 0 })
    );

    game.user.isGM = false;
    observeTargetedFxMessage(
      rt,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 })
    );

    expect(getActiveTargetedFx(rt)).toEqual([]);
  });

  test("finite effects expire automatically", () => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.screenShake.start", ["player-a"], { durationMs: 250 }),
      10_000
    );

    expect(getActiveTargetedFx(rt, 10_249)).toHaveLength(1);
    jest.advanceTimersByTime(250);
    expect(getActiveTargetedFx(rt, 10_250)).toEqual([]);
  });

  test("indefinite and held effects remain until stopped", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 }),
      1_000
    );
    observeTargetedFxMessage(
      rt,
      targeted("fx.screenRotate.start", ["player-a"], {
        durationMs: 500,
        holdWhenFinished: true
      }),
      1_000
    );

    expect(getActiveTargetedFx(rt, 100_000)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effectKey: "screenBlur", expiresAt: null }),
        expect.objectContaining({ effectKey: "screenRotate", expiresAt: null })
      ])
    );
  });

  test("targeted and resource-specific stops remove only matching records", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.tileFlow.start", ["player-a", "player-b"], {
        tileIds: ["tile-1", "tile-2"],
        durationMs: 0
      })
    );
    observeTargetedFxMessage(
      rt,
      targeted("fx.tileFlow.stop", ["player-a"], { tileIds: ["tile-1"] })
    );

    expect(getActiveTargetedFx(rt)).toHaveLength(3);
    expect(getActiveTargetedFx(rt)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "player-a", resourceId: "tileIds:tile-1" })
      ])
    );

    observeTargetedFxMessage(rt, {
      action: "fx.tileFlow.stop",
      tileIds: ["tile-2"]
    });

    expect(getActiveTargetedFx(rt)).toEqual([
      expect.objectContaining({ userId: "player-b", resourceId: "tileIds:tile-1" })
    ]);
  });

  test("broadcast stop and global reset clear targeted state", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 })
    );
    observeTargetedFxMessage(rt, { action: "fx.screenBlur.stop" });
    expect(getActiveTargetedFx(rt)).toEqual([]);

    observeTargetedFxMessage(
      rt,
      targeted("fx.screenPulse.start", ["player-a"], { durationMs: 500 })
    );
    observeTargetedFxMessage(
      rt,
      targeted("fx.tileRotation.start", ["player-b"], { tileIds: ["tile-1"] })
    );
    observeTargetedFxMessage(rt, {
      action: "fx.bus.reset",
      audience: { userIds: ["nobody"] }
    });

    expect(getActiveTargetedFx(rt)).toEqual([]);
    expect(rt.__targetedFxLedgerTimers.size).toBe(0);
  });

  test.each([
    ["fx.tokenOsc.start", "fx.tokenOsc.stopAll", { tokenIds: ["token-1"] }],
    ["fx.tokenRecoil.burst", "fx.tokenRecoil.stopAll", { tokenIds: ["token-1"] }],
    ["fx.tileOscillation.start", "fx.tileOscillation.stopAll", { tileIds: ["tile-1"] }]
  ])("%s is cleared by explicit %s", (startAction, stopAllAction, resources) => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted(startAction, ["player-a"], { ...resources, durationMs: 0 })
    );
    expect(getActiveTargetedFx(rt)).toHaveLength(1);

    observeTargetedFxMessage(rt, targeted(stopAllAction, ["player-a"]));
    expect(getActiveTargetedFx(rt)).toEqual([]);
  });

  test("updates preserve the original start time and refresh ledger details", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.tileFlow.start", ["player-a"], {
        tileIds: ["tile-1"],
        durationMs: 0
      }),
      1_000
    );
    observeTargetedFxMessage(
      rt,
      targeted("fx.tileFlow.update", ["player-a"], {
        tileIds: ["tile-1"]
      }),
      4_000
    );

    expect(getActiveTargetedFx(rt, 4_000)).toEqual([
      expect.objectContaining({
        action: "fx.tileFlow.update",
        startedAt: 1_000,
        updatedAt: 4_000,
        durationMs: 0
      })
    ]);
  });

  test("canvas mirror start packets track their toggle state per axis", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.canvasMirror.start", ["player-a"], { axis: "x" })
    );
    expect(getActiveTargetedFx(rt)).toHaveLength(1);

    observeTargetedFxMessage(
      rt,
      targeted("fx.canvasMirror.start", ["player-a"], { axis: "y" })
    );
    expect(getActiveTargetedFx(rt)).toHaveLength(2);

    observeTargetedFxMessage(
      rt,
      targeted("fx.canvasMirror.start", ["player-a"], { axis: "x" })
    );
    expect(getActiveTargetedFx(rt)).toEqual([
      expect.objectContaining({ resourceId: "axis:y" })
    ]);
  });

  test("a beam stop by source does not confuse a target token for that source", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.tokenBeam.start", ["player-a"], {
        tokenIds: ["source-a", "target-a"],
        durationMs: 0
      })
    );
    observeTargetedFxMessage(
      rt,
      targeted("fx.tokenBeam.stop", ["player-a"], {
        tokenIds: ["target-a"]
      })
    );

    expect(getActiveTargetedFx(rt)).toHaveLength(1);

    observeTargetedFxMessage(
      rt,
      targeted("fx.tokenBeam.stop", ["player-a"], {
        tokenIds: ["source-a"]
      })
    );

    expect(getActiveTargetedFx(rt)).toEqual([]);
  });

  test("returned entries cannot mutate stored selector arrays", () => {
    const rt = runtime();
    observeTargetedFxMessage(
      rt,
      targeted("fx.tokenLaser.start", ["player-a"], {
        laserId: "tether-1",
        sourceTokenId: "token-a",
        targetTokenIds: ["token-b"],
        durationMs: 0
      })
    );

    const active = getActiveTargetedFx(rt);
    active[0].selectors.push("forged");

    expect(getActiveTargetedFx(rt)[0].selectors).not.toContain("forged");
    clearTargetedFxLedger(rt);
    expect(getActiveTargetedFx(rt)).toEqual([]);
  });

  test("recipient snapshots contain only locally applied targeted state", () => {
    const rt = runtime();
    game.user.isGM = false;

    observeLocalTargetedFxMessage(
      rt,
      targeted("fx.screenBlur.start", ["player-a", "player-b"], { durationMs: 0 }),
      "player-a",
      1_000
    );
    observeLocalTargetedFxMessage(
      rt,
      targeted("fx.screenNoise.start", ["player-b"], { durationMs: 0 }),
      "player-a",
      1_000
    );

    expect(getLocalTargetedFxSnapshot(rt, 4_000)).toEqual([
      expect.objectContaining({
        effectKey: "screenBlur",
        resourceId: "global",
        elapsedMs: 3_000,
        remainingMs: null
      })
    ]);

    observeLocalTargetedFxMessage(rt, { action: "fx.screenBlur.stop" }, "player-a", 4_000);
    expect(getLocalTargetedFxSnapshot(rt, 4_000)).toEqual([]);
  });

  test("reconciles one recipient without disturbing other users", () => {
    const rt = runtime();

    observeTargetedFxMessage(
      rt,
      targeted("fx.screenBlur.start", ["player-a", "player-b"], { durationMs: 0 }),
      1_000
    );

    reconcileTargetedFxUser(rt, "player-a", [{
      effectKey: "noise",
      action: "fx.noise.start",
      resourceId: "global",
      selectors: ["global"],
      elapsedMs: 2_000,
      remainingMs: null
    }], 5_000);

    expect(getActiveTargetedFx(rt, 5_000)).toEqual(expect.arrayContaining([
      expect.objectContaining({ effectKey: "noise", userId: "player-a" }),
      expect.objectContaining({ effectKey: "screenBlur", userId: "player-b" })
    ]));
    expect(getActiveTargetedFx(rt, 5_000)).toHaveLength(2);
  });
});
