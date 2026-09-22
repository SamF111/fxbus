import { getKeyboardNavigationTarget } from "../scripts/ui/panel/panelNavigation.js";

describe("FX Bus panel keyboard navigation", () => {
  test("vertical navigation wraps with ArrowUp and ArrowDown", () => {
    const items = [{ id: "token" }, { id: "tile" }, { id: "screen" }];

    expect(getKeyboardNavigationTarget(
      items,
      items[0],
      "ArrowUp",
      "vertical"
    )).toBe(items[2]);
    expect(getKeyboardNavigationTarget(
      items,
      items[2],
      "ArrowDown",
      "vertical"
    )).toBe(items[0]);
  });

  test("horizontal navigation supports arrows, Home, and End", () => {
    const items = [{ id: "shake" }, { id: "pulse" }, { id: "blur" }];

    expect(getKeyboardNavigationTarget(
      items,
      items[1],
      "ArrowRight",
      "horizontal"
    )).toBe(items[2]);
    expect(getKeyboardNavigationTarget(items, items[1], "Home", "horizontal"))
      .toBe(items[0]);
    expect(getKeyboardNavigationTarget(items, items[1], "End", "horizontal"))
      .toBe(items[2]);
  });

  test("ignores unrelated keys and skips disabled controls", () => {
    const items = [{ id: "one" }, { id: "disabled", disabled: true }, { id: "two" }];

    expect(getKeyboardNavigationTarget(
      items,
      items[0],
      "ArrowRight",
      "horizontal"
    )).toBe(items[2]);
    expect(getKeyboardNavigationTarget(items, items[0], "Enter", "horizontal"))
      .toBeNull();
  });
});
