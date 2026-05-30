# Roadmap

FX Bus is actively developed around three priorities: usability, reliability, and expanding the range of visual-only effects.

This roadmap describes current development direction. It is not a release promise, and individual items may change as Foundry VTT evolves.

## Planned improvements

### Better GM interface

The FX Bus control panel will continue to improve as the main way to configure, trigger, stop, and copy effects.

Planned areas include:

- Improved responsive layout for 1080p displays, smaller screens, and Foundry windows that are not full-screen
- Clearer grouping of effect controls
- More compact controls where space is limited
- More consistent control patterns across effect types
- Better presets for common use cases
- Improved copy-to-macro workflows
- Better visibility of what an effect will do before it is triggered

### Library of example scripts

FX Bus is intended to work well with reusable macros and larger automation workflows.

Planned examples include:

- Basic one-click effect macros
- Spell-style visual effect examples
- Environmental scene effect examples
- Vehicle, impact, alarm, and cinematic transition examples
- Integration examples for common Foundry automation workflows

These examples will focus on visual behaviour only. FX Bus will not become a rules automation module.

### Automatic GitHub validation

A future goal is to add automated checks before publishing releases.

Planned checks may include:

- `module.json` validation
- Manifest and download URL checks
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

## Trusted player macro support

FX Bus is primarily GM-controlled, but some tables may want selected players to trigger visual effects through macros.

A planned improvement is to replace overly defensive GM-only macro guards with a more flexible trust check. The intended behaviour is:

GM users can trigger FX Bus effects
trusted players may be allowed to trigger FX Bus effects where appropriate
untrusted players remain blocked from broadcasting effects
copied macros should make their permission behaviour clear
received payloads should include enough sender information for validation and debugging

This would allow player-facing cinematic macros without making FX Bus a general unrestricted player broadcast system.

## Not planned

FX Bus does not currently plan to include:

- Asset packs
- Rules automation
- Player-side macro requirements
- Persistent scene or document mutation
- Required dependencies on other animation modules
