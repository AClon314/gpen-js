/**
 * Command registry: the single id space shared by the menu bar, the keymap,
 * (later) the command palette, and the settings panel.
 *
 * Design notes, and why the obvious alternatives were rejected:
 *
 * - **One registry, two consumers.** Menus are a *tree* whose nodes *reference*
 *   a command id (`menuModel.ts` stays a pure model and never executes
 *   anything); the keymap maps a chord to the same id. A command owns the
 *   action, its label and its availability, so the menu and the shortcut can
 *   never disagree about whether something is runnable.
 * - **Ids are dotted and equal the protocol's `ToolReference.idname`**
 *   (`gpen.save`, `builtin.draw`, `addon.<vendor>.<op>`): zero conversion when
 *   a binding is persisted.
 * - **Last registration wins, with a token-specific disposer.** The registry is
 *   a `Map<id, {command, token}>`; re-registering replaces the entry and the
 *   old disposer becomes a no-op. That is what makes HMR and repeated embed
 *   mounts safe (the same trick `registerMenuItems` uses). A disposer that just
 *   deleted by id would let a stale instance tear down the live command.
 * - **`when` vs `enabled`.** `when === false` means "does not exist right now"
 *   (hidden); `enabled === false` means "exists but cannot run" (greyed out).
 *   `executeCommand` refuses both. A throwing predicate degrades to `false`
 *   (see `predicates.ts`) instead of breaking the whole menu.
 *
 * The keymap half lives in `commands/keymap.ts`; the DOM-free matcher it uses
 * is `commands/chord.ts`. This file has no Svelte and no DOM so it can be unit
 * tested directly.
 */
import { evaluatePredicate, type BooleanSource } from "./predicates.js";

/** 命令 id（点分，与协议 `ToolReference.idname` 一致）。 */
export type CommandId = string;

/** 一条命令：id、标签、动作与可见性 / 可用性谓词。 */
export interface Command {
  id: CommandId;
  label: string | (() => string);
  run: () => void | Promise<void>;
  /** Display-only shortcut hint (e.g. `Ctrl+Z`); matching happens in the keymap. */
  keyBind?: string | readonly string[];
  /** Visibility predicate; `false` hides the command from menus. */
  when?: BooleanSource;
  /** Availability predicate; `false` shows the command greyed out. */
  enabled?: BooleanSource;
}

type RegisteredCommand = {
  command: Command;
  token: symbol;
};

const registry = new Map<CommandId, RegisteredCommand>();

/** Register (or replace) a command. Returns a disposer for *this* registration. */
export function registerCommand(command: Command): () => void {
  if (!command || typeof command.id !== "string" || command.id.length === 0) {
    throw new TypeError("registerCommand requires a non-empty string id");
  }
  if (typeof command.run !== "function") {
    throw new TypeError(`command ${command.id} must have a run() function`);
  }
  const token = Symbol(command.id);
  registry.set(command.id, { command, token });
  return () => {
    // Only the registration that is still current may remove itself: an older
    // instance disposed after a newer one took over must not unregister it.
    if (registry.get(command.id)?.token !== token) return;
    registry.delete(command.id);
  };
}

/** Remove a command by id. Returns whether something was removed. */
export function unregisterCommand(id: CommandId): boolean {
  return registry.delete(id);
}

/** 按 id 取已注册命令。 */
export function getCommand(id: CommandId): Command | undefined {
  return registry.get(id)?.command;
}

/** All registered commands, sorted by id (stable for menus and tests). */
export function listCommands(): Command[] {
  return [...registry.values()]
    .map((entry) => entry.command)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** 求值命令标签（函数形式会被调用）。 */
export function resolveCommandLabel(command: Command): string {
  return typeof command.label === "function" ? command.label() : command.label;
}

/** `when` (visibility): a missing predicate means "always visible". */
export function commandVisible(command: Command | undefined): boolean {
  if (!command) return false;
  return evaluatePredicate(command.when, true, `command ${command.id} when`);
}

/** `enabled` (availability): a missing predicate means "always enabled". */
export function commandEnabled(command: Command | undefined): boolean {
  if (!command) return false;
  return evaluatePredicate(command.enabled, true, `command ${command.id} enabled`);
}

/**
 * Run a command by id.
 *
 * Returns `false` — without running anything — when the id is unknown, hidden
 * (`when === false`) or unavailable (`enabled === false`). A rejection from an
 * async `run()` is reported and swallowed: the caller is a menu click or a
 * keydown handler, and neither has anywhere to propagate to.
 */
export function executeCommand(id: CommandId): boolean {
  const command = getCommand(id);
  if (!command) return false;
  if (!commandVisible(command) || !commandEnabled(command)) return false;
  try {
    const result = command.run();
    if (result instanceof Promise) {
      void result.catch((error: unknown) => {
        console.debug(`[gpen] ignored rejection: command ${id}`, error);
        return;
      });
    }
  } catch (error) {
    console.debug(`[gpen] ignored rejection: command ${id}`, error);
    return false;
  }
  return true;
}

/** Drop every command (tests / teardown of a whole registry). */
export function clearCommands(): void {
  registry.clear();
}
