import { jest } from "@jest/globals";
import {
  formatSelectionStatus,
  updateSelectionStatus,
  wireSelectionStatus
} from "../scripts/ui/panel/panelSelection.js";

function createStatus() {
  const classes = new Set();
  return {
    hidden: true,
    textContent: "",
    classList: {
      remove: (name) => classes.delete(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name)
    }
  };
}

describe("FX Bus selection status", () => {
  test("formats token and tile counts", () => {
    expect(formatSelectionStatus("token", 0)).toBe("No tokens selected");
    expect(formatSelectionStatus("token", 1)).toBe("1 token selected");
    expect(formatSelectionStatus("token", 3)).toBe("3 tokens selected");
    expect(formatSelectionStatus("tile", 1)).toBe("1 tile selected");
    expect(formatSelectionStatus("tile", 2)).toBe("2 tiles selected");
    expect(formatSelectionStatus("screen", 2)).toBe("");
    expect(formatSelectionStatus("token", 0, "laser")).toBe(
      "No tokens selected — Token Tether needs 2"
    );
    expect(formatSelectionStatus("token", 1, "laser")).toBe(
      "1 token selected — Token Tether needs 2"
    );
    expect(formatSelectionStatus("token", 2, "laser")).toBe(
      "2 tokens selected"
    );
  });

  test("marks Token Tether unready until two tokens are selected", () => {
    const status = createStatus();
    const root = { querySelector: jest.fn(() => status) };
    const canvasRef = {
      tokens: { controlled: [{ id: "a" }] },
      tiles: { controlled: [] }
    };

    updateSelectionStatus(root, "token", canvasRef, "laser");
    expect(status.textContent).toBe("1 token selected — Token Tether needs 2");
    expect(status.classList.contains("fxbus-selection-status-empty")).toBe(true);

    canvasRef.tokens.controlled.push({ id: "b" });
    updateSelectionStatus(root, "token", canvasRef, "laser");
    expect(status.textContent).toBe("2 tokens selected");
    expect(status.classList.contains("fxbus-selection-status-empty")).toBe(false);
  });

  test("shows live category selection without blocking actions", () => {
    const status = createStatus();
    const root = {
      querySelector: jest.fn(() => status)
    };
    const canvasRef = {
      tokens: { controlled: [{ id: "a" }, { id: "b" }] },
      tiles: { controlled: [] }
    };

    expect(updateSelectionStatus(root, "token", canvasRef)).toBe(true);
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe("2 tokens selected");
    expect(status.classList.contains("fxbus-selection-status-empty")).toBe(false);

    updateSelectionStatus(root, "tile", canvasRef);
    expect(status.textContent).toBe("No tiles selected");
    expect(status.classList.contains("fxbus-selection-status-empty")).toBe(true);

    updateSelectionStatus(root, "screen", canvasRef);
    expect(status.hidden).toBe(true);
  });

  test("refreshes from Foundry control hooks and removes them on abort", () => {
    const status = createStatus();
    const root = { querySelector: jest.fn(() => status) };
    const canvasRef = {
      tokens: { controlled: [] },
      tiles: { controlled: [] }
    };
    const callbacks = {};
    const hooks = {
      on: jest.fn((eventName, callback) => {
        callbacks[eventName] = callback;
        return `${eventName}-id`;
      }),
      off: jest.fn()
    };
    const controller = new AbortController();

    wireSelectionStatus(
      { _activeCategory: "token", _activeTab: "osc" },
      root,
      controller.signal,
      hooks,
      canvasRef
    );

    canvasRef.tokens.controlled.push({ id: "a" });
    callbacks.controlToken();
    expect(status.textContent).toBe("1 token selected");

    controller.abort();
    expect(hooks.off).toHaveBeenCalledWith("controlToken", "controlToken-id");
    expect(hooks.off).toHaveBeenCalledWith("controlTile", "controlTile-id");
  });
});
