# FX Bus

![Foundry Version](https://img.shields.io/badge/Foundry-v13%20%7C%20v14-informational)
![Latest Release](https://img.shields.io/github/v/release/SamF111/fxbus?label=release)
![Latest Downloads](https://img.shields.io/github/downloads/SamF111/fxbus/latest/fxbus.zip?label=latest%20downloads)

**FX Bus** is a GM-broadcast cinematic FX framework for **Foundry Virtual Tabletop v13+**.

It provides deterministic, client-side, non-persistent visual effects for live play. Effects are shown to connected clients without mutating documents, actors, tokens, scenes, or world state.

FX Bus is built for cinematic feedback, vehicle motion, alerts, screen effects, token tethers, and environmental animation.

Effects can be triggered from the GM control panel or copied out as macros. Panel actions and generated macros use the same payloads, so behaviour stays consistent whether effects are fired manually, chained into larger automation, combined with other modules, or reused in custom workflows.

## What’s New in 0.8.0

FX Bus 0.8 adds per-user audience targeting without breaking existing macros or
packets:

- Apply an effect to everyone, one user, or several selected users.
- Use the arrow beside **Apply** to choose recipients. The button label updates to
  show the current audience, for example **Apply to Bob**.
- Leave the recipient list empty to preserve the original **Everyone** behaviour.
- Build targeted macros even while their recipients are offline.
- Reject a live targeted action or saved targeted macro with a clear GM warning
  when a required recipient is unavailable.
- Keep the GM informed through one private, periodically refreshed chat card that
  lists active targeted effects, recipients, elapsed time, and remaining duration.
- Remove the private reminder after the final targeted effect stops, after a
  global reset, or when synchronisation confirms that no targeted effect remains.
- Recover the GM’s reminder state after refresh using lightweight client
  acknowledgements and state synchronisation.
- Apply **Reset All FX** to everyone regardless of the currently selected audience.
- Respect each client's Foundry **Photosensitive Mode** setting. FX Bus completely
  suppresses effect start, update, toggle, and burst actions on that client and
  displays a local warning naming the suppressed effect. Stop and Reset actions
  remain available; no reduced or "lite" effect is substituted.
- Let any user disable FX Bus effects on their own client. Enabling the client
  setting immediately clears local effects, suppresses future effects with a
  visible warning, and never changes the effects running for anyone else.
- Respect the device's `prefers-reduced-motion` request by default. FX Bus fully
  suppresses effects and shows a local warning while that preference is active;
  enabling the operating-system preference while Foundry is open immediately
  clears effects on that client only.
- Navigate the GM panel with the keyboard: category and effect tabs use proper
  tab semantics and arrow-key navigation, while the audience popup moves focus
  into its recipient choices and returns focus to its trigger when closed with
  Escape.

0.8 also adds the Screen Pulse **Overlay** blend mode, updates Screen Blur for the
current PIXI `BlurFilter` API while retaining a compatibility fallback, and expands
the automated regression suite around socket trust, targeting, macros, reset, and
reminder behaviour.




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

- **GM audience model**
  The GM can apply an effect to everyone or to selected connected users. Existing
  packets and macros that omit an audience still apply to everyone. Offline world
  users remain selectable for preparing targeted macros, while live panel actions
  require every selected recipient to be connected. The picker updates user names
  and online status while the panel remains open without resetting effect fields.
  Targeted macros also stop with a GM warning if any saved recipient is offline or
  has been deleted, rather than emitting a packet that nobody can receive. Clients
  acknowledge successfully applied targeted effects and periodically answer a
  lightweight state-sync request. The GM reconciles those replies with its private
  reminder ledger, recovering after a GM refresh and removing stale state when a
  recipient disconnects, reconnects, misses a packet, or fails to apply an effect.
  Disconnects and deleted users are removed immediately; reconnects trigger an
  immediate snapshot request instead of waiting for the periodic sync interval.

- **Global kill switch**  
  A single reset action immediately restores all transforms.

---

## Audience Targeting

The control panel uses a split Apply control. Click the main button to apply the
current effect to the displayed audience, or click its arrow to open the user
picker.

- **No users selected:** the effect applies to everyone. This is the legacy
  behaviour and keeps existing macros compatible.
- **One or more users selected:** only clients whose Foundry user IDs match the
  packet audience apply the effect.
- **Live panel actions:** every selected recipient must currently be connected.
- **Macro authoring:** offline users may be selected so a GM can prepare macros
  before a session. The generated macro validates its saved recipients when run.
- **Reset:** always applies to everyone and does not inherit the selected audience.

Audience targeting is an application filter, not a privacy or security boundary.
FX Bus packets use the shared Foundry module socket; clients may receive a packet
and then ignore it when their user ID is not in its audience.

### Targeted-effect reminders

While targeted effects are active, FX Bus keeps one private GM chat card showing:

- The number of active targeted effect groups.
- Each effect name and recipient.
- How long the effect has been active.
- Whether it runs until stopped or how much time remains.
- The number of affected token or tile targets when relevant.

The reminder interval is configurable in Foundry’s module settings and can be set
to `0` to disable reminders. Each refresh replaces the previous FX Bus reminder,
so the chat log contains at most one current card for that GM. Stop, Reset, user
disconnect/deletion, and client-state reconciliation remove the card once the
ledger becomes empty.




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
* Filters targeted packets by stable Foundry user ID
* Tracks targeted-effect acknowledgements and client state for the GM
* Maintains one private GM reminder card for active targeted effects

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

### Screen Roll
Rotates the rendered canvas view for all connected players, making the scene feel like reality has tilted, slipped, or gone very, very wrong.  
Use it for psychic attacks, rift ruptures, teleportation failures, black holes, gravity shifts, vehicle crashes, boss phase changes, dream logic, planar instability, or moments where the room itself should feel hostile.

Supports temporary wobble effects that return to normal, hard screen spins, snap rotation, and momentum-style roll effects that settle at a new angle.  
Designed to remain visual-only, client-side, and non-disruptive during play.

Screen Roll does not move tokens, tiles, walls, lights, or scene data. It only affects the rendered canvas view on each client, and can be reset through FX Bus like the other screen effects.


https://github.com/user-attachments/assets/2205d30a-74d5-43d5-8965-797fbf422b64

--

### Global Reset
An emergency recovery mechanism that immediately stops all active FX and restores the scene to a clean state.  
Intended as a guaranteed escape hatch during live play. Reset always applies to
everyone, regardless of the audience currently selected in the GM panel.


## GM Macros

Every effect tab in the GM panel can copy its current **Apply** configuration as a
macro. The copied macro includes the selected audience when one is present; when
no users are selected, it keeps the original apply-to-everyone behaviour. This
means existing audience-less macros continue to work unchanged.

Offline world users remain available while authoring a macro. When the macro is
run, FX Bus checks that every saved recipient still exists and is connected before
broadcasting the effect. Reset macros always apply globally.

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


## Optional donation

FX Bus is free and open source.

This project does not accept donations. If you would like to make a donation instead, please consider UNITED24, Ukraine’s official fundraising platform:

[Donate through UNITED24](https://u24.gov.ua/)

FX Bus receives no money from this link.

