import { matchesFxAudience, normalizeFxAudience } from "../scripts/audience.js";

describe("FX Bus audience contract", () => {
  test("an omitted audience normalizes to everyone", () => {
    expect(normalizeFxAudience(undefined)).toEqual({ userIds: [] });
    expect(matchesFxAudience(undefined, "player-a")).toBe(true);
  });

  test("an empty user list means everyone for macro compatibility", () => {
    const audience = { userIds: [] };

    expect(normalizeFxAudience(audience)).toEqual({ userIds: [] });
    expect(matchesFxAudience(audience, "player-a")).toBe(true);
    expect(matchesFxAudience(audience, undefined)).toBe(true);
  });

  test("a non-empty user list only matches selected users", () => {
    const audience = { userIds: ["player-a", "player-b"] };

    expect(matchesFxAudience(audience, "player-a")).toBe(true);
    expect(matchesFxAudience(audience, "player-c")).toBe(false);
    expect(matchesFxAudience(audience, undefined)).toBe(false);
  });

  test("normalization trims ids and removes duplicates without changing order", () => {
    expect(
      normalizeFxAudience({
        userIds: [" player-b ", "player-a", "player-b", "player-a"]
      })
    ).toEqual({ userIds: ["player-b", "player-a"] });
  });

  test.each([
    null,
    "player-a",
    [],
    {},
    { userIds: "player-a" },
    { userIds: [""] },
    { userIds: ["   "] },
    { userIds: [null] },
    { userIds: [7] }
  ])("rejects a malformed audience instead of treating it as everyone: %p", (audience) => {
    expect(() => normalizeFxAudience(audience)).toThrow(TypeError);
    expect(() => matchesFxAudience(audience, "player-a")).toThrow(TypeError);
  });

  test("normalization returns a new object and user list", () => {
    const audience = { userIds: ["player-a"] };
    const normalized = normalizeFxAudience(audience);

    expect(normalized).not.toBe(audience);
    expect(normalized.userIds).not.toBe(audience.userIds);
  });
});
