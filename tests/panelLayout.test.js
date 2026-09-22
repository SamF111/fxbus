import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const TABS_DIR = path.join(TEST_DIR, "..", "templates", "tabs");

describe("FX Bus panel action layout", () => {
  const tabFiles = fs.readdirSync(TABS_DIR)
    .filter((name) => name.endsWith("Tab.hbs"));

  test.each(tabFiles)("%s has one dedicated bottom action row", (fileName) => {
    const template = fs.readFileSync(path.join(TABS_DIR, fileName), "utf8");
    const actionRows = template.match(/class="[^"]*\bfxbus-actions\b[^"]*"/g) ?? [];
    const fieldRegions = template.match(/class="[^"]*\bfxbus-fields\b[^"]*"/g) ?? [];

    expect(actionRows).toHaveLength(1);
    expect(fieldRegions).toHaveLength(1);
    expect(template.indexOf("fxbus-fields")).toBeLessThan(
      template.indexOf("fxbus-actions")
    );
    expect(template).not.toMatch(/<button[^>]*>\s*(?:Start|Update)\s*<\/button>/);
  });

  test("Token Recoil keeps its origin utilities outside the action row", () => {
    const template = fs.readFileSync(
      path.join(TABS_DIR, "tokenRecoilTab.hbs"),
      "utf8"
    );

    expect(template).toContain(
      '<div class="fxbus-row">\n  <button type="button" class="fxbus-do fxbus-smallbtn" data-action="recoilPickOriginOnCanvas">'
    );
    expect(template).toContain(
      '<div class="fxbus-row fxbus-actions">\n  <button type="button" class="fxbus-do" data-action="recoilStart">Apply</button>'
    );
  });

  test("every advanced disclosure has a stable persistence key", () => {
    const keys = [];

    for (const fileName of tabFiles) {
      const template = fs.readFileSync(path.join(TABS_DIR, fileName), "utf8");
      const details = template.match(/<details\b[^>]*>/g) ?? [];

      for (const tag of details) {
        const key = tag.match(/data-fxbus-disclosure="([^"]+)"/)?.[1];
        expect(key).toBeTruthy();
        keys.push(key);
      }
    }

    expect(new Set(keys).size).toBe(keys.length);
  });

  test.each([
    "tokenOscTab.hbs",
    "tokenLaserTab.hbs",
    "tokenBeamTab.hbs",
    "tokenRecoilTab.hbs",
    "tileOscTab.hbs",
    "tileRotationTab.hbs",
    "tileFlickerTab.hbs",
    "tileFlowTab.hbs"
  ])("%s presents separate Stop and Stop All actions", (fileName) => {
    const template = fs.readFileSync(path.join(TABS_DIR, fileName), "utf8");

    expect(template).toMatch(/<button[^>]*>\s*Stop\s*<\/button>/);
    expect(template).toMatch(/<button[^>]*>\s*Stop All\s*<\/button>/);
    expect(template).not.toContain("Stop Selected");
  });
});
