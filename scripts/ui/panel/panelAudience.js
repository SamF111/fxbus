// D:\FoundryVTT\Data\modules\fxbus\scripts\ui\panel\panelAudience.js

/**
 * FX Bus - GM Panel Audience Controls
 *
 * The empty selection is deliberately represented as "Everyone". This keeps
 * every existing panel action and generated macro backward compatible because
 * untargeted payloads continue to omit the audience field entirely.
 */

export const PANEL_AUDIENCE = Symbol("fxbus.panelAudience");

function userValues(gameRef = globalThis.game) {
  const users = gameRef?.users;

  if (Array.isArray(users?.contents)) return users.contents;
  if (typeof users?.values === "function") return Array.from(users.values());
  if (Array.isArray(users)) return users;

  try {
    return Array.from(users ?? []);
  } catch {
    return [];
  }
}

export function getAudienceUsers(gameRef = globalThis.game) {
  const currentUserId = String(gameRef?.user?.id ?? "");

  const users = userValues(gameRef)
    .filter((user) => {
      const id = String(user?.id ?? "").trim();
      return id.length > 0;
    })
    .map((user) => {
      const id = String(user.id);
      return {
        id,
        name: String(user.name ?? user.id),
        isGM: Boolean(user.isGM),
        isCurrentUser: id === currentUserId,
        active: user.active === true
      };
    });

  // Keep the local user at the end so the remote recipients remain the primary
  // choices, without disturbing the world's existing order for anyone else.
  return users.sort((left, right) =>
    Number(left.isCurrentUser) - Number(right.isCurrentUser));
}

export function formatAudienceUserLabel(user) {
  const name = String(user?.name ?? user?.id ?? "Unknown user");
  const identity = user?.isCurrentUser
    ? " (you)"
    : user?.isGM
      ? " [GM]"
      : "";
  const availability = user?.active === true ? "" : " (offline)";

  return `${name}${identity}${availability}`;
}

function selectedIds(app) {
  if (!(app?._audienceUserIds instanceof Set)) {
    app._audienceUserIds = new Set();
  }

  return Array.from(app._audienceUserIds);
}

function findUser(gameRef, userId) {
  const direct = gameRef?.users?.get?.(userId);
  if (direct) return direct;

  return userValues(gameRef).find((user) => String(user?.id ?? "") === userId) ?? null;
}

export function resolveConnectedPanelAudience(app, gameRef = globalThis.game) {
  const selectedUserIds = selectedIds(app);
  if (selectedUserIds.length === 0) {
    return {
      audience: undefined,
      unavailable: [],
      targeted: false
    };
  }

  const connectedUserIds = [];
  const unavailable = [];

  for (const userId of selectedUserIds) {
    const user = findUser(gameRef, userId);

    if (user?.active === true) {
      connectedUserIds.push(userId);
      continue;
    }

    unavailable.push({
      id: userId,
      name: String(user?.name ?? userId),
      missing: !user
    });
  }

  return {
    audience: connectedUserIds.length > 0
      ? { userIds: connectedUserIds }
      : undefined,
    unavailable,
    targeted: true
  };
}

function formatUnavailableAudienceWarning(resolution) {
  const names = resolution.unavailable.map((user) => user.name).join(", ");

  if (!resolution.audience?.userIds?.length) {
    return `No selected recipients are connected: ${names}. Nothing was sent.`;
  }

  const connectedCount = resolution.audience.userIds.length;
  const unavailableLabel = resolution.unavailable.length === 1
    ? "recipient"
    : "recipients";
  const connectedLabel = connectedCount === 1 ? "recipient" : "recipients";

  return `Skipped unavailable ${unavailableLabel}: ${names}. ` +
    `Sent to ${connectedCount} connected ${connectedLabel}.`;
}

export function getPanelAudience(app, gameRef = globalThis.game, options = {}) {
  const userIds = selectedIds(app);
  const requireConnected = options.requireConnected !== false;

  if (userIds.length === 0) return undefined;

  const missing = userIds.filter((userId) => !findUser(gameRef, userId));

  if (missing.length > 0) {
    throw new Error(
      `Selected recipient${missing.length === 1 ? " no longer exists" : "s no longer exist"}: ${missing.join(", ")}. Choose recipients again.`
    );
  }

  const unavailable = requireConnected
    ? userIds.filter((userId) => findUser(gameRef, userId)?.active !== true)
    : [];

  if (unavailable.length > 0) {
    const names = unavailable.map((userId) => {
      const user = findUser(gameRef, userId);
      return String(user?.name ?? userId);
    });

    throw new Error(
      `Selected recipient${names.length === 1 ? " is" : "s are"} no longer connected: ${names.join(", ")}. Choose recipients again.`
    );
  }

  return { userIds };
}

export function addAudienceToPayload(payload, audience) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("FX Bus panel payload must be an object.");
  }

  const { audience: _ignored, ...untargetedPayload } = payload;

  if (payload.action === "fx.bus.reset") return untargetedPayload;
  if (!audience?.userIds?.length) return untargetedPayload;

  return {
    ...untargetedPayload,
    audience: { userIds: Array.from(audience.userIds) }
  };
}

export function formatApplyAudienceLabel(audience, gameRef = globalThis.game) {
  const userIds = audience?.userIds ?? [];
  if (userIds.length === 0) return "Apply to Everyone";

  const names = userIds.map((userId) => {
    const user = findUser(gameRef, userId);
    return String(user?.name ?? userId);
  });

  if (names.length === 1) return `Apply to ${names[0]}`;
  if (names.length === 2) return `Apply to ${names[0]} + ${names[1]}`;

  return `Apply to ${names.length} users`;
}

export function createAudienceRuntime(runtime, app, options = {}) {
  if (!runtime || typeof runtime !== "object") return runtime;

  const notify = options.notify ?? ((message) => {
    globalThis.ui?.notifications?.warn?.(`FX Bus: ${message}`);
  });

  const emit = (payload) => {
    if (payload?.action === "fx.bus.reset") {
      return runtime.emit(addAudienceToPayload(payload, undefined));
    }

    const resolution = resolveConnectedPanelAudience(
      app,
      options.game ?? globalThis.game
    );

    if (resolution.targeted && !resolution.audience) {
      notify(formatUnavailableAudienceWarning(resolution));
      return undefined;
    }

    if (resolution.unavailable.length > 0) {
      notify(formatUnavailableAudienceWarning(resolution));
    }

    const audiencePayload = addAudienceToPayload(payload, resolution.audience);

    return runtime.emit(audiencePayload);
  };

  return new Proxy(runtime, {
    get(target, property) {
      if (property === "emit") return emit;
      if (property === PANEL_AUDIENCE) {
        return () => {
          return resolveConnectedPanelAudience(
            app,
            options.game ?? globalThis.game
          ).audience;
        };
      }
      return Reflect.get(target, property, target);
    }
  });
}

export function closeAudienceMenus(root, options = {}) {
  const openMenus = Array.from(root.querySelectorAll(".fxbus-audience-menu"))
    .filter((menu) => menu.hidden !== true);
  let focusTarget = null;

  if (options.restoreFocus === true && openMenus.length > 0) {
    const toggles = Array.from(root.querySelectorAll(".fxbus-audience-toggle"));
    focusTarget = toggles.find((toggle) =>
      openMenus.some((menu) => toggle.getAttribute("aria-controls") === menu.id)
    ) ?? null;
  }

  for (const menu of root.querySelectorAll(".fxbus-audience-menu")) {
    menu.hidden = true;
  }

  for (const toggle of root.querySelectorAll(".fxbus-audience-toggle")) {
    toggle.setAttribute("aria-expanded", "false");
  }

  focusTarget?.focus?.();
}

function audienceLabelForApp(app, gameRef) {
  const userIds = selectedIds(app);
  return formatApplyAudienceLabel({ userIds }, gameRef);
}

export function buildStopAllPayload(button) {
  const action = String(button?.dataset?.fxbusStopAllAction ?? "").trim();
  if (!action.startsWith("fx.") || !action.includes(".stop")) {
    throw new Error("FX Bus: invalid Stop All action.");
  }

  const payload = { action };
  const stopModeField = String(
    button?.dataset?.fxbusStopAllStopMode ?? ""
  ).trim();

  if (stopModeField) {
    const panel = button.closest?.(".fxbus-panel-section");
    const stopMode = String(
      panel?.querySelector?.(`[name="${stopModeField}"]`)?.value ?? ""
    ).trim();

    if (stopMode) payload.stopMode = stopMode;
  }

  return payload;
}

export function wireStopAllBroadcasts(
  root,
  runtime,
  signal
) {
  root?.addEventListener?.(
    "click",
    (event) => {
      const button = event.target?.closest?.(
        "button[data-fxbus-stop-all-action]"
      );
      if (!button) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      if (typeof runtime?.emit !== "function") {
        globalThis.ui?.notifications?.error?.(
          "FX Bus runtime not found. Enable fxbus and reload."
        );
        return;
      }

      try {
        // Use the raw runtime deliberately. Stop All is a global cleanup and
        // must never inherit the panel's selected audience.
        runtime.emit(buildStopAllPayload(button));
      } catch (error) {
        globalThis.ui?.notifications?.warn?.(
          error?.message ?? "FX Bus: Stop All failed."
        );
      }
    },
    { capture: true, signal }
  );
}

function refreshAudienceControls(app, root, gameRef) {
  const userIds = selectedIds(app);
  const isTargeted = userIds.length > 0;
  const applyLabel = audienceLabelForApp(app, gameRef);

  for (const wrapper of root.querySelectorAll(".fxbus-apply-split")) {
    wrapper.classList.toggle("fxbus-targeted", isTargeted);
    const apply = wrapper.querySelector("[data-fxbus-audience-apply]");
    if (apply) apply.textContent = applyLabel;
  }

  for (const wrapper of root.querySelectorAll(".fxbus-stop-split")) {
    wrapper.classList.toggle("fxbus-targeted", isTargeted);
  }

  for (const menu of root.querySelectorAll(".fxbus-audience-menu")) {
    const everyone = menu.querySelector('input[data-fxbus-audience="everyone"]');
    if (everyone) everyone.checked = !isTargeted;

    for (const checkbox of menu.querySelectorAll('input[data-fxbus-audience="user"]')) {
      checkbox.checked = app._audienceUserIds.has(String(checkbox.value));
    }
  }

  for (const stop of root.querySelectorAll("[data-fxbus-audience-stop]")) {
    const original = stop.dataset.fxbusAudienceOriginalLabel || "Stop";
    if (stop.dataset.fxbusStopAllAction) {
      stop.textContent = original;
      continue;
    }

    stop.textContent = isTargeted
      ? `${original} for ${applyLabel.replace(/^Apply to /, "")}`
      : original;
  }

  for (const copy of root.querySelectorAll('[data-action="fxbusCopyToMacro"]')) {
    copy.title = isTargeted
      ? `Copy a macro targeting ${applyLabel.replace(/^Apply to /, "")}`
      : "Copy a macro targeting everyone";
  }
}

function populateAudienceUsers(app, menu, documentRef, users, refresh) {
  const container = menu.querySelector("[data-fxbus-audience-users]");
  if (!container) return;

  container.replaceChildren();

  if (users.length > 0) {
    const divider = documentRef.createElement("div");
    divider.className = "fxbus-audience-divider";
    container.append(divider);
  }

  for (const user of users) {
    const label = documentRef.createElement("label");
    label.className = "fxbus-audience-option";
    label.classList.toggle("fxbus-audience-option-offline", !user.active);
    if (!user.active) {
      label.title = "Offline — retained for macros; live actions will skip this user";
    }
    const checkbox = documentRef.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = user.id;
    checkbox.dataset.fxbusAudience = "user";
    checkbox.checked = app._audienceUserIds.has(user.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) app._audienceUserIds.add(String(checkbox.value));
      else app._audienceUserIds.delete(String(checkbox.value));
      refresh();
    });
    label.append(
      checkbox,
      documentRef.createTextNode(formatAudienceUserLabel(user))
    );
    container.append(label);
  }

  if (users.length === 0) {
    const empty = documentRef.createElement("div");
    empty.className = "fxbus-audience-empty";
    empty.textContent = "No world users";
    container.append(empty);
  }
}

function buildAudienceMenu(
  app,
  documentRef,
  users,
  refresh,
  menuId,
  headingText = "Apply effect to"
) {
  const menu = documentRef.createElement("div");
  menu.className = "fxbus-audience-menu";
  menu.id = menuId;
  menu.hidden = true;
  menu.setAttribute("role", "dialog");

  const heading = documentRef.createElement("div");
  heading.className = "fxbus-audience-heading";
  heading.id = `${menuId}-heading`;
  heading.textContent = headingText;
  menu.setAttribute("aria-labelledby", heading.id);
  menu.append(heading);

  const everyoneLabel = documentRef.createElement("label");
  everyoneLabel.className = "fxbus-audience-option";
  const everyone = documentRef.createElement("input");
  everyone.type = "checkbox";
  everyone.dataset.fxbusAudience = "everyone";
  everyoneLabel.append(everyone, documentRef.createTextNode("Everyone"));
  menu.append(everyoneLabel);

  const usersContainer = documentRef.createElement("div");
  usersContainer.dataset.fxbusAudienceUsers = "1";
  menu.append(usersContainer);

  everyone.addEventListener("change", () => {
    app._audienceUserIds.clear();
    refresh();
  });

  populateAudienceUsers(app, menu, documentRef, users, refresh);
  menu.addEventListener("click", (event) => event.stopPropagation());
  return menu;
}

export function wireAudienceRosterRefresh(refresh, signal, hooksRef = globalThis.Hooks) {
  if (typeof refresh !== "function" || !hooksRef?.on || !hooksRef?.off) return [];

  const hookNames = ["userConnected", "updateUser", "createUser", "deleteUser"];
  const registrations = hookNames.map((hookName) => ({
    hookName,
    hookId: hooksRef.on(hookName, refresh)
  }));

  signal?.addEventListener?.("abort", () => {
    for (const { hookName, hookId } of registrations) {
      hooksRef.off(hookName, hookId);
    }
  }, { once: true });

  return registrations;
}

export function wireAudienceControls(
  app,
  root,
  signal,
  gameRef = globalThis.game,
  runtime = globalThis.fxbus
) {
  const documentRef = root.ownerDocument ?? globalThis.document;
  const users = getAudienceUsers(gameRef);

  if (!(app._audienceUserIds instanceof Set)) app._audienceUserIds = new Set();

  const refresh = (rebuildUsers = false) => {
    if (rebuildUsers) {
      const latestUsers = getAudienceUsers(gameRef);
      for (const menu of root.querySelectorAll(".fxbus-audience-menu")) {
        populateAudienceUsers(app, menu, documentRef, latestUsers, refresh);
      }
    }

    refreshAudienceControls(app, root, gameRef);
  };

  for (const section of root.querySelectorAll('.fxbus-panel-section:not([data-category="reset"])')) {
    const buttons = Array.from(section.querySelectorAll(".fxbus-row button"));
    const apply = buttons.find((button) => ["Apply", "Start"].includes(button.textContent.trim()));
    if (!apply || apply.closest(".fxbus-apply-split")) continue;

    apply.dataset.fxbusAudienceApply = "1";
    apply.setAttribute("aria-live", "polite");

    const wrapper = documentRef.createElement("span");
    wrapper.className = "fxbus-apply-split";
    apply.parentNode.insertBefore(wrapper, apply);
    wrapper.append(apply);

    const toggle = documentRef.createElement("button");
    toggle.type = "button";
    toggle.className = "fxbus-audience-toggle";
    toggle.title = "Choose recipients";
    toggle.setAttribute("aria-label", "Choose FX recipients");
    toggle.setAttribute("aria-haspopup", "dialog");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i>';

    const categoryId = String(section.dataset.category ?? "effect");
    const tabId = String(section.dataset.tab ?? "panel");
    const menuId = `fxbus-audience-${categoryId}-${tabId}`;
    toggle.setAttribute("aria-controls", menuId);

    const menu = buildAudienceMenu(app, documentRef, users, refresh, menuId);
    wrapper.append(toggle, menu);

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = menu.hidden;
      for (const macroMenu of root.querySelectorAll(".fxbus-macro-menu")) {
        macroMenu.hidden = true;
      }
      for (const macroToggle of root.querySelectorAll(".fxbus-macro-toggle")) {
        macroToggle.setAttribute("aria-expanded", "false");
      }
      closeAudienceMenus(root);
      menu.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) menu.querySelector("input")?.focus?.();
    }, { signal });

    const stop = buttons.find((button) => button.textContent.trim() === "Stop");
    if (!stop || stop.closest(".fxbus-stop-split")) continue;

    stop.dataset.fxbusAudienceStop = "1";
    stop.dataset.fxbusAudienceOriginalLabel = "Stop";
    stop.setAttribute("aria-live", "polite");

    const stopWrapper = documentRef.createElement("span");
    stopWrapper.className = "fxbus-stop-split";
    stop.parentNode.insertBefore(stopWrapper, stop);
    stopWrapper.append(stop);

    const stopToggle = documentRef.createElement("button");
    stopToggle.type = "button";
    stopToggle.className = "fxbus-audience-toggle";
    stopToggle.title = "Choose recipients for Stop";
    stopToggle.setAttribute("aria-label", "Choose FX Stop recipients");
    stopToggle.setAttribute("aria-haspopup", "dialog");
    stopToggle.setAttribute("aria-expanded", "false");
    stopToggle.innerHTML = '<i class="fas fa-chevron-down" aria-hidden="true"></i>';

    const stopMenuId = `fxbus-stop-audience-${categoryId}-${tabId}`;
    stopToggle.setAttribute("aria-controls", stopMenuId);

    const stopMenu = buildAudienceMenu(
      app,
      documentRef,
      users,
      refresh,
      stopMenuId,
      "Stop effect for"
    );
    stopWrapper.append(stopToggle, stopMenu);

    stopToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const open = stopMenu.hidden;
      for (const macroMenu of root.querySelectorAll(".fxbus-macro-menu")) {
        macroMenu.hidden = true;
      }
      for (const macroToggle of root.querySelectorAll(".fxbus-macro-toggle")) {
        macroToggle.setAttribute("aria-expanded", "false");
      }
      closeAudienceMenus(root);
      stopMenu.hidden = !open;
      stopToggle.setAttribute("aria-expanded", String(open));
      if (open) stopMenu.querySelector("input")?.focus?.();
    }, { signal });
  }

  for (const button of root.querySelectorAll(".fxbus-row button")) {
    if (!button.textContent.trim().startsWith("Stop")) continue;
    button.dataset.fxbusAudienceStop = "1";
    button.dataset.fxbusAudienceOriginalLabel = button.textContent.trim();
  }

  wireStopAllBroadcasts(root, runtime, signal);

  documentRef.addEventListener("click", () => closeAudienceMenus(root), { signal });
  documentRef.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    const hasOpenMenu = Array.from(root.querySelectorAll(".fxbus-audience-menu"))
      .some((menu) => menu.hidden !== true);
    if (!hasOpenMenu) return;

    event.preventDefault();
    event.stopPropagation();
    closeAudienceMenus(root, { restoreFocus: true });
  }, { signal });

  wireAudienceRosterRefresh(() => refresh(true), signal);

  refresh();
}
