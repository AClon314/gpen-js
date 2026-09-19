/**
 * Reactive wrapper around `./theme.ts` (runes live here, so this file is imported
 * directly by Svelte code instead of going through the `#lib` barrel).
 *
 * Flow: `initTheme()` applies the persisted theme preference (one
 * `data-gpen-theme` attribute — see `themes/day-night.css`) and reads the static
 * CSS tokens once → JS holds them in `$state`; `setThemeToken` / `setThemeTokens`
 * then write them straight to the target as inline styles. `resetTheme()` drops
 * the inline overrides so static CSS is the fallback again.
 *
 * There are two independent knobs here and they do not overlap:
 *
 * - `setThemePreference` picks **which** of the `light-dark()` branches is live
 *   (system / light / dark); it never writes a token value;
 * - `setThemeToken(s)` overrides individual tokens (theming / skinning); it
 *   never changes which branch the *other* tokens resolve to.
 */
import {
  applyGpenTokens,
  applyThemePreference,
  clearGpenTokens,
  readGpenTokens,
  type GpenThemePreference,
  type GpenToken,
  type GpenTokens,
} from "./theme.js";

const store = $state<{ tokens: GpenTokens; theme: GpenThemePreference }>({
  tokens: {},
  theme: "system",
});
let target: HTMLElement | undefined;

/**
 * Snapshot the static tokens and take ownership of future changes.
 *
 * `theme` is the caller's persisted preference (from `gpen.preferences`); it is
 * applied here because the static CSS needs the attribute *before* the first
 * paint of the workspace to avoid a flash of the wrong theme.
 */
export function initTheme(host?: HTMLElement, theme: GpenThemePreference = "system"): GpenTokens {
  target = host ?? (typeof document === "undefined" ? undefined : document.documentElement);
  store.theme = theme;
  applyThemePreference(theme, target);
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

/**
 * Current theme preference (reactive).
 *
 * `'system'` is the default: it means "the static CSS decides", i.e. no
 * `data-gpen-theme` attribute. The preference is *not* derived from the
 * resolved colors — a user who never made a choice must stay distinguishable
 * from one who forced the value the platform happens to agree with.
 */
export function themePreference(): GpenThemePreference {
  return store.theme;
}

/**
 * Set the theme preference and apply it to the target.
 *
 * The tokens themselves are not touched: every theme-dependent token is one
 * `light-dark(light, dark)` declaration and `color-scheme` picks a side, so
 * `'light'` / `'dark'` write an attribute and `'system'` removes it (see
 * `themes/day-night.css` and `applyThemePreference`).
 */
export function setThemePreference(next: GpenThemePreference): void {
  store.theme = next;
  applyThemePreference(next, target);
}
