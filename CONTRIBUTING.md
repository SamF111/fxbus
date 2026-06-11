## Adding a new FX

A new persistent FX with a GM panel tab usually requires changes in these files:

- `scripts/effects/<effect>Fx.js` - runtime effect implementation
- `scripts/effects/index.js` - register the effect
- `scripts/effects/fxbusResetFx.js` - include it in Reset All FX, if persistent
- `scripts/ui/tabs/<effect>Tab.js` - panel wiring and macro payload builder
- `templates/tabs/<effect>Tab.hbs` - tab form controls
- `scripts/ui/panel/panelRegistry.js` - add the tab to the panel catalogue
- `templates/fxbus-panel.hbs` - add the tab partial section

Optional:

- `styles/fxbus.css` - only for custom layout/styling
- `README.md` / `CHANGELOG.md` - only for release documentation

The main panel app, socket layer, toolbar controls, and shared panel modules should not need editing for a normal new FX.