import { readFileSync } from "node:fs";

const template = readFileSync(
  new URL("../templates/fxbus-panel.hbs", import.meta.url),
  "utf8"
);
const stylesheet = readFileSync(
  new URL("../styles/fxbus.css", import.meta.url),
  "utf8"
);
const macroCopySource = readFileSync(
  new URL("../scripts/ui/panel/panelMacroCopy.js", import.meta.url),
  "utf8"
);
const audienceSource = readFileSync(
  new URL("../scripts/ui/panel/panelAudience.js", import.meta.url),
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

  test("selection feedback is announced and narrow action bars use container sizing", () => {
    expect(template).toContain('data-fxbus-selection-status');
    expect(template).toContain('role="status"');
    expect(template).toContain('aria-live="polite"');
    expect(template).toContain('data-fxbus-apply-help');
    expect(stylesheet).toContain('container-name: fxbus-main');
    expect(stylesheet).toContain('@container fxbus-main (max-width: 480px)');
  });

  test("macro split menu exposes labelled keyboard-focusable actions", () => {
    expect(macroCopySource).toContain('toggle.setAttribute("aria-haspopup", "menu")');
    expect(macroCopySource).toContain('button.setAttribute("role", "menuitem")');
    expect(macroCopySource).toContain('"Copy Apply Macro"');
    expect(macroCopySource).toContain('"Copy Stop Macro"');
    expect(macroCopySource).toContain('"Copy Stop All Macro"');
    expect(macroCopySource).toContain('["ArrowDown", "ArrowUp", "Home", "End"]');
    expect(macroCopySource).toContain('if (event.key !== "Escape") return');

    const menuRule = stylesheet.match(/\.fxbus-panel-app \.fxbus-macro-menu \{([\s\S]*?)\n\}/)?.[1];
    expect(menuRule).toContain("background: #f4efe4");
    expect(menuRule).toContain("color: #201b16");
    expect(menuRule).toContain("color-scheme: light");
  });

  test("Stop exposes the shared audience picker without changing Stop All", () => {
    expect(audienceSource).toContain('stopWrapper.className = "fxbus-stop-split"');
    expect(audienceSource).toContain('"Choose FX Stop recipients"');
    expect(audienceSource).toContain('"Stop effect for"');
    expect(stylesheet).toContain(".fxbus-panel-app .fxbus-stop-split");
  });
});
