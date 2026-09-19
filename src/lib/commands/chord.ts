/**
 * Keyboard chord normalization and matching (pure; no DOM, no Svelte).
 *
 * A chord is written the way it is displayed: `Ctrl+Shift+Z`, `Mod+K`,
 * `Alt+ArrowUp`. Normalization happens on **both** sides — the registered
 * binding and the live event — so `ctrl+z`, `Cmd+Z` and `MOD+Z` are the same
 * chord, and a binding can be authored with either spelling.
 *
 * Rules:
 *
 * - `Ctrl` / `Cmd` / `Meta` / `Command` all normalize to `Mod`, so one binding
 *   covers Windows/Linux and macOS. (A binding that really needs the physical
 *   key — e.g. macOS-only `Cmd+Q` — can spell `Ctrl` instead; `Ctrl` normalizes
 *   to `Mod` too, which is the tradeoff this project chose: one binding per
 *   action, not one per platform.)
 * - `Option` is an alias for `Alt`.
 * - Modifier order in the normalized form is fixed (`Mod`, `Ctrl+Alt` has no
 *   separate meaning, `Alt`, `Shift`) so equal chords compare equal as strings.
 * - The key itself is case-insensitive and mapped through `KeyboardEvent.key`
 *   spellings: `Esc` → `Escape`, `Space`/` ` → `Space`, `Up` → `ArrowUp`.
 *   Single letters stay lowercase.
 *
 * `eventToChord` returns `undefined` for events that cannot be a chord: pure
 * modifier presses (`Shift` alone) and keydowns that only carry a dead key.
 */

/** The modifier set of one chord, in canonical order. */
export interface ChordParts {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** Normalized non-modifier key (lowercase letters, canonical names). */
  key: string;
}

const MODIFIER_ALIASES: Record<string, "mod" | "alt" | "shift"> = {
  mod: "mod",
  ctrl: "mod",
  control: "mod",
  cmd: "mod",
  command: "mod",
  meta: "mod",
  super: "mod",
  win: "mod",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

/**
 * Keys whose `KeyboardEvent.key` value is spelled differently by authors.
 * Values are the **canonical** spelling (used in the normalized chord form).
 */
const KEY_ALIASES: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  spacebar: "Space",
  " ": "Space",
  space: "Space",
  up: "ArrowUp",
  arrowup: "ArrowUp",
  down: "ArrowDown",
  arrowdown: "ArrowDown",
  left: "ArrowLeft",
  arrowleft: "ArrowLeft",
  right: "ArrowRight",
  arrowright: "ArrowRight",
  return: "Enter",
  enter: "Enter",
  del: "Delete",
  delete: "Delete",
  ins: "Insert",
  insert: "Insert",
  pgup: "PageUp",
  pageup: "PageUp",
  pgdn: "PageDown",
  pagedown: "PageDown",
  tab: "Tab",
  home: "Home",
  end: "End",
  backspace: "Backspace",
  // `+` / `-` are spelled out: a literal `+` cannot appear in a `+`-separated
  // chord string without becoming ambiguous. `KeyboardEvent.key` for those keys
  // is `"+"` / `"-"`, which is why the mapping lives here and not in parsing.
  "+": "plus",
  "-": "minus",
};

/** Normalize one key name (modifiers are handled separately). */
export function normalizeKeyName(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) return "";
  const lowered = trimmed.toLowerCase();
  const aliased = KEY_ALIASES[lowered];
  if (aliased !== undefined) return aliased;
  // A single character keeps its identity but loses case (`Z` == `z`).
  if (trimmed.length === 1) return lowered;
  // `F2` / `F12` read better uppercase in the normalized form.
  if (/^f\d{1,2}$/.test(lowered)) return lowered.toUpperCase();
  return lowered;
}

/** Parse a chord string (`"Ctrl+Shift+Z"`) into its parts; `undefined` if unusable. */
export function parseChord(chord: string): ChordParts | undefined {
  if (typeof chord !== "string") return undefined;
  const parts: ChordParts = { mod: false, alt: false, shift: false, key: "" };
  let sawKey = false;

  for (const raw of chord.split("+")) {
    const token = raw.trim();
    if (token.length === 0) continue;
    const modifier = MODIFIER_ALIASES[token.toLowerCase()];
    if (modifier !== undefined) {
      parts[modifier] = true;
      continue;
    }
    const key = normalizeKeyName(token);
    if (key === "") continue;
    // A second non-modifier token means the chord is malformed ("A+B"); the
    // last one wins so a caller's typo degrades instead of throwing.
    parts.key = key;
    sawKey = true;
  }

  return sawKey ? parts : undefined;
}

/** Canonical string form of a chord (`Mod+Shift+Z`); used as the map key. */
export function formatChord(parts: ChordParts): string {
  const tokens: string[] = [];
  if (parts.mod) tokens.push("Mod");
  if (parts.alt) tokens.push("Alt");
  if (parts.shift) tokens.push("Shift");
  if (parts.key !== "") tokens.push(parts.key);
  return tokens.join("+");
}

/** Normalize a chord string to its canonical form; `""` when unusable. */
export function normalizeChord(chord: string): string {
  const parts = parseChord(chord);
  return parts ? formatChord(parts) : "";
}

/** True when the key is a modifier by itself (no chord can be formed from it). */
function isBareModifier(key: string): boolean {
  return MODIFIER_ALIASES[key.toLowerCase()] !== undefined;
}

/** Minimal shape of a keydown event needed for matching (keeps tests DOM-free). */
export interface ChordEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Normalize a live keyboard event to a canonical chord; `undefined` if it is not one. */
export function eventToChord(event: ChordEventLike): string | undefined {
  if (typeof event.key !== "string" || event.key.length === 0) return undefined;
  if (isBareModifier(event.key)) return undefined;
  const key = normalizeKeyName(event.key);
  if (key === "") return undefined;
  return formatChord({
    mod: event.ctrlKey === true || event.metaKey === true,
    alt: event.altKey === true,
    shift: event.shiftKey === true,
    key,
  });
}
