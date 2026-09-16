/**
 * Reactive wrapper around `./theme.ts` (runes live here, so this file is imported
 * directly by Svelte code instead of going through the `#lib` barrel).
 *
 * Flow: `initTheme()` reads the static CSS tokens once → JS holds them in `$state`;
 * `setThemeToken` / `setThemeTokens` then write them straight to the target as inline
 * styles. `resetTheme()` drops the inline overrides so static CSS is the fallback again.
 */
import {
  applyGpenTokens,
  clearGpenTokens,
  readGpenTokens,
  type GpenToken,
  type GpenTokens,
} from "./theme.js";

const store = $state<{ tokens: GpenTokens }>({ tokens: {} });
let target: HTMLElement | undefined;

/** Snapshot the static tokens and take ownership of future changes. */
export function initTheme(host?: HTMLElement): GpenTokens {
  target = host ?? (typeof document === "undefined" ? undefined : document.documentElement);
  store.tokens = readGpenTokens(target);
  return store.tokens;
}

/** Current tokens (reactive). */
export function themeTokens(): GpenTokens {
  return store.tokens;
}

/** Change one token and write it to the target. */
export function setThemeToken(name: GpenToken, value: string): void {
  store.tokens[name] = value;
  applyGpenTokens({ [name]: value }, target);
}

/** Change several tokens at once and write them to the target. */
export function setThemeTokens(next: GpenTokens): void {
  Object.assign(store.tokens, next);
  applyGpenTokens(next, target);
}

/** Drop inline overrides and re-read the static values. */
export function resetTheme(): void {
  if (target === undefined) return;
  clearGpenTokens(target);
  store.tokens = readGpenTokens(target);
}
