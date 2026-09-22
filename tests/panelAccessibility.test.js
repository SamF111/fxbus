import { readFileSync } from "node:fs";

const template = readFileSync(
  new URL("../templates/fxbus-panel.hbs", import.meta.url),
  "utf8"
);
const stylesheet = readFileSync(
  new URL("../styles/fxbus.css", import.meta.url),
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

  test("audience popup uses a self-contained high-contrast light palette", () => {
    const menuRule = stylesheet.match(/\.fxbus-panel-app \.fxbus-audience-menu \{([\s\S]*?)\n\}/)?.[1];
    const headingRule = stylesheet.match(/\.fxbus-panel-app \.fxbus-audience-heading \{([\s\S]*?)\n\}/)?.[1];
    const offlineRule = stylesheet.match(/\.fxbus-panel-app \.fxbus-audience-option-offline \{([\s\S]*?)\n\}/)?.[1];

    expect(menuRule).toContain("background: #f4efe4");
    expect(menuRule).toContain("color: #201b16");
    expect(menuRule).toContain("color-scheme: light");
    expect(menuRule).not.toContain("var(--color-bg");
    expect(headingRule).toContain("color: #51483e");
    expect(offlineRule).toContain("color: #5b554d");
    expect(offlineRule).not.toContain("opacity:");
  });
});
