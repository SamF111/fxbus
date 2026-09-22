import { readFileSync } from "node:fs";

const template = readFileSync(
  new URL("../templates/fxbus-panel.hbs", import.meta.url),
  "utf8"
);

describe("FX Bus panel accessibility markup", () => {
  test("category and effect navigation use keyboard-focusable tab buttons", () => {
    expect(template).toContain('role="tablist"');
    expect(template).toContain('aria-orientation="vertical"');
    expect(template).toContain('class="fxbus-category-tab');
    expect(template).toContain('type="button"');
    expect(template).toContain('role="tab"');
    expect(template).toContain('aria-controls="fxbus-panel-');
    expect(template).toContain('tabindex="{{#if this.active}}0{{else}}-1{{/if}}"');
  });
});
