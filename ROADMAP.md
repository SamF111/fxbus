# Roadmap

FX Bus is actively developed around reliability, usability, and expanding the range of visual-only effects.

This roadmap describes current development direction. It is not a release promise, and individual items may change as Foundry VTT evolves.

## Library of example scripts

FX Bus is intended to work well with reusable macros and larger automation workflows.

Planned examples include:

* Basic one-click effect macros
* Spell-style visual effect examples
* Environmental scene effect examples
* Vehicle, impact, alarm, and cinematic transition examples
* Integration examples for common Foundry automation workflows

These examples will focus on visual behaviour only. FX Bus will not become a rules automation module.

## Future visual effects

More visual effects are planned for Token, Tile, Screen, and Canvas feedback.

These will remain consistent with the core FX Bus design:

* GM-triggered or permission-controlled
* client-side
* visual-only
* reversible
* no document mutation
* no persistent token, tile, scene, or world-state changes

Some experimental effects may remain private until they are stable enough to show publicly.

## Future compatibility work

FX Bus will continue to track supported Foundry VTT versions as the canvas, ApplicationV2, toolbar, and rendering APIs evolve.

Compatibility work may include:

* Maintaining support for current verified Foundry versions
* Testing visual effects across Foundry version changes
* Updating canvas and UI integration where Foundry APIs change
* Avoiding unnecessary dependencies where native Foundry behaviour is sufficient

## Not planned

FX Bus does not currently plan to include:

* Asset packs
* Rules automation
* Required player-side macro setup
* Persistent scene or document mutation
* Required dependencies on other animation modules
