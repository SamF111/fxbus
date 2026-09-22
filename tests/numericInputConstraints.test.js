import { readFileSync, readdirSync } from "node:fs";

const TABS_URL = new URL("../templates/tabs/", import.meta.url);
const NUMBER_INPUT_PATTERN = /<input\b(?=[^>]*\btype="number")[^>]*>/g;
const ATTRIBUTE_PATTERN = /([\w-]+)="([^"]*)"/g;

function numericInputs() {
  const inputs = [];

  for (const file of readdirSync(TABS_URL).filter((name) => name.endsWith(".hbs"))) {
    const source = readFileSync(new URL(file, TABS_URL), "utf8");

    for (const match of source.matchAll(NUMBER_INPUT_PATTERN)) {
      const attributes = Object.fromEntries(
        Array.from(match[0].matchAll(ATTRIBUTE_PATTERN), (attribute) => [
          attribute[1],
          attribute[2]
        ])
      );

      inputs.push({
        file,
        line: source.slice(0, match.index).split("\n").length,
        ...attributes
      });
    }
  }

  return inputs;
}

function isOnStep(value, base, step) {
  const quotient = (value - base) / step;
  return Math.abs(quotient - Math.round(quotient)) < 1e-9;
}

describe("numeric input constraints", () => {
  const inputs = numericInputs();

  test("every numeric default and maximum is reachable on its declared step", () => {
    const mismatches = [];

    for (const input of inputs) {
      if (!input.step || input.step === "any") continue;

      const step = Number(input.step);
      const value = Number(input.value);
      const base = input.min === undefined ? value : Number(input.min);

      if (!Number.isFinite(step) || step <= 0 || !Number.isFinite(base)) continue;

      if (input.value !== undefined && !isOnStep(value, base, step)) {
        mismatches.push(`${input.file}:${input.line} default ${input.value}`);
      }

      if (input.max !== undefined && !isOnStep(Number(input.max), base, step)) {
        mismatches.push(`${input.file}:${input.line} maximum ${input.max}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  test("Token Osc noise accepts hundredth increments", () => {
    const noise = inputs.find((input) => input.name === "oscNoise");

    expect(noise).toEqual(expect.objectContaining({
      min: "0",
      max: "0.5",
      step: "0.01"
    }));
  });
});
