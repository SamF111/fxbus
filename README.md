# FX Bus

**FX Bus** is a GM-broadcast, client-side visual effects framework for **Foundry Virtual Tabletop v12+**.

It provides a single, deterministic FX “bus” that allows the GM to trigger **purely visual effects** on all connected clients without mutating documents, actors, tokens, scenes, or world state.

This module is designed for **cinematic feedback**, **vehicle motion**, **alerts**, and **environmental effects** in live play.

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

Vehicle-style motion for tokens.

**Actions**

* `fx.tokenOsc.start`
* `fx.tokenOsc.update`
* `fx.tokenOsc.stop`

---

### Screen Shake

Camera shake for impacts or sustained vibration.

**Actions**

* `fx.screenShake.start`
* `fx.screenShake.stop`

**Notes**

* Supports short impulse shakes
* Supports sustained “rumble” mode using `durationMs: 0`

---

### Screen Pulse

Full-screen colour pulse for warnings, alerts, or status effects.

**Actions**

* `fx.screenPulse.start`
* `fx.screenPulse.stop`

**Features**

* Finite or infinite duration
* Sine or triangle waveforms
* Blend modes
* Safe under pan, zoom, resize, and scene changes

---

### Global Reset

Emergency recovery mechanism.

**Action**

* `fx.bus.reset`

**Effect**

* Stops all FX
* Restores all token transforms
* Restores camera position
* Removes all active tickers

---

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

* **Foundry VTT:** v12+
* **Core-only** (no system dependencies)
* Designed to coexist cleanly with other FX modules

---

## License

See [`LICENSE`](LICENSE).

---

## Author

**mintchoc**
GitHub: [https://github.com/SamF111/fxbus](https://github.com/SamF111/fxbus)


