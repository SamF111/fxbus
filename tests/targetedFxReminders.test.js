import { jest } from "@jest/globals";
import { observeTargetedFxMessage } from "../scripts/targetedFxLedger.js";
import {
  buildTargetedFxReminder,
  buildTargetedFxReminderContent,
  clearTargetedFxReminderIfInactive,
  restartTargetedFxReminders,
  startTargetedFxReminders,
  stopTargetedFxReminders
} from "../scripts/targetedFxReminders.js";

function installEnvironment() {
  globalThis.game = {
    user: { id: "gm", name: "GM", isGM: true },
    users: {
      get: jest.fn((id) => new Map([
        ["player-a", { id: "player-a", name: "Alice" }],
        ["player-b", { id: "player-b", name: "Bob" }]
      ]).get(id) ?? null)
    },
    messages: { contents: [] }
  };
  globalThis.ui = {
    notifications: {
      info: jest.fn()
    }
  };
  globalThis.ChatMessage = {
    create: jest.fn().mockResolvedValue({})
  };
}

function targeted(action, userIds, extra = {}) {
  return {
    action,
    audience: { userIds },
    ...extra
  };
}

describe("targeted FX reminders", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(100_000);
    installEnvironment();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.game;
    delete globalThis.ui;
    delete globalThis.ChatMessage;
  });

  test("builds a readable GM summary grouped by effect and user", () => {
    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.tileFlow.start", ["player-a"], {
        tileIds: ["tile-1", "tile-2"],
        durationMs: 0
      }),
      40_000
    );
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["player-b"], {
        durationMs: 120_000
      }),
      70_000
    );

    expect(buildTargetedFxReminder(runtime, 100_000)).toBe(
      "Targeted FX reminder: Screen Blur → Bob (active 30s, 1m 30s remaining); " +
      "Tile Flow → Alice (active 1m 0s, until stopped, 2 targets)."
    );
  });

  test("returns no message when there are no active targeted effects", () => {
    expect(buildTargetedFxReminder({})).toBeNull();
    expect(buildTargetedFxReminderContent({})).toBeNull();
  });

  test("builds an escaped stacked reminder card for chat", () => {
    game.users.get.mockImplementation((id) => new Map([
      ["player-a", { id: "player-a", name: "Alice <script>" }],
      ["player-b", { id: "player-b", name: "Bob" }]
    ]).get(id) ?? null);

    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.tileFlow.start", ["player-a"], {
        tileIds: ["tile-1", "tile-2"],
        durationMs: 0
      }),
      40_000
    );
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["player-b"], {
        durationMs: 120_000
      }),
      70_000
    );

    const content = buildTargetedFxReminderContent(runtime, 100_000);

    expect(content).toContain('class="fxbus-targeted-reminder"');
    expect(content).toContain('class="fxbus-reminder-count">2 active</span>');
    expect(content).toContain('class="fxbus-reminder-effect-name">Screen Blur</div>');
    expect(content).toContain("Bob · Active for 30s · 1m 30s remaining");
    expect(content).toContain('class="fxbus-reminder-effect-name">Tile Flow</div>');
    expect(content).toContain("Alice &lt;script&gt; · Active for 1m 0s · Until stopped · 2 targets");
    expect(content).not.toContain("<script>");
  });

  test("periodically whispers only to the current GM while targeted effects are active", () => {
    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 }),
      100_000
    );

    expect(startTargetedFxReminders(runtime, { intervalMs: 10_000 })).toBe(true);
    expect(ChatMessage.create).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10_000);
    expect(ChatMessage.create).toHaveBeenCalledWith({
      content: expect.stringContaining(
        "Alice · Active for 10s · Until stopped"
      ),
      flags: {
        fxbus: {
          targetedFxReminder: { recipientUserId: "gm" }
        }
      },
      speaker: { alias: "FX Bus" },
      whisper: ["gm"]
    });
    expect(ui.notifications.info).not.toHaveBeenCalled();

    observeTargetedFxMessage(runtime, { action: "fx.screenBlur.stop" });
    jest.advanceTimersByTime(10_000);
    expect(ChatMessage.create).toHaveBeenCalledTimes(1);

    stopTargetedFxReminders(runtime);
    expect(runtime.__targetedFxReminderTimer).toBeUndefined();
  });

  test("falls back to an in-app notification when private chat is unavailable", () => {
    delete globalThis.ChatMessage;
    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 }),
      100_000
    );

    startTargetedFxReminders(runtime, { intervalMs: 10_000 });
    jest.advanceTimersByTime(10_000);

    expect(ui.notifications.info).toHaveBeenCalledWith(
      "Targeted FX reminder: Screen Blur → Alice (active 10s, until stopped).",
      { permanent: false }
    );
  });

  test("deletes only outdated FX Bus reminders for the current GM", async () => {
    const oldFlagged = {
      id: "old-flagged",
      flags: {
        fxbus: {
          targetedFxReminder: { recipientUserId: "gm" }
        }
      },
      whisper: ["gm"],
      delete: jest.fn().mockResolvedValue(undefined)
    };
    const oldLegacy = {
      id: "old-legacy",
      content: "Targeted FX reminder: legacy message.",
      speaker: { alias: "FX Bus" },
      whisper: ["gm"],
      delete: jest.fn().mockResolvedValue(undefined)
    };
    const anotherGm = {
      id: "another-gm",
      flags: {
        fxbus: {
          targetedFxReminder: { recipientUserId: "gm-2" }
        }
      },
      whisper: ["gm-2"],
      delete: jest.fn().mockResolvedValue(undefined)
    };
    const unrelated = {
      id: "unrelated",
      content: "A normal chat message.",
      speaker: { alias: "FX Bus" },
      whisper: ["gm"],
      delete: jest.fn().mockResolvedValue(undefined)
    };
    game.messages.contents = [oldFlagged, oldLegacy, anotherGm, unrelated];
    ChatMessage.create.mockResolvedValue({ id: "latest" });

    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 }),
      100_000
    );
    startTargetedFxReminders(runtime, { intervalMs: 10_000 });

    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(oldFlagged.delete).toHaveBeenCalledTimes(1);
    expect(oldLegacy.delete).toHaveBeenCalledTimes(1);
    expect(anotherGm.delete).not.toHaveBeenCalled();
    expect(unrelated.delete).not.toHaveBeenCalled();
  });

  test.each([
    ["the final effect stops", { action: "fx.screenBlur.stop" }],
    ["global reset runs", { action: "fx.bus.reset" }]
  ])("deletes the last reminder immediately when %s", async (_label, lifecycle) => {
    const reminder = {
      id: "current-reminder",
      flags: {
        fxbus: {
          targetedFxReminder: { recipientUserId: "gm" }
        }
      },
      whisper: ["gm"],
      delete: jest.fn().mockResolvedValue(undefined)
    };
    game.messages.contents = [reminder];

    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.screenBlur.start", ["player-a"], { durationMs: 0 }),
      100_000
    );
    observeTargetedFxMessage(runtime, lifecycle, 101_000);

    await expect(clearTargetedFxReminderIfInactive(runtime)).resolves.toBe(true);
    expect(reminder.delete).toHaveBeenCalledTimes(1);
  });

  test("periodic cleanup removes a stale card when the ledger is already empty", async () => {
    const reminder = {
      id: "stale-reminder",
      flags: {
        fxbus: {
          targetedFxReminder: { recipientUserId: "gm" }
        }
      },
      whisper: ["gm"],
      delete: jest.fn().mockResolvedValue(undefined)
    };
    game.messages.contents = [reminder];

    startTargetedFxReminders({}, { intervalMs: 10_000 });
    jest.advanceTimersByTime(10_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(ChatMessage.create).not.toHaveBeenCalled();
    expect(reminder.delete).toHaveBeenCalledTimes(1);
  });

  test("restart replaces the previous timer and zero disables reminders", () => {
    const runtime = {};

    restartTargetedFxReminders(runtime, 30);
    expect(jest.getTimerCount()).toBe(1);
    expect(runtime.__targetedFxReminderIntervalMs).toBe(30_000);

    restartTargetedFxReminders(runtime, 15);
    expect(jest.getTimerCount()).toBe(1);
    expect(runtime.__targetedFxReminderIntervalMs).toBe(15_000);

    expect(restartTargetedFxReminders(runtime, 0)).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("does not start reminders for non-GM users", () => {
    const runtime = {};

    expect(startTargetedFxReminders(runtime, { intervalMs: 10_000 })).toBe(true);
    game.user.isGM = false;

    expect(startTargetedFxReminders(runtime, { intervalMs: 10_000 })).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("falls back to a user id when the user no longer exists", () => {
    const runtime = {};
    observeTargetedFxMessage(
      runtime,
      targeted("fx.noise.start", ["missing-user"], { durationMs: 0 }),
      100_000
    );

    expect(buildTargetedFxReminder(runtime, 105_000)).toContain(
      "Screen Noise → missing-user (active 5s, until stopped)"
    );
  });
});
