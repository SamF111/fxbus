# FX Bus

![Foundry Version](https://img.shields.io/badge/Foundry-v13%20%7C%20v14-informational)
![Latest Release](https://img.shields.io/github/v/release/SamF111/fxbus?label=release)
![Latest Downloads](https://img.shields.io/github/downloads/SamF111/fxbus/latest/fxbus.zip?label=latest%20downloads)

**FX Bus** is a GM-broadcast cinematic FX framework for **Foundry Virtual Tabletop v14+**.

It provides deterministic, client-side, non-persistent visual effects for live play. Effects are shown to connected clients without mutating documents, actors, tokens, scenes, or world state.

FX Bus is built for cinematic feedback, vehicle motion, alerts, screen effects, token tethers, and environmental animation.

Effects can be triggered from the GM control panel or copied out as macros. Panel actions and generated macros use the same payloads, so behaviour stays consistent whether effects are fired manually, chained into larger automation, combined with other modules, or reused in custom workflows.

---
### New - Screen Roll!
Rotates the rendered canvas view for all connected players, making the scene feel like reality has tilted, slipped, or gone very, very wrong.  
Use it for psychic attacks, rift ruptures, teleportation failures, black holes, gravity shifts, vehicle crashes, boss phase changes, dream logic, planar instability, or moments where the room itself should feel hostile.

Supports temporary wobble effects that return to normal, hard screen spins, snap rotation, and momentum-style roll effects that settle at a new angle.  
Designed to remain visual-only, client-side, and non-disruptive during play.

Screen Roll does not move tokens, tiles, walls, lights, or scene data. It only affects the rendered canvas view on each client, and can be reset through FX Bus like the other screen effects.


https://github.com/user-attachments/assets/2205d30a-74d5-43d5-8965-797fbf422b64


---

## Motivation

I wanted a quick way to shake the screen, add motion to tokens, animate tiles, and create simple cinematic links without opening a heavyweight effect-authoring system during live play.

There are excellent existing solutions, notably [Token Magic FX](https://github.com/Feu-Secret/Tokenmagic), which I still use. There are also powerful automation and sequencing tools such as [Sequencer](https://github.com/fantasycalendar/FoundryVTT-Sequencer), which can achieve many similar results. FX Bus is not trying to replace those modules.

It fits a much more narrow niche. During a session, I often want immediate visual feedback: a screen shake after an explosion, a token rocking during vehicle movement, a tile swaying in the background, or a tether snapping between two characters. I do not want to pause the game to configure a complex effect stack, maintain scene objects, manage assets, or build a full sequence for a moment that needs to happen now.

I am also not a paid DM. Between Patreon subscriptions, premium modules, and content packs, running games already costs me money. FX Bus is built around the kind of effects I personally want at the table: fast, reusable, visual-only, and low-maintenance.

FX Bus exists to be:

- **Immediate to use**
- **Simple to reason about**
- **Fast to operate during live play**
- **Hard to misuse**
- **Focused on moment-to-moment narrative impact**
- **Visual-only, with no document or world-state mutation**

The design goal is simple: if an effect cannot be started, stopped, and understood immediately, it probably does not belong here.

FX Bus favours lightweight, shader-driven and PIXI-driven visual effects over deep effect authoring. It is built to support improvisation, not replace specialist VFX modules.

All effects are generated procedurally at runtime using client-side rendering. There are currently no plans to include external asset files, visual or otherwise.

---

## Demo Video

A high-speed, cyberpunk-style chase sequence viewed from the back of a pickup truck.
The underlying map movement is driven by [**Tile Scroll**](https://foundryvtt.com/packages/tile-scroll), which continuously scrolls the scene tiles to simulate forward motion.

FX Bus is layered on top to provide **camera and screen-level feedback**:

- **Token Oscillation** – active, with rotation disabled, to simulate vehicle suspension and body roll  
- **Screen Vignette** – enabled to focus attention and add cinematic framing  
- **Screen Pulse** – subtle red tint to convey danger and urgency  
- **Screen Shake** – continuous low-amplitude shake for engine vibration and road noise  
- **Screen Streak** – directional motion streaks to reinforce speed

Combined, these effects create the illusion of sustained, high-speed movement without altering scene or token data.

https://github.com/user-attachments/assets/5fc748bb-a636-4ce2-a69e-6184ab9bf4b2

---

## Core Principles

- **Client-side only**  
  All effects run locally on each client using PIXI and `canvas.app.ticker`.

- **No document mutation**  
  No Actors, Tokens, Scenes, or Lights are modified or persisted.

- **Deterministic start / stop**  
  Every effect has explicit start and stop actions. No hidden timers.

- **GM broadcast model**  
  The GM emits one message; all clients render the effect independently.

- **Global kill switch**  
  A single reset action immediately restores all transforms.

---




## Architecture Overview

FX Bus exposes a global runtime on each client:

```js
globalThis.fxbus
```

This runtime:

* Registers a single socket listener
* Dispatches FX messages by action string
* Manages effect-local state and tickers
* Applies and restores PIXI transforms safely

All effects are implemented as **handlers** registered against action names.

---

## Built-in Effects

### Token Oscillation
Applies subtle, continuous motion to selected tokens to simulate vehicles, hovering platforms, unstable footing, or general movement.  
Designed to add life and momentum without distracting from play.

https://github.com/user-attachments/assets/7b4eb845-36e3-4158-bd0c-1e2d0338001e

---

### Screen Shake
Camera shake for impacts, explosions, collisions, or sustained vibration.  
Supports short impulse shakes as well as indefinite “rumble” effects for ongoing events.





https://github.com/user-attachments/assets/87d85156-be8e-4d4c-8a49-24a921f908fb




---

### Screen Pulse
A full-screen colour pulse used for alerts, danger states, environmental effects, or narrative emphasis.  
Can be static or animated, subtle or intense, and layered safely with other effects.

---

### Screen Vignette
A darkened or coloured edge vignette applied to the screen.  
Useful for tension, low-health states, tunnel vision, environmental hazards, or cinematic framing.

---

### Chromatic Aberration
A controlled RGB split effect that can be static or animated.  
Intended for disorientation, digital distortion, magical interference, or high-stress moments.

---

### Screen Noise
A film grain / static overlay applied to the screen.  
Useful for surveillance feeds, damaged optics, corrupted signals, or environmental grit.

---

### Screen Blur
A full-screen post-process blur effect.  
Supports static blur or slow pulsing blur for intoxication, fatigue, shock, or dreamlike sequences.

---

### Screen Smear
A screen-space motion smear that leaves trailing ghosts behind movement.  
Designed for high-speed motion, extreme momentum, or temporal distortion effects.

---

### Screen Streak
Directional motion streaks using temporal feedback.  
Useful for rapid movement, warp effects, velocity emphasis, or cinematic transitions.

---

### Tile Oscillation
Applies subtle, continuous motion to selected tiles to simulate swaying trees, hanging signs, loose cables, cloth, foliage, machinery, lamps, or suspended debris.  
Designed to bring environmental objects to life while remaining visual-only and non-disruptive during play.

https://github.com/user-attachments/assets/b476a2c5-744e-49c6-be2a-bcf127f71106

---

### Monochrome Filter
Applies a full-screen monochrome grade for noir scenes, flashbacks, surveillance feeds, dream states, dramatic reveals, or cinematic emphasis.  
Supports fade-in, timed duration, fade-out, contrast, brightness, and opacity controls while remaining entirely visual-only.

https://github.com/user-attachments/assets/c1c80514-99ce-47d9-85b3-b70335213432

---


### Token Laser Links
Draws persistent visual links between selected tokens, including lasers, beams, arcs, and moving energy-flow effects.  
Use it for magical tethers, targeting lines, power conduits, healing links, containment beams, security grids, boss mechanics, or synchronised token networks.

Supports source-to-target links or full token networks, with configurable colour, width, glow, pulse, render layer, and animated motion packets.  
Designed to remain visual-only, client-side, and non-disruptive during play.

Demo: Tiny and Io-style tethering from Dota 2.


https://github.com/user-attachments/assets/5016e0a7-31e3-4e49-8414-abce725b6e6b

---

### Global Reset
An emergency recovery mechanism that immediately stops all active FX and restores the scene to a clean state.  
Intended as a guaranteed escape hatch during live play.


## GM Macros

FX Bus includes GM macros for:

* Token oscillation control
* Screen shake control
* Screen pulse control
* Global reset

All macros use the unified emitter:

```js
globalThis.fxbus.emit({ action: "fx.bus.reset" });
```

Macros do **not** emit directly to sockets.

---

## AI Assistance Disclosure

**This project uses ChatGPT as a development assistant.**

ChatGPT was used to:

* Design the FX Bus architecture
* Draft and refine JavaScript modules
* Debug Foundry VTT lifecycle and PIXI rendering issues
* Iterate on effect behaviour and safety guarantees

All code has been reviewed, tested, and integrated manually by the author.
ChatGPT is used strictly as a **tool**, not as an automated code generator or decision-maker.

---

## Compatibility

* **Foundry VTT:** v13+
* **Core-only** (no system dependencies)
* Designed to coexist cleanly with other FX modules

---

## License
FX Bus is released under the MIT License.

If you fork or build upon this project, attribution in documentation or module metadata is appreciated but not required.

See [`LICENSE`](LICENSE).

---

## Author

**mintchoc**
GitHub: [https://github.com/SamF111/fxbus](https://github.com/SamF111/fxbus)

## Feature Requests

If there is an effect you believe fits the scope of FX Bus, please describe it in the **Feature Requests** issue.

Proposed effects should be:
- Easy to describe in plain language
- Simple to start and stop
- Focused on immediate, cinematic feedback during play

If an effect requires complex configuration, authoring workflows, or persistent state, it likely does not belong in FX Bus.

If the proposal aligns with the goals of the project, I will do my best to implement it.

[Feature Requests](https://github.com/SamF111/fxbus/issues/1)


