import { beforeEach, describe, expect, test } from "bun:test";

import {
  clearCommands,
  commandEnabled,
  commandVisible,
  executeCommand,
  getCommand,
  listCommands,
  registerCommand,
  resolveCommandLabel,
  unregisterCommand,
} from "../src/lib/commands";
import {
  clearKeyBindings,
  commandForChord,
  handleKeydownEvent,
  isTextEntryTarget,
  listKeyBindings,
  registerKeyBinding,
  unregisterKeyBindings,
} from "../src/lib/commands/keymap";
import { eventToChord, normalizeChord } from "../src/lib/commands/chord";

let ran: string[] = [];

function spyCommand(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    run: () => {
      ran.push(id);
    },
    ...extra,
  };
}

beforeEach(() => {
  clearCommands();
  clearKeyBindings();
  ran = [];
});

describe("command registry", () => {
  test("registers, reads and lists commands sorted by id", () => {
    registerCommand(spyCommand("gpen.undo"));
    registerCommand(spyCommand("gpen.save"));
    expect(getCommand("gpen.save")?.id).toBe("gpen.save");
    expect(listCommands().map((command) => command.id)).toEqual(["gpen.save", "gpen.undo"]);
  });

  test("rejects commands without an id or a run function", () => {
    expect(() => registerCommand({ id: "", label: "x", run: () => {} })).toThrow(TypeError);
    // @ts-expect-error deliberately malformed for the guard
    expect(() => registerCommand({ id: "a.b", label: "x" })).toThrow(TypeError);
  });

  test("a later registration overrides an earlier one for the same id", () => {
    registerCommand(spyCommand("gpen.save", { label: "旧" }));
    registerCommand(spyCommand("gpen.save", { label: "新" }));
    expect(listCommands()).toHaveLength(1);
    expect(resolveCommandLabel(getCommand("gpen.save")!)).toBe("新");
  });

  test("a stale disposer cannot unregister the live registration", () => {
    const disposeOld = registerCommand(spyCommand("gpen.save", { label: "旧" }));
    registerCommand(spyCommand("gpen.save", { label: "新" }));
    disposeOld();
    // The newer registration must survive the older instance's teardown (HMR /
    // repeated embed mounts re-register before the previous disposer runs).
    expect(resolveCommandLabel(getCommand("gpen.save")!)).toBe("新");
    expect(unregisterCommand("gpen.save")).toBe(true);
    expect(getCommand("gpen.save")).toBeUndefined();
    expect(unregisterCommand("gpen.save")).toBe(false);
  });

  test("executeCommand runs the command and returns true", () => {
    registerCommand(spyCommand("gpen.save"));
    expect(executeCommand("gpen.save")).toBe(true);
    expect(ran).toEqual(["gpen.save"]);
  });

  test("executeCommand refuses unknown, hidden and disabled commands", () => {
    registerCommand(spyCommand("gpen.hidden", { when: false }));
    registerCommand(spyCommand("gpen.disabled", { enabled: false }));

    expect(executeCommand("gpen.nope")).toBe(false);
    expect(executeCommand("gpen.hidden")).toBe(false);
    expect(executeCommand("gpen.disabled")).toBe(false);
    expect(ran).toEqual([]);

    // `when: false` is "does not exist" (hidden); `enabled: false` is "shown but grey".
    expect(commandVisible(getCommand("gpen.hidden"))).toBe(false);
    expect(commandVisible(getCommand("gpen.disabled"))).toBe(true);
    expect(commandEnabled(getCommand("gpen.disabled"))).toBe(false);
  });

  test("a throwing predicate degrades to false instead of breaking the menu", () => {
    const boom = () => {
      throw new Error("predicate exploded");
    };
    registerCommand(spyCommand("gpen.boom.when", { when: boom }));
    registerCommand(spyCommand("gpen.boom.enabled", { enabled: boom }));

    expect(commandVisible(getCommand("gpen.boom.when"))).toBe(false);
    expect(commandEnabled(getCommand("gpen.boom.enabled"))).toBe(false);
    expect(executeCommand("gpen.boom.when")).toBe(false);
    expect(executeCommand("gpen.boom.enabled")).toBe(false);
    // Other commands still work: one bad predicate does not poison the registry.
    registerCommand(spyCommand("gpen.ok"));
    expect(executeCommand("gpen.ok")).toBe(true);
  });

  test("a throwing run() is reported, not propagated, and returns false", () => {
    registerCommand({
      id: "gpen.throw",
      label: "throw",
      run: () => {
        throw new Error("run exploded");
      },
    });
    expect(executeCommand("gpen.throw")).toBe(false);
  });

  test("an async run() rejection is swallowed", async () => {
    let settled = false;
    registerCommand({
      id: "gpen.async",
      label: "async",
      run: async () => {
        throw new Error("async exploded");
      },
    });
    expect(executeCommand("gpen.async")).toBe(true);
    await Promise.resolve();
    settled = true;
    expect(settled).toBe(true);
  });

  test("resolves getter labels and defaults a missing label to the id", () => {
    registerCommand(spyCommand("gpen.dyn", { label: () => "动态" }));
    expect(resolveCommandLabel(getCommand("gpen.dyn")!)).toBe("动态");
  });
});

describe("chord normalization", () => {
  test("merges Ctrl / Cmd / Meta into Mod and fixes modifier order", () => {
    expect(normalizeChord("Ctrl+Z")).toBe("Mod+z");
    expect(normalizeChord("cmd+z")).toBe("Mod+z");
    expect(normalizeChord("Meta+Z")).toBe("Mod+z");
    expect(normalizeChord("Shift+Ctrl+Alt+K")).toBe("Mod+Alt+Shift+k");
  });

  test("accepts modifier aliases and key spellings", () => {
    expect(normalizeChord("Option+Up")).toBe("Alt+ArrowUp");
    expect(normalizeChord("Esc")).toBe("Escape");
    expect(normalizeChord("Space")).toBe("Space");
    expect(normalizeChord("F2")).toBe("F2");
    // `+` / `-` must be spelled out: a literal `+` would be indistinguishable
    // from the separator (`"Ctrl++"` is a trailing separator, i.e. no key).
    expect(normalizeChord("Ctrl+Plus")).toBe("Mod+plus");
    expect(normalizeChord("Ctrl+minus")).toBe("Mod+minus");
    expect(normalizeChord("Ctrl++")).toBe("");
  });

  test("rejects chords without a real key", () => {
    expect(normalizeChord("Ctrl")).toBe("");
    expect(normalizeChord("Shift+")).toBe("");
    expect(normalizeChord("")).toBe("");
  });

  test("normalizes a live event to the same chord as its binding", () => {
    expect(eventToChord({ key: "Z", ctrlKey: true, shiftKey: true })).toBe("Mod+Shift+z");
    expect(eventToChord({ key: "z", metaKey: true })).toBe("Mod+z");
    expect(eventToChord({ key: "F2" })).toBe("F2");
    // A bare modifier is not a chord.
    expect(eventToChord({ key: "Shift", shiftKey: true })).toBeUndefined();
  });
});

describe("keymap dispatcher", () => {
  test("matches a registered binding and runs its command", () => {
    registerCommand(spyCommand("gpen.undo"));
    registerKeyBinding({ key: "Ctrl+Z", command: "gpen.undo" });
    expect(listKeyBindings()).toEqual(["Mod+z"]);
    expect(commandForChord("Mod+z")).toBe("gpen.undo");

    expect(handleKeydownEvent({ key: "z", ctrlKey: true })).toBe(true);
    expect(ran).toEqual(["gpen.undo"]);
    // Unrelated keys are untouched.
    expect(handleKeydownEvent({ key: "q" })).toBe(false);
  });

  test("accepts several chords for one command", () => {
    registerCommand(spyCommand("gpen.redo"));
    registerKeyBinding({ key: ["Ctrl+Shift+Z", "Ctrl+Y"], command: "gpen.redo" });
    expect(listKeyBindings()).toEqual(["Mod+Shift+z", "Mod+y"]);
    expect(handleKeydownEvent({ key: "y", ctrlKey: true })).toBe(true);
    expect(handleKeydownEvent({ key: "Z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(ran).toEqual(["gpen.redo", "gpen.redo"]);
  });

  test("a binding whose command is disabled does not swallow the key", () => {
    registerCommand(spyCommand("gpen.undo", { enabled: () => false }));
    registerKeyBinding({ key: "Ctrl+Z", command: "gpen.undo" });
    expect(handleKeydownEvent({ key: "z", ctrlKey: true })).toBe(false);
    expect(ran).toEqual([]);
  });

  test("the binding-level `when` gates the binding independently", () => {
    registerCommand(spyCommand("gpen.save"));
    let workspaceOpen = false;
    registerKeyBinding({ key: "Ctrl+S", command: "gpen.save", when: () => workspaceOpen });
    expect(handleKeydownEvent({ key: "s", ctrlKey: true })).toBe(false);
    workspaceOpen = true;
    expect(handleKeydownEvent({ key: "s", ctrlKey: true })).toBe(true);
    expect(ran).toEqual(["gpen.save"]);
  });

  test("skips text entry targets so the control keeps its own shortcuts", () => {
    registerCommand(spyCommand("gpen.undo"));
    registerKeyBinding({ key: "Ctrl+Z", command: "gpen.undo" });
    const input = { tagName: "INPUT", isContentEditable: false } as unknown as HTMLElement;
    expect(isTextEntryTarget(input)).toBe(true);
    expect(handleKeydownEvent({ key: "z", ctrlKey: true, target: input })).toBe(false);
    expect(ran).toEqual([]);
  });

  test("re-registering a chord overrides it and a stale disposer is a no-op", () => {
    registerCommand(spyCommand("gpen.undo"));
    registerCommand(spyCommand("gpen.redo"));
    const disposeOld = registerKeyBinding({ key: "Ctrl+Z", command: "gpen.undo" });
    registerKeyBinding({ key: "Ctrl+Z", command: "gpen.redo" });
    disposeOld();
    expect(commandForChord("Mod+z")).toBe("gpen.redo");
    expect(handleKeydownEvent({ key: "z", ctrlKey: true })).toBe(true);
    expect(ran).toEqual(["gpen.redo"]);
  });

  test("unregisterKeyBindings removes every chord of a command", () => {
    registerCommand(spyCommand("gpen.redo"));
    registerKeyBinding({ key: ["Ctrl+Shift+Z", "Ctrl+Y"], command: "gpen.redo" });
    expect(unregisterKeyBindings("gpen.redo")).toBe(2);
    expect(listKeyBindings()).toEqual([]);
    expect(unregisterKeyBindings("gpen.redo")).toBe(0);
  });

  test("rejects an unusable chord instead of silently registering nothing", () => {
    expect(() => registerKeyBinding({ key: "Ctrl", command: "gpen.undo" })).toThrow(TypeError);
    expect(() => registerKeyBinding({ key: "", command: "gpen.undo" })).toThrow(TypeError);
  });
});
