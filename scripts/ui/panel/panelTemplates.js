// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelTemplates.js

/**
 * FX Bus - Panel Templates
 *
 * Purpose:
 * - Preload tab templates used by the GM control panel.
 * - Register each loaded tab template as a Handlebars partial.
 * - Keep Handlebars/template loading out of the main ApplicationV2 class.
 */

const { loadTemplates, getTemplate } = foundry.applications.handlebars;

let TEMPLATES_PRELOADED = false;

function templatePathToPartialName(path) {
  const file = String(path).split("/").pop() ?? "";
  return file.replace(/\.hbs$/i, "");
}

export async function preloadFxBusTemplates(tabPartials) {
  if (TEMPLATES_PRELOADED) return;

  await loadTemplates(tabPartials);

  for (const path of tabPartials) {
    const partialName = templatePathToPartialName(path);
    const templateFn = await getTemplate(path);

    Handlebars.registerPartial(partialName, templateFn);
    Handlebars.registerPartial(path, templateFn);
  }

  TEMPLATES_PRELOADED = true;
}