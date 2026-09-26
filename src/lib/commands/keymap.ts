/**
 * Keymap: one `window` keydown dispatcher for the command registry.
 *
 * Scope of this round (decided in the handoff): *registry matching only*. The
 * Blender `wmEventType` code table already exists, but user-overridable keymaps
 * and full modifier matching (keymap items, direction/value, repeat handling)
 * are a later task. What is here is the part menus need today: a displayed
 * `Ctrl+S` must actually fire.
 *
 * Behavior:
 *
 * - bindings are stored by **canonical chord** (`Mod+Shift+Z`), so a binding
 *   can be written `Ctrl+Shift+Z`, `cmd+z` or `MOD+Z` and all three match;
 * - the listener runs in the **bubble** phase (`capture: false`): a control
 *   that handles its own keys (CodeMirror's undo, an `<input>`) sees the event
 *   first and can `preventDefault()`/stop propagation;
 * - text entry targets are skipped outright (`isTextEntryTarget`), because
 *   those own their editing shortcuts — the check is shared with the workspace,
 *   not duplicated;
 * - a hit calls `preventDefault()` and `executeCommand(id)`, which itself
 *   re-checks `when` / `enabled`; a hit that does not run (disabled command)
 *   deliberately leaves the event alone so the browser default still works;
 * - `when` on the binding is an extra gate (e.g. "only while the workspace is
 *   open") and is evaluated *before* consuming the event.
 */
import { executeCommand, getCommand, type CommandId } from "./commands.js";
import { evaluatePredicate, type BooleanSource } from "../predicates.js";
import { eventToChord, normalizeChord, type ChordEventLike } from "./chord.js";

/** 一条快捷键绑定：和弦、命令 id、可选附加条件。 */
export interface KeyBinding {
  /** Chord in display form (`Ctrl+Z`, `Mod+K`, `Shift+F2`). */
  key: string | readonly string[];
  command: CommandId;
  /** Extra gate for this binding (independent of the command's own `when`). */
  when?: BooleanSource;
}

type RegisteredBinding = {
  command: CommandId;
  when: BooleanSource;
  token: symbol;
};

const bindings = new Map<string, RegisteredBinding>();

/**
 * True when the event target is a text-entry surface.
 *
 * `<input>` / `<textarea>` / `<select>` / `contenteditable` (which is what
 * CodeMirror 6 mounts) all have their own undo stack and their own idea of what
 * `Ctrl+Z`, `Ctrl+A` or a bare letter means. This is the **single** definition
 * of that predicate in the app (the workspace's `Ctrl+Z` handler uses it too),
 * so a new entry surface cannot be skipped by one of them and caught by the
 * other.
 *
 * Duck-typed (`tagName` / `isContentEditable`) rather than `instanceof
 * HTMLElement` so it is testable without a DOM shim and still true for elements
 * from another realm (iframe / embed shadow root).
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as { tagName?: unknown; isContentEditable?: unknown };
  if (element.isContentEditable === true) return true;
  const tag = typeof element.tagName === "string" ? element.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Validate the command id of a binding; throws `TypeError` when missing. */
function assertBindingCommand(binding: KeyBinding): void {
  if (typeof binding?.command !== "string" || binding.command.length === 0) {
    throw new TypeError("registerKeyBinding requires a command id");
  }
}

/**
 * Normalize every chord of a binding to its canonical form.
 *
 * Throws before anything is registered when one chord is unusable, so a
 * multi-chord binding either registers all of its chords or none of them.
 */
function normalizeBindingChords(key: string | readonly string[]): string[] {
  const chords = typeof key === "string" ? [key] : key;
  return chords.map((chord) => {
    const normalized = normalizeChord(chord);
    if (normalized === "") {
      throw new TypeError(`key binding ${JSON.stringify(chord)} is not a usable chord`);
    }
    return normalized;
  });
}

/** Register a key binding. Returns a disposer for *this* registration. */
export function registerKeyBinding(binding: KeyBinding): () => void {
  assertBindingCommand(binding);
  const chords = normalizeBindingChords(binding.key);
  const token = Symbol(binding.command);
  for (const chord of chords) {
    bindings.set(chord, { command: binding.command, when: binding.when, token });
  }
  return () => {
    for (const chord of chords) {
      if (bindings.get(chord)?.token !== token) continue;
      bindings.delete(chord);
    }
  };
}

/** Remove every binding that points at `command`. Returns how many were removed. */
export function unregisterKeyBindings(command: CommandId): number {
  let removed = 0;
  for (const [chord, binding] of bindings) {
    if (binding.command !== command) continue;
    // Deleting the current entry while iterating a Map is well-defined.
    bindings.delete(chord);
    removed += 1;
  }
  return removed;
}

/** Canonical chord of every registered binding (sorted; handy in tests/menus). */
export function listKeyBindings(): string[] {
  return [...bindings.keys()].sort();
}

/** The command a chord currently maps to, or `undefined`. */
export function commandForChord(chord: string): CommandId | undefined {
  return bindings.get(chord)?.command;
}

/**
 * Handle one keydown. Returns whether a binding was matched (and the event
 * consumed). Exported so tests can drive it without a DOM.
 */
export function handleKeydownEvent(
  event: ChordEventLike & { target?: EventTarget | null },
): boolean {
  if (isTextEntryTarget(event.target ?? null)) return false;
  const chord = eventToChord(event);
  if (chord === undefined) return false;
  const binding = bindings.get(chord);
  if (!binding) return false;
  if (!evaluatePredicate(binding.when, true, `key binding ${chord} when`)) return false;
  // A binding whose command is hidden/disabled must not swallow the key: the
  // command registry is the authority on availability.
  const command = getCommand(binding.command);
  if (!command) return false;
  if (!executeCommand(binding.command)) return false;
  return true;
}

/** Install the single `window` keydown listener. Returns a disposer. */
export function installKeymapDispatcher(
  target: Window | undefined = typeof window === "undefined" ? undefined : window,
): () => void {
  if (!target) return () => {};
  const listener = (event: KeyboardEvent) => {
    if (handleKeydownEvent(event)) event.preventDefault();
  };
  target.addEventListener("keydown", listener, { capture: false });
  return () => target.removeEventListener("keydown", listener, { capture: false });
}

/** Drop every binding (tests / teardown). */
export function clearKeyBindings(): void {
  bindings.clear();
}
