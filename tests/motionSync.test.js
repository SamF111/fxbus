import {
  getMotionSyncGroups,
  getMotionSyncPhaseRad,
  joinMotionSyncGroup,
  leaveMotionSyncGroup,
  normaliseSyncGroup,
  normaliseSyncPhaseDeg,
  sampleMotionSyncWaves
} from "../scripts/effects/shared/motionSync.js";

describe("Motion Sync shared runtime helper", () => {
  test("normalises optional sync payload fields defensively", () => {
    expect(normaliseSyncGroup(" airship-1 ")).toBe("airship-1");
    expect(normaliseSyncGroup("")).toBeNull();
    expect(normaliseSyncGroup("   ")).toBeNull();
    expect(normaliseSyncGroup(42)).toBeNull();

    expect(normaliseSyncPhaseDeg(undefined)).toBe(0);
    expect(normaliseSyncPhaseDeg("not-a-number")).toBe(0);
    expect(normaliseSyncPhaseDeg(450)).toBe(90);
    expect(normaliseSyncPhaseDeg(-90)).toBe(270);
  });

  test("lazily creates one shared group map on the runtime", () => {
    const runtime = {};

    const groups = getMotionSyncGroups(runtime);

    expect(groups).toBeInstanceOf(Map);
    expect(getMotionSyncGroups(runtime)).toBe(groups);
  });

  test("late-joining members keep the existing group origin", () => {
    const runtime = {};

    joinMotionSyncGroup(runtime, "deck", "tile:ship", { freqHz: 0.5 }, 1000);
    joinMotionSyncGroup(runtime, "deck", "token:crew", { freqHz: 0.6 }, 9000);

    const group = runtime.motionSyncGroups.get("deck");

    expect(group.originMs).toBe(1000);
    expect(group.freqHz).toBe(0.6);
    expect(group.latestMemberKey).toBe("token:crew");
    expect(group.latestDetails).toMatchObject({
      freqHz: 0.6
    });
    expect(group.members.has("tile:ship")).toBe(true);
    expect(group.members.has("token:crew")).toBe(true);
  });

  test("samples phase from group origin, refreshed group frequency, and phase offset", () => {
    const runtime = {};

    joinMotionSyncGroup(runtime, "deck", "tile:ship", { freqHz: 0.5 }, 1000);
    joinMotionSyncGroup(runtime, "deck", "token:crew", { freqHz: 1 }, 1500);

    expect(getMotionSyncPhaseRad(runtime, "deck", 0.5, 0, 2000)).toBeCloseTo(Math.PI * 2);
    expect(getMotionSyncPhaseRad(runtime, "deck", 0.5, 90, 2000)).toBeCloseTo(Math.PI * 2.5);
  });

  test("samples one compatible wave set for token and tile synced channels", () => {
    const waves = sampleMotionSyncWaves(Math.PI / 2);

    expect(waves.rollWave).toBeCloseTo(1);
    expect(waves.bobWave).toBeCloseTo(1);
    expect(waves.swayWave).toBeCloseTo(0);
    expect(sampleMotionSyncWaves("bad")).toBeNull();
  });

  test("removes empty groups after the final member leaves", () => {
    const runtime = {};

    joinMotionSyncGroup(runtime, "deck", "tile:ship", { freqHz: 0.5 }, 1000);
    joinMotionSyncGroup(runtime, "deck", "token:crew", { freqHz: 0.5 }, 1000);

    leaveMotionSyncGroup(runtime, "deck", "tile:ship");
    expect(runtime.motionSyncGroups.has("deck")).toBe(true);

    leaveMotionSyncGroup(runtime, "deck", "token:crew");
    expect(runtime.motionSyncGroups.has("deck")).toBe(false);
  });

  test("refreshes latest group details without resetting phase origin", () => {
    const runtime = {};

    joinMotionSyncGroup(
      runtime,
      "deck",
      "tile:ship",
      {
        kind: "tile",
        freqHz: 0.5,
        bobPx: 8
      },
      1000
    );

    joinMotionSyncGroup(
      runtime,
      "deck",
      "token:crew",
      {
        kind: "token",
        freqHz: 0.75,
        bobPx: 6
      },
      5000
    );

    const group = runtime.motionSyncGroups.get("deck");

    expect(group.originMs).toBe(1000);
    expect(group.freqHz).toBe(0.75);
    expect(group.latestMemberKey).toBe("token:crew");
    expect(group.latestDetails).toMatchObject({
      kind: "token",
      freqHz: 0.75,
      bobPx: 6
    });
  });
});
