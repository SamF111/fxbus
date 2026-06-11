// D:\FoundryVTT\Data\modules\fxbus\scripts\effects\canvasMirrorFx.js

/**
 * FX Bus - Canvas Mirror
 *
 * Purpose:
 * - Mirror the rendered Foundry canvas horizontally, vertically, or both.
 * - Preserve Foundry ownership of canvas.app.stage so pan/zoom remains usable.
 *
 * Rendering model:
 * - Applies a CSS transform to canvas.app.view / canvas.app.renderer.view.
 * - Does not mutate canvas.app.stage.
 * - Does not mutate Scene, Token, Tile, Actor, Item, or embedded Documents.
 *
 * Toggle model:
 * - Starting the same mirror axis again toggles that axis off with the selected
 *   transition.
 * - Stop and Reset restore immediately with no transition.
 * - Horizontal + Horizontal = Normal.
 * - Vertical + Vertical = Normal.
 * - Horizontal + Vertical = Both axes.
 * - Both axes + Horizontal = Vertical.
 * - Both axes + Vertical = Horizontal.
 * - Both axes + Both axes = Normal.
 *
 * Transition model:
 * - instant:
 *   Applies the mirror immediately.
 *
 * - fold:
 *   Animates the live canvas element with a temporary CSS/Web Animations fold,
 *   then settles into the normal mirrored CSS scale state.
 *
 * - realityRipple:
 *   Distorts the live canvas with a squash/stretch ripple, then settles into
 *   the normal mirrored CSS scale state.
 *
 * - glitchSnap:
 *   Crushes, offsets, over-brightens, and phase-tears the live canvas before
 *   snapping late into the mirrored state.
 *
 *   These transitions deliberately do not draw the WebGL canvas into a temporary
 *   2D canvas. Some browsers/Foundry configurations return a black snapshot from
 *   WebGL canvas drawImage(), which makes snapshot transitions look like a black
 *   wipe.
 *
 * Interaction modes:
 * - remap:
 *   Mirrors pointer/mouse coordinates back into Foundry's unmirrored coordinate
 *   space. This allows basic player interaction, including click and drag.
 *
 * - lock:
 *   Mirrors the canvas but blocks pointer/mouse interaction. Wheel remains
 *   available. Use this for cinematic-only moments.
 *
 * - visualOnly:
 *   Mirrors the canvas without event interception. Interaction will feel
 *   visually inverted.
 *
 * Keyboard behaviour:
 * - Canvas Mirror does not intercept keydown, keyup, or keypress.
 * - Numpad macro shortcuts, Escape, and keyboard token movement should continue
 *   to route through Foundry's normal keyboard handling.
 * - Pointer interception can prevent native canvas focus, so the effect makes
 *   the canvas temporarily focusable and explicitly focuses it while active.
 *
 * GUI safety:
 * - Canvas Mirror uses global capture listeners for pointer/mouse remapping.
 * - Events inside the FX Bus panel are hard-exempted before any preventDefault()
 *   or stopImmediatePropagation() call.
 * - Other Foundry and module UI remains clickable because mouse compatibility
 *   events are only suppressed after they are proven to belong to the canvas.
 * - This keeps Start, Stop, Copy to Macro, category tabs, sub-tabs, panel
 *   dragging, panel resizing, scene controls, and third-party module buttons
 *   usable while the canvas is mirrored.
 *
 * User-facing UI:
 * - No warning/status popup is shown on the canvas.
 *
 * Known limitation:
 * - Remapped interaction is intentionally best-effort. GM interaction may flicker
 *   while other tokens are moving because PIXI hit testing, token animation, and
 *   synthetic mirrored events can briefly disagree.
 *
 * Actions:
 * - fx.canvasMirror.start
 * - fx.canvasMirror.stop
 *
 * Payload:
 * {
 *   action: "fx.canvasMirror.start",
 *   axis: "x" | "y" | "xy" | "horizontal" | "vertical" | "both",
 *   interactionMode: "remap" | "lock" | "visualOnly",
 *   transition: "instant" | "fold" | "realityRipple" | "glitchSnap",
 *   transitionMs: 0..5000
 * }
 */

const EFFECT_KEY = "canvasMirror";

const ACTION_START = "fx.canvasMirror.start";
const ACTION_STOP = "fx.canvasMirror.stop";

const STYLE_ID = "fxbus-canvas-mirror-style";

const POINTER_EVENT_TYPES = [
  "pointerover",
  "pointerenter",
  "pointerdown",
  "pointermove",
  "pointerup",
  "pointercancel",
  "pointerout",
  "pointerleave"
];

const MOUSE_EVENT_TYPES = [
  "mouseover",
  "mouseenter",
  "mousedown",
  "mousemove",
  "mouseup",
  "click",
  "dblclick",
  "contextmenu",
  "mouseout",
  "mouseleave"
];

const WHEEL_EVENT_TYPES = [
  "wheel"
];

const LOCKED_POINTER_AND_MOUSE_EVENTS = [
  ...POINTER_EVENT_TYPES,
  ...MOUSE_EVENT_TYPES
];

function getCanvasElement() {
  return canvas?.app?.view ?? canvas?.app?.renderer?.view ?? document.querySelector("canvas");
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normaliseAxis(value) {
  const axis = String(value ?? "x").trim().toLowerCase();

  if (axis === "horizontal") return "x";
  if (axis === "vertical") return "y";
  if (axis === "both") return "xy";

  if (axis === "x") return "x";
  if (axis === "y") return "y";
  if (axis === "xy") return "xy";

  return "x";
}

function normaliseInteractionMode(value) {
  const mode = String(value ?? "remap").trim().toLowerCase();

  if (mode === "remap") return "remap";
  if (mode === "lock") return "lock";
  if (mode === "visualonly") return "visualOnly";
  if (mode === "visual-only") return "visualOnly";
  if (mode === "visual_only") return "visualOnly";
  if (mode === "none") return "visualOnly";

  return "remap";
}

function normaliseTransition(value) {
  const transition = String(value ?? "instant").trim().toLowerCase();

  if (transition === "instant") return "instant";
  if (transition === "fold") return "fold";

  if (transition === "realityripple") return "realityRipple";
  if (transition === "reality-ripple") return "realityRipple";
  if (transition === "reality_ripple") return "realityRipple";
  if (transition === "ripple") return "realityRipple";

  if (transition === "glitchsnap") return "glitchSnap";
  if (transition === "glitch-snap") return "glitchSnap";
  if (transition === "glitch_snap") return "glitchSnap";
  if (transition === "glitch") return "glitchSnap";

  return "instant";
}

function defaultTransitionMs(transition) {
  if (transition === "fold") return 350;
  if (transition === "realityRipple") return 700;
  if (transition === "glitchSnap") return 650;
  return 0;
}

function normaliseTransitionMs(value, transition) {
  const fallback = defaultTransitionMs(transition);
  return clamp(num(value, fallback), 0, 5000);
}

function getScaleSigns(axis) {
  return {
    x: axis === "x" || axis === "xy" ? -1 : 1,
    y: axis === "y" || axis === "xy" ? -1 : 1
  };
}

function signsToAxis(signs) {
  if (signs.x === 1 && signs.y === 1) return "normal";
  if (signs.x === -1 && signs.y === 1) return "x";
  if (signs.x === 1 && signs.y === -1) return "y";
  return "xy";
}

function toggleAxis(currentAxis, requestedAxis) {
  /**
   * Large comment:
   * Combine the current mirror state with the requested mirror using sign
   * multiplication.
   *
   * This makes each axis behave as a true toggle. Requesting horizontal while
   * already horizontally mirrored returns to normal. Requesting vertical while
   * horizontally mirrored produces both axes.
   */
  const current = getScaleSigns(currentAxis);
  const requested = getScaleSigns(requestedAxis);

  return signsToAxis({
    x: current.x * requested.x,
    y: current.y * requested.y
  });
}

function removeElementById(id) {
  document.getElementById(id)?.remove();
}

function removeCanvasMirrorStyle() {
  removeElementById(STYLE_ID);
}

function installCanvasMirrorStyle() {
  removeCanvasMirrorStyle();

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    canvas[data-fxbus-canvas-mirror="1"] {
      transform-style: preserve-3d;
      backface-visibility: visible;
    }
  `;

  document.head.appendChild(style);
}

function snapshotCanvasElementStyle(element) {
  /**
   * Large comment:
   * Capture only the DOM style properties this effect mutates.
   *
   * The canvas element may already have inline styles from Foundry or other
   * modules. Stop must restore the exact previous inline values rather than
   * assuming blanks.
   */
  return {
    transform: element.style.transform,
    transformOrigin: element.style.transformOrigin,
    willChange: element.style.willChange,
    visibility: element.style.visibility,
    transition: element.style.transition,
    filter: element.style.filter,
    opacity: element.style.opacity,
    transformStyle: element.style.transformStyle,
    backfaceVisibility: element.style.backfaceVisibility,
    datasetMirror: element.dataset.fxbusCanvasMirror
  };
}

function restoreCanvasElementStyle(element, snapshot) {
  if (!element || !snapshot) return;

  element.style.transform = snapshot.transform;
  element.style.transformOrigin = snapshot.transformOrigin;
  element.style.willChange = snapshot.willChange;
  element.style.visibility = snapshot.visibility;
  element.style.transition = snapshot.transition;
  element.style.filter = snapshot.filter;
  element.style.opacity = snapshot.opacity;
  element.style.transformStyle = snapshot.transformStyle;
  element.style.backfaceVisibility = snapshot.backfaceVisibility;

  if (snapshot.datasetMirror === undefined) {
    delete element.dataset.fxbusCanvasMirror;
  } else {
    element.dataset.fxbusCanvasMirror = snapshot.datasetMirror;
  }
}

function snapshotCanvasFocusState(element) {
  /**
   * Large comment:
   * Capture focus-related canvas state before Canvas Mirror changes it.
   *
   * Canvas Mirror prevents and redispatches pointer events. That can stop the
   * browser's normal focus assignment, which Foundry relies on for Escape,
   * arrow-key movement, and numpad macro routing. The effect therefore makes the
   * canvas temporarily focusable while active and restores the original tabindex
   * state on stop.
   */
  return {
    hadTabIndexAttribute: element.hasAttribute("tabindex"),
    tabIndexAttribute: element.getAttribute("tabindex")
  };
}

function restoreCanvasFocusState(element, snapshot) {
  if (!element || !snapshot) return;

  if (snapshot.hadTabIndexAttribute) {
    element.setAttribute("tabindex", snapshot.tabIndexAttribute ?? "");
    return;
  }

  element.removeAttribute("tabindex");
}

function makeCanvasFocusable(element) {
  if (!element) return;

  if (!element.hasAttribute("tabindex")) {
    element.setAttribute("tabindex", "-1");
  }
}

function focusCanvasElement(element) {
  /**
   * Large comment:
   * Focus the canvas without touching keyboard event flow.
   *
   * This function deliberately does not add key listeners and does not call
   * preventDefault on keyboard events. It only restores the focus target that
   * Foundry normally expects after a canvas click.
   */
  if (!element) return;

  try {
    makeCanvasFocusable(element);
    element.focus({ preventScroll: true });
  } catch {
    try {
      element.focus();
    } catch {
      // ignore
    }
  }
}

function applyCanvasCssMirror(element, axis) {
  const signs = getScaleSigns(axis);

  element.style.visibility = "";
  element.style.transition = "";
  element.style.filter = "";
  element.style.opacity = "";
  element.style.transformOrigin = "50% 50%";
  element.style.transform = `scale(${signs.x}, ${signs.y})`;
  element.style.willChange = "transform";
  element.style.transformStyle = "preserve-3d";
  element.style.backfaceVisibility = "visible";
  element.dataset.fxbusCanvasMirror = "1";
}

function eventPathContainsCanvas(event, state) {
  const element = state?.canvasElement;
  if (!element) return false;

  if (event.target === element) return true;

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path.includes(element);
}

function eventPathContainsFxBusUi(event) {
  /**
   * Large comment:
   * Detect events that belong to the FX Bus control panel or its window chrome.
   *
   * Canvas Mirror installs global capture listeners. During token drag/movement
   * states, those listeners can otherwise swallow panel button clicks before the
   * tab's own Start/Stop/Copy listeners receive them. This guard must run before
   * any preventDefault() or stopImmediatePropagation() call.
   */
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];

  return path.some((entry) => {
    if (!(entry instanceof Element)) return false;

    return Boolean(
      entry.closest?.(".fxbus-panel-app") ||
      entry.closest?.("form.fxbus-panel") ||
      entry.closest?.("#fxbus-gm-control-panel")
    );
  });
}

function eventBelongsToCanvas(event, state) {
  /**
   * Large comment:
   * Decide whether a pointer/mouse/wheel event should be intercepted by Canvas
   * Mirror.
   *
   * Hover state must not make every later event belong to the canvas. If it does,
   * the global capture listener can swallow FX Bus panel button clicks while a
   * token is animating after movement.
   *
   * Dragging is the only state allowed to keep claiming events after the pointer
   * has left the canvas, because drag streams may legitimately leave the canvas
   * bounds before pointerup.
   */
  if (eventPathContainsCanvas(event, state)) return true;
  if (state?.dragging === true) return true;
  return false;
}

function mirrorClientPoint(event, element, axis) {
  const rect = element.getBoundingClientRect();

  let clientX = event.clientX;
  let clientY = event.clientY;

  if (axis === "x" || axis === "xy") {
    clientX = rect.left + rect.right - event.clientX;
  }

  if (axis === "y" || axis === "xy") {
    clientY = rect.top + rect.bottom - event.clientY;
  }

  return { clientX, clientY };
}

function getMirroredMovement(event, axis) {
  const signs = getScaleSigns(axis);

  const movementX = Number.isFinite(event.movementX) ? event.movementX : 0;
  const movementY = Number.isFinite(event.movementY) ? event.movementY : 0;

  return {
    movementX: movementX * signs.x,
    movementY: movementY * signs.y
  };
}

function baseMouseInit(event, clientX, clientY) {
  return {
    bubbles: true,
    cancelable: true,
    composed: true,

    screenX: event.screenX,
    screenY: event.screenY,
    clientX,
    clientY,

    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,

    button: event.button,
    buttons: event.buttons,
    relatedTarget: event.relatedTarget,

    detail: event.detail,
    view: window
  };
}

function defineSyntheticFlag(event) {
  try {
    Object.defineProperty(event, "__fxbusCanvasMirrorSynthetic", {
      value: true,
      enumerable: false
    });
  } catch {
    event.__fxbusCanvasMirrorSynthetic = true;
  }
}

function defineMovement(event, movementX, movementY) {
  try {
    Object.defineProperty(event, "movementX", {
      value: movementX,
      enumerable: true,
      configurable: true
    });

    Object.defineProperty(event, "movementY", {
      value: movementY,
      enumerable: true,
      configurable: true
    });
  } catch {
    // Some browsers may reject movement override. Continue.
  }
}

function isSyntheticCanvasMirrorEvent(event) {
  return event?.__fxbusCanvasMirrorSynthetic === true;
}

function createPointerSynthetic(event, element, axis) {
  const { clientX, clientY } = mirrorClientPoint(event, element, axis);
  const { movementX, movementY } = getMirroredMovement(event, axis);

  const synthetic = new PointerEvent(event.type, {
    ...baseMouseInit(event, clientX, clientY),
    pointerId: event.pointerId,
    width: event.width,
    height: event.height,
    pressure: event.pressure,
    tangentialPressure: event.tangentialPressure,
    tiltX: event.tiltX,
    tiltY: event.tiltY,
    twist: event.twist,
    pointerType: event.pointerType,
    isPrimary: event.isPrimary
  });

  defineSyntheticFlag(synthetic);
  defineMovement(synthetic, movementX, movementY);

  return synthetic;
}

function createMouseSynthetic(event, element, axis) {
  const { clientX, clientY } = mirrorClientPoint(event, element, axis);
  const { movementX, movementY } = getMirroredMovement(event, axis);

  const synthetic = new MouseEvent(event.type, baseMouseInit(event, clientX, clientY));

  defineSyntheticFlag(synthetic);
  defineMovement(synthetic, movementX, movementY);

  return synthetic;
}

function createWheelSynthetic(event, element, axis) {
  const { clientX, clientY } = mirrorClientPoint(event, element, axis);

  const synthetic = new WheelEvent(event.type, {
    ...baseMouseInit(event, clientX, clientY),
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaZ: event.deltaZ,
    deltaMode: event.deltaMode
  });

  defineSyntheticFlag(synthetic);

  return synthetic;
}

function dispatchSyntheticToCanvas(state, synthetic) {
  const element = state?.canvasElement;
  if (!element) return;

  element.dispatchEvent(synthetic);
}

function updatePointerStateBeforeDispatch(event, state) {
  if (
    event.type === "pointerover" ||
    event.type === "pointerenter" ||
    event.type === "pointermove"
  ) {
    state.hovering = true;
    state.suppressMouseUntil = performance.now() + 750;
    return;
  }

  if (event.type === "pointerout" || event.type === "pointerleave") {
    state.hovering = false;
    state.suppressMouseUntil = performance.now() + 750;
    return;
  }

  if (event.type === "pointerdown") {
    state.dragging = true;
    state.hovering = true;
    state.activePointerId = event.pointerId;
    state.suppressMouseUntil = performance.now() + 1000;

    try {
      state.canvasElement?.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }

    return;
  }

  if (event.type === "pointerup" || event.type === "pointercancel") {
    state.dragging = false;
    state.activePointerId = null;
    state.suppressMouseUntil = performance.now() + 1000;

    try {
      state.canvasElement?.releasePointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  }
}

function maybeFocusCanvasAfterPointerEvent(event, state) {
  /**
   * Large comment:
   * Restore Foundry keyboard routing after remapped clicks.
   *
   * The real pointer event is prevented, so the browser may not focus the canvas
   * by itself. Focusing on pointerdown/mousedown restores Escape, arrow keys,
   * and numpad macro shortcuts without suppressing keyboard events.
   */
  if (event.type !== "pointerdown" && event.type !== "mousedown") return;
  focusCanvasElement(state?.canvasElement);
}

function interceptPointerEvent(event, state) {
  if (eventPathContainsFxBusUi(event)) return;
  if (isSyntheticCanvasMirrorEvent(event)) return;
  if (!eventBelongsToCanvas(event, state)) return;

  if (
    state.dragging &&
    state.activePointerId !== null &&
    event.pointerId !== state.activePointerId
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }

  updatePointerStateBeforeDispatch(event, state);

  const synthetic = createPointerSynthetic(event, state.canvasElement, state.axis);

  event.preventDefault();
  event.stopImmediatePropagation();

  dispatchSyntheticToCanvas(state, synthetic);
  maybeFocusCanvasAfterPointerEvent(event, state);
}

function interceptMouseEvent(event, state) {
  if (eventPathContainsFxBusUi(event)) return;
  if (isSyntheticCanvasMirrorEvent(event)) return;

  /**
   * Large comment:
   * Mouse compatibility events are global browser events. They must not be
   * suppressed just because a recent pointer event touched the canvas. First
   * prove that this event belongs to the canvas interaction stream. This keeps
   * Foundry UI, the left scene controls, and unknown module buttons clickable
   * without maintaining a brittle selector whitelist.
   */
  if (!eventBelongsToCanvas(event, state)) return;

  if (state.pointerSupported && performance.now() < state.suppressMouseUntil) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type === "mousedown") {
      focusCanvasElement(state.canvasElement);
    }

    return;
  }

  if (state.pointerSupported && state.dragging) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (event.type === "mousedown") {
      focusCanvasElement(state.canvasElement);
    }

    return;
  }

  if (
    event.type === "mouseover" ||
    event.type === "mouseenter" ||
    event.type === "mousemove"
  ) {
    state.hovering = true;
  }

  if (event.type === "mouseout" || event.type === "mouseleave") {
    state.hovering = false;
  }

  if (event.type === "mousedown") {
    state.dragging = true;
  }

  if (event.type === "mouseup") {
    state.dragging = false;
    state.suppressMouseUntil = performance.now() + 500;
  }

  const synthetic = createMouseSynthetic(event, state.canvasElement, state.axis);

  event.preventDefault();
  event.stopImmediatePropagation();

  dispatchSyntheticToCanvas(state, synthetic);
  maybeFocusCanvasAfterPointerEvent(event, state);
}

function interceptWheelEvent(event, state) {
  if (eventPathContainsFxBusUi(event)) return;
  if (isSyntheticCanvasMirrorEvent(event)) return;
  if (!eventBelongsToCanvas(event, state)) return;

  const synthetic = createWheelSynthetic(event, state.canvasElement, state.axis);

  event.preventDefault();
  event.stopImmediatePropagation();

  dispatchSyntheticToCanvas(state, synthetic);
}

function blockCanvasInteraction(event, state) {
  if (eventPathContainsFxBusUi(event)) return;
  if (!eventPathContainsCanvas(event, state)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  if (event.type === "pointerdown" || event.type === "mousedown") {
    focusCanvasElement(state.canvasElement);
  }
}

function addWindowListener(state, type, handler) {
  window.addEventListener(type, handler, {
    capture: true,
    passive: false,
    signal: state.abortController.signal
  });
}

function installRemapMode(state) {
  /**
   * Large comment:
   * Install best-effort mirrored coordinate remapping.
   *
   * Pointer events are treated as the primary interaction stream. Mouse
   * compatibility events are suppressed during active pointer hover/drag to
   * reduce duplicate raw/synthetic event conflict.
   *
   * Keyboard events are intentionally not intercepted. This preserves Escape,
   * arrow-key movement, and numpad macro shortcuts.
   */
  for (const type of POINTER_EVENT_TYPES) {
    addWindowListener(state, type, (event) => interceptPointerEvent(event, state));
  }

  for (const type of MOUSE_EVENT_TYPES) {
    addWindowListener(state, type, (event) => interceptMouseEvent(event, state));
  }

  for (const type of WHEEL_EVENT_TYPES) {
    addWindowListener(state, type, (event) => interceptWheelEvent(event, state));
  }
}

function installLockMode(state) {
  /**
   * Large comment:
   * Install cinematic lock mode.
   *
   * Pointer and mouse interaction is blocked to avoid misleading hit testing.
   * Wheel events are deliberately not blocked, preserving zoom behaviour.
   *
   * Keyboard events are intentionally not intercepted. This preserves Escape,
   * arrow-key movement, and numpad macro shortcuts.
   */
  for (const type of LOCKED_POINTER_AND_MOUSE_EVENTS) {
    addWindowListener(state, type, (event) => blockCanvasInteraction(event, state));
  }
}

function uninstallEventHandling(state) {
  try {
    state?.abortController?.abort?.();
  } catch {
    // ignore
  }

  if (state) {
    state.abortController = null;
  }
}

function getFinalMirrorTransform(axis) {
  const signs = getScaleSigns(axis);
  return `scale(${signs.x}, ${signs.y})`;
}

function getTransitionStartTransform(_axis) {
  return "perspective(1200px) rotateX(0deg) rotateY(0deg) scale(1, 1)";
}

function getFoldMidTransform(axis) {
  if (axis === "x") {
    return "perspective(1200px) rotateY(58deg) scale(0.985, 0.985)";
  }

  if (axis === "y") {
    return "perspective(1200px) rotateX(-58deg) scale(0.985, 0.985)";
  }

  return "perspective(1200px) rotateY(58deg) rotateX(-58deg) scale(0.97, 0.97)";
}

function getFoldEndTransform(axis) {
  if (axis === "x") {
    return "perspective(1200px) rotateY(180deg) scale(1, 1)";
  }

  if (axis === "y") {
    return "perspective(1200px) rotateX(180deg) scale(1, 1)";
  }

  return "perspective(1200px) rotateY(180deg) rotateX(180deg) scale(1, 1)";
}

function getFoldReturnMidTransform(axis) {
  if (axis === "x") {
    return "perspective(1200px) rotateY(238deg) scale(0.985, 0.985)";
  }

  if (axis === "y") {
    return "perspective(1200px) rotateX(238deg) scale(0.985, 0.985)";
  }

  return "perspective(1200px) rotateY(238deg) rotateX(238deg) scale(0.97, 0.97)";
}

function getFoldReturnEndTransform(axis) {
  if (axis === "x") {
    return "perspective(1200px) rotateY(360deg) scale(1, 1)";
  }

  if (axis === "y") {
    return "perspective(1200px) rotateX(360deg) scale(1, 1)";
  }

  return "perspective(1200px) rotateY(360deg) rotateX(360deg) scale(1, 1)";
}

function getRealityRippleMidTransform(axis) {
  if (axis === "x") return "scale(0.82, 1.08) skew(4deg, 0deg)";
  if (axis === "y") return "scale(1.08, 0.82) skew(0deg, -4deg)";
  return "scale(0.86, 0.86) skew(4deg, -4deg)";
}

function cancelTransitionAnimation(state) {
  /**
   * Large comment:
   * Cancel the Web Animations object so fill-forwards does not continue owning
   * the element's visual transform after Stop, Reset, or animation completion.
   *
   * This is essential because restoring inline styles is not enough if the
   * browser still has an active or filled animation effect on the same element.
   */
  if (!state?.transitionAnimation) return;

  const animation = state.transitionAnimation;
  state.transitionAnimation = null;

  try {
    animation.onfinish = null;
    animation.oncancel = null;
    animation.cancel();
  } catch {
    // ignore
  }
}

function clearTransitionState(state) {
  if (!state) return;

  if (state.transitionTimer) {
    clearTimeout(state.transitionTimer);
    state.transitionTimer = null;
  }

  cancelTransitionAnimation(state);

  state.transitioning = false;
}

function buildRealityRippleKeyframes(axis) {
  const finalTransform = getFinalMirrorTransform(axis);

  return [
    {
      transform: "scale(1, 1) skew(0deg, 0deg)",
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    },
    {
      transform: axis === "y"
        ? "scale(0.965, 1.035) skew(0deg, -2deg)"
        : "scale(1.035, 0.965) skew(-2deg, 0deg)",
      filter: "brightness(1.18) contrast(1.18) saturate(0.8)",
      opacity: "0.96",
      offset: 0.24
    },
    {
      transform: getRealityRippleMidTransform(axis),
      filter: "brightness(0.72) contrast(1.35) saturate(0.65)",
      opacity: "0.9",
      offset: 0.52
    },
    {
      transform: axis === "y"
        ? "scale(0.94, 1.06) skew(0deg, 1deg)"
        : "scale(1.06, 0.94) skew(-1deg, 0deg)",
      filter: "brightness(1.12) contrast(1.12) saturate(1.15)",
      opacity: "1",
      offset: 0.76
    },
    {
      transform: finalTransform,
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    }
  ];
}

function buildRealityRippleReturnKeyframes(axis) {
  return [
    {
      transform: getFinalMirrorTransform(axis),
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    },
    {
      transform: axis === "y"
        ? "scale(0.94, 1.06) skew(0deg, 1deg)"
        : "scale(1.06, 0.94) skew(-1deg, 0deg)",
      filter: "brightness(1.12) contrast(1.12) saturate(1.15)",
      opacity: "1",
      offset: 0.24
    },
    {
      transform: getRealityRippleMidTransform(axis),
      filter: "brightness(0.72) contrast(1.35) saturate(0.65)",
      opacity: "0.9",
      offset: 0.52
    },
    {
      transform: axis === "y"
        ? "scale(0.965, 1.035) skew(0deg, -2deg)"
        : "scale(1.035, 0.965) skew(-2deg, 0deg)",
      filter: "brightness(1.18) contrast(1.18) saturate(0.8)",
      opacity: "0.96",
      offset: 0.76
    },
    {
      transform: "scale(1, 1) skew(0deg, 0deg)",
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    }
  ];
}

function buildGlitchSnapKeyframes(axis) {
  const finalTransform = getFinalMirrorTransform(axis);

  return [
    {
      transform: "translate(0px, 0px) scale(1, 1) skew(0deg, 0deg)",
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    },
    {
      transform: axis === "y"
        ? "translate(0px, -18px) scale(1.08, 0.72) skew(0deg, -7deg)"
        : "translate(-18px, 0px) scale(0.72, 1.08) skew(-7deg, 0deg)",
      filter: "brightness(1.65) contrast(2.1) saturate(0.35)",
      opacity: "0.78",
      offset: 0.22
    },
    {
      transform: axis === "y"
        ? "translate(0px, 22px) scale(0.94, 1.18) skew(0deg, 8deg)"
        : "translate(22px, 0px) scale(1.18, 0.94) skew(8deg, 0deg)",
      filter: "brightness(0.45) contrast(2.4) saturate(0.2)",
      opacity: "0.62",
      offset: 0.42
    },
    {
      transform: axis === "y"
        ? "translate(0px, -10px) scale(1.04, 0.86) skew(0deg, -4deg)"
        : "translate(-10px, 0px) scale(0.86, 1.04) skew(-4deg, 0deg)",
      filter: "brightness(1.9) contrast(2.2) saturate(1.4)",
      opacity: "0.9",
      offset: 0.62
    },
    {
      transform: `${finalTransform} translate(8px, -3px)`,
      filter: "brightness(1.45) contrast(1.8) saturate(0.7)",
      opacity: "0.94",
      offset: 0.78
    },
    {
      transform: `${finalTransform} translate(-5px, 2px)`,
      filter: "brightness(0.75) contrast(1.55) saturate(0.8)",
      opacity: "0.9",
      offset: 0.88
    },
    {
      transform: finalTransform,
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    }
  ];
}

function buildGlitchSnapReturnKeyframes(axis) {
  const startTransform = getFinalMirrorTransform(axis);

  return [
    {
      transform: startTransform,
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    },
    {
      transform: `${startTransform} translate(-16px, 3px) scale(0.82, 1.08) skew(-6deg, 0deg)`,
      filter: "brightness(1.6) contrast(2.1) saturate(0.35)",
      opacity: "0.78",
      offset: 0.22
    },
    {
      transform: `${startTransform} translate(20px, -4px) scale(1.16, 0.92) skew(7deg, 0deg)`,
      filter: "brightness(0.45) contrast(2.4) saturate(0.2)",
      opacity: "0.62",
      offset: 0.42
    },
    {
      transform: `${startTransform} translate(-8px, 2px) scale(0.9, 1.04) skew(-4deg, 0deg)`,
      filter: "brightness(1.9) contrast(2.2) saturate(1.4)",
      opacity: "0.9",
      offset: 0.62
    },
    {
      transform: "translate(8px, -3px) scale(1.06, 0.94) skew(4deg, 0deg)",
      filter: "brightness(1.45) contrast(1.8) saturate(0.7)",
      opacity: "0.94",
      offset: 0.78
    },
    {
      transform: "translate(-5px, 2px) scale(0.96, 1.04) skew(-3deg, 0deg)",
      filter: "brightness(0.75) contrast(1.55) saturate(0.8)",
      opacity: "0.9",
      offset: 0.88
    },
    {
      transform: "translate(0px, 0px) scale(1, 1) skew(0deg, 0deg)",
      filter: "brightness(1) contrast(1) saturate(1)",
      opacity: "1"
    }
  ];
}

function buildFoldKeyframes(axis) {
  return [
    {
      transform: getTransitionStartTransform(axis),
      filter: "brightness(1)",
      opacity: "1"
    },
    {
      transform: getFoldMidTransform(axis),
      filter: "brightness(0.84)",
      opacity: "0.98",
      offset: 0.5
    },
    {
      transform: getFoldEndTransform(axis),
      filter: "brightness(1.03)",
      opacity: "1"
    }
  ];
}

function buildFoldReturnKeyframes(axis) {
  return [
    {
      transform: getFinalMirrorTransform(axis),
      filter: "brightness(1.03)",
      opacity: "1"
    },
    {
      transform: getFoldReturnMidTransform(axis),
      filter: "brightness(0.84)",
      opacity: "0.98",
      offset: 0.5
    },
    {
      transform: getFoldReturnEndTransform(axis),
      filter: "brightness(1)",
      opacity: "1"
    }
  ];
}

function buildTransitionKeyframes(axis, transition) {
  if (transition === "realityRipple") {
    return buildRealityRippleKeyframes(axis);
  }

  if (transition === "glitchSnap") {
    return buildGlitchSnapKeyframes(axis);
  }

  return buildFoldKeyframes(axis);
}

function buildReturnTransitionKeyframes(axis, transition) {
  if (transition === "realityRipple") {
    return buildRealityRippleReturnKeyframes(axis);
  }

  if (transition === "glitchSnap") {
    return buildGlitchSnapReturnKeyframes(axis);
  }

  return buildFoldReturnKeyframes(axis);
}

function finishTransition(state) {
  /**
   * Large comment:
   * Finish a transition by cancelling animation ownership first, then applying
   * the final mirror as a plain inline CSS transform.
   *
   * This prevents Stop/Reset from being blocked by a fill-forwards animation and
   * keeps the final mirrored state represented only by normal inline styles.
   */
  if (!state?.transitioning) return;

  if (state.transitionTimer) {
    clearTimeout(state.transitionTimer);
    state.transitionTimer = null;
  }

  cancelTransitionAnimation(state);

  state.transitioning = false;

  applyCanvasCssMirror(state.canvasElement, state.axis);
}

function finishReturnTransition(runtime, state) {
  /**
   * Large comment:
   * Finish an Apply-triggered return-to-normal transition.
   *
   * Stop and Reset are immediate, but applying the same axis again should be a
   * visible cinematic toggle back to normal. At the end of that animation, clean
   * up through stopCanvasMirror so the pre-effect inline styles and focus state
   * are restored.
   */
  if (!state?.transitioning) return;

  clearTransitionState(state);
  stopCanvasMirror(runtime);
}

function runCanvasMirrorTransition(state) {
  /**
   * Large comment:
   * Run the transition animation directly on the live Foundry canvas element.
   *
   * Earlier versions used a temporary 2D canvas snapshot overlay. In WebGL
   * contexts this can produce a black image depending on browser and renderer
   * state. Animating the live canvas avoids the black-wipe failure mode and then
   * settles into the simple final scale transform used by interaction remapping.
   */
  const element = state?.canvasElement;
  if (!element) return;

  const transition = state.transition;
  const durationMs = state.transitionMs;

  if (transition === "instant" || durationMs <= 0) {
    applyCanvasCssMirror(element, state.axis);
    return;
  }

  state.transitioning = true;

  element.style.visibility = "";
  element.style.transformOrigin = "50% 50%";
  element.style.transform = "scale(1, 1)";
  element.style.willChange = "transform, filter, opacity";
  element.style.transformStyle = "preserve-3d";
  element.style.backfaceVisibility = "visible";
  element.dataset.fxbusCanvasMirror = "1";

  try {
    const animation = element.animate(
      buildTransitionKeyframes(state.axis, transition),
      {
        duration: durationMs,
        easing: "cubic-bezier(0.18, 0.85, 0.22, 1)",
        fill: "forwards"
      }
    );

    state.transitionAnimation = animation;

    animation.onfinish = () => {
      finishTransition(state);
    };

    animation.oncancel = () => {
      if (state.transitionAnimation === animation) {
        state.transitionAnimation = null;
      }
    };

    state.transitionTimer = setTimeout(() => {
      finishTransition(state);
    }, durationMs + 80);
  } catch (err) {
    console.warn("[FX Bus] Canvas Mirror: transition animation failed", err);
    state.transitioning = false;
    state.transitionAnimation = null;
    applyCanvasCssMirror(element, state.axis);
  }
}

function runCanvasMirrorReturnTransition(runtime, state) {
  /**
   * Large comment:
   * Run the Apply-triggered transition from the current mirrored state back to
   * normal.
   *
   * This is deliberately not used by Stop or Reset. Stop and Reset call
   * stopCanvasMirror directly and restore the canvas as quickly as possible.
   */
  const element = state?.canvasElement;
  if (!element) {
    stopCanvasMirror(runtime);
    return;
  }

  const transition = state.transition;
  const durationMs = state.transitionMs;

  if (transition === "instant" || durationMs <= 0) {
    stopCanvasMirror(runtime);
    return;
  }

  state.transitioning = true;

  element.style.visibility = "";
  element.style.transformOrigin = "50% 50%";
  element.style.transform = getFinalMirrorTransform(state.axis);
  element.style.willChange = "transform, filter, opacity";
  element.style.transformStyle = "preserve-3d";
  element.style.backfaceVisibility = "visible";
  element.dataset.fxbusCanvasMirror = "1";

  try {
    const animation = element.animate(
      buildReturnTransitionKeyframes(state.axis, transition),
      {
        duration: durationMs,
        easing: "cubic-bezier(0.18, 0.85, 0.22, 1)",
        fill: "forwards"
      }
    );

    state.transitionAnimation = animation;

    animation.onfinish = () => {
      finishReturnTransition(runtime, state);
    };

    animation.oncancel = () => {
      if (state.transitionAnimation === animation) {
        state.transitionAnimation = null;
      }
    };

    state.transitionTimer = setTimeout(() => {
      finishReturnTransition(runtime, state);
    }, durationMs + 80);
  } catch (err) {
    console.warn("[FX Bus] Canvas Mirror: return transition failed", err);
    stopCanvasMirror(runtime);
  }
}

function transitionCanvasMirrorToNormal(runtime, existingState, payload = {}) {
  /**
   * Large comment:
   * Toggle Canvas Mirror back to normal using the selected transition.
   *
   * This is deliberately different from Stop. Apply should feel theatrical even
   * when it returns the canvas to normal. Stop and Reset should restore the
   * canvas immediately with no animation.
   */
  const element = existingState?.canvasElement;
  if (!element) {
    stopCanvasMirror(runtime);
    return;
  }

  const transition = normaliseTransition(payload.transition);
  const transitionMs = normaliseTransitionMs(payload.transitionMs, transition);

  clearTransitionState(existingState);

  existingState.transition = transition;
  existingState.transitionMs = transitionMs;
  existingState.transitioning = false;
  existingState.transitionTimer = null;
  existingState.transitionAnimation = null;

  runCanvasMirrorReturnTransition(runtime, existingState);
}

function stopCanvasMirror(runtime) {
  const state = runtime?.screenFx?.get?.(EFFECT_KEY);
  if (!state) return;

  clearTransitionState(state);
  uninstallEventHandling(state);
  removeCanvasMirrorStyle();

  restoreCanvasElementStyle(state.canvasElement, state.styleSnapshot);
  restoreCanvasFocusState(state.canvasElement, state.focusSnapshot);

  runtime.screenFx.delete(EFFECT_KEY);
}

function startCanvasMirror(runtime, payload = {}) {
  const element = getCanvasElement();
  if (!element) return;

  const existingState = runtime?.screenFx?.get?.(EFFECT_KEY);
  const requestedAxis = normaliseAxis(payload.axis);

  if (existingState) {
    const toggledAxis = toggleAxis(existingState.axis, requestedAxis);

    if (toggledAxis === "normal") {
      transitionCanvasMirrorToNormal(runtime, existingState, payload);
      return;
    }

    payload = {
      ...payload,
      axis: toggledAxis
    };
  }

  stopCanvasMirror(runtime);

  const axis = normaliseAxis(payload.axis);
  const interactionMode = normaliseInteractionMode(payload.interactionMode);
  const transition = normaliseTransition(payload.transition);
  const transitionMs = normaliseTransitionMs(payload.transitionMs, transition);
  const styleSnapshot = snapshotCanvasElementStyle(element);
  const focusSnapshot = snapshotCanvasFocusState(element);

  const state = {
    axis,
    interactionMode,
    transition,
    transitionMs,
    canvasElement: element,
    styleSnapshot,
    focusSnapshot,
    abortController: new AbortController(),
    pointerSupported: Boolean(window.PointerEvent),
    dragging: false,
    hovering: false,
    activePointerId: null,
    suppressMouseUntil: 0,
    transitioning: false,
    transitionTimer: null,
    transitionAnimation: null,
    startedAt: performance.now()
  };

  runtime.screenFx.set(EFFECT_KEY, state);

  makeCanvasFocusable(element);
  focusCanvasElement(element);
  installCanvasMirrorStyle();

  if (interactionMode === "remap") {
    installRemapMode(state);
  } else if (interactionMode === "lock") {
    installLockMode(state);
  }

  runCanvasMirrorTransition(state);
}

export function registerCanvasMirrorFx(runtime) {
  /**
   * Large comment:
   * Register Canvas Mirror handlers.
   *
   * This effect intentionally lives outside experimentalFx.js. It uses CSS
   * mirroring on the rendered canvas element rather than PIXI stage mutation,
   * because Foundry owns canvas.app.stage for pan and zoom.
   */
  if (!runtime?.handlers) return;

  runtime.handlers.set(ACTION_START, (payload) => {
    startCanvasMirror(runtime, payload);
  });

  runtime.handlers.set(ACTION_STOP, () => {
    stopCanvasMirror(runtime);
  });
}