# Roadmap

FX Bus is actively developed around three priorities: usability, reliability, and expanding the range of visual-only effects.

This roadmap describes current development direction. It is not a release promise, and individual items may change as Foundry VTT evolves.

## Planned improvements

### Better GM interface

The FX Bus control panel will continue to improve as the main way to configure, trigger, stop, and copy effects.

Planned areas include:

- Clearer layout and grouping of effects
- Better presets for common use cases
- More consistent controls across effect types
- Improved copy-to-macro workflows
- Better visibility of what an effect will do before it is triggered

### Library of example scripts

FX Bus is intended to work well with reusable macros and larger automation workflows.

Planned examples include:

- Basic one-click effect macros
- Spell-style effect examples
- Environmental scene effect examples
- Vehicle, impact, alarm, and cinematic transition examples
- Integration examples for common Foundry automation workflows

These examples will focus on visual behaviour only. FX Bus will not become a rules automation module.

### Automatic GitHub validation

A future goal is to add automated checks before publishing releases.

Planned checks may include:

- `module.json` validation
- Manifest/download URL checks
- Required file presence checks
- JavaScript syntax checks
- Release package structure checks
- Basic compatibility checks for supported Foundry versions

The goal is to reduce broken releases and catch packaging mistakes before publication.

## Future visual effects

More visual effects are planned, especially for screen, token, tile, and canvas-level feedback.

These will remain consistent with the core FX Bus design:

- GM-triggered
- client-side
- visual-only
- reversible
- no document mutation
- no persistent token, tile, scene, or world-state changes

Some experimental effects may remain private until they are stable enough to show publicly.

## Not planned

FX Bus does not currently plan to include:

- Asset packs
- Rules automation
- Player-side macro requirements
- Persistent scene or document mutation
- Required dependencies on other animation modules