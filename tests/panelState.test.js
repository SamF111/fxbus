import {
  applyStateToForm,
  captureStateFromForm
} from "../scripts/ui/panel/panelState.js";

function createRoot(elements = [], disclosures = []) {
  return {
    ownerDocument: null,
    querySelectorAll(selector) {
      if (selector === "[name]") return elements;
      if (selector === "details[data-fxbus-disclosure]") return disclosures;
      return [];
    },
    querySelector(selector) {
      const name = selector.match(/^\[name="(.+)"\]$/)?.[1];
      return elements.find((element) => element.name === name) ?? null;
    }
  };
}

describe("FX Bus panel state", () => {
  test("captures disclosure state with form values", () => {
    const root = createRoot(
      [{
        name: "duration",
        type: "number",
        value: "250",
        getAttribute: (name) => name === "name" ? "duration" : null
      }],
      [
        { dataset: { fxbusDisclosure: "appearance" }, open: true },
        { dataset: { fxbusDisclosure: "motion" }, open: false }
      ]
    );

    expect(captureStateFromForm(root)).toEqual({
      duration: 250,
      __disclosures: {
        appearance: true,
        motion: false
      }
    });
  });

  test("restores disclosure state without disturbing unspecified sections", () => {
    const appearance = {
      dataset: { fxbusDisclosure: "appearance" },
      open: false
    };
    const motion = {
      dataset: { fxbusDisclosure: "motion" },
      open: true
    };
    const root = createRoot([], [appearance, motion]);

    applyStateToForm(root, {
      __disclosures: { appearance: true }
    });

    expect(appearance.open).toBe(true);
    expect(motion.open).toBe(true);
  });
});
