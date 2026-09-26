/**
 * Theme token layer.
 *
 * The static `day-night.css` defines the `--gpen-*` tokens (`:root`/`:host`, plus a
 * `prefers-color-scheme: dark` block) — that is the **fallback** and the initial paint.
 * JS then reads those values once (`readGpenTokens`) and from then on owns them
 * (`applyGpenTokens` writes inline styles on the target). Reactive wrapper:
 * `./theme.svelte.ts`.
 */

/** Every token the theme layer owns. */
export const GPEN_TOKENS = [
  "--gpen-font-sans",
  "--gpen-font-mono",
  "--gpen-font-size",
  "--gpen-line-height",
  "--gpen-char-width",
  "--gpen-workspace-background",
  "--gpen-panel-background",
  "--gpen-panel-border",
  "--gpen-panel-foreground",
  "--gpen-panel-muted",
  "--gpen-panel-accent",
  "--gpen-panel-shadow",
  "--gpen-chrome-background",
  "--gpen-chrome-background-subtle",
  "--gpen-panel-background-raised",
  "--gpen-panel-background-hover",
  "--gpen-panel-selection",
  "--gpen-viewport-overlay-background",
  "--gpen-viewport-overlay-foreground",
  "--gpen-viewport-overlay-shadow",
  "--gpen-danger",
  "--gpen-radius",
  "--gpen-radius-sm",
  "--gpen-blur",
] as const;

/** 主题层管理的 token 名。 */
export type GpenToken = (typeof GPEN_TOKENS)[number];
/** token 名 → 值（允许只覆盖一部分）。 */
export type GpenTokens = Partial<Record<GpenToken, string>>;

/**
 * 磨砂玻璃开关的根属性（presence-only）：CSS 变体在 `themes/blur.css`，
 * 由 `applyBlurPreference()` 维护，和 `data-gpen-theme` 是一对（但它是数值半径，不是三态）。
 */
export const GPEN_BLUR_ATTRIBUTE = "data-gpen-blur";

/**
 * 设置磨砂玻璃的模糊半径（CSS px，`0` = 关）。
 *
 * 只写根属性（presence-only）+ 一个内联 `--gpen-blur`：半透明 token 与 `filter` 全在
 * `themes/blur.css` 里（不把调色板抄进 JS）；半径本身是用户可调的数值，只能内联下发。
 */
export function applyBlurPreference(
  amount: number,
  target: HTMLElement | undefined = defaultTarget(),
): void {
  if (target === undefined) return;
  if (amount > 0) {
    target.setAttribute(GPEN_BLUR_ATTRIBUTE, "");
    target.style.setProperty("--gpen-blur", `${amount}px`);
  } else {
    target.removeAttribute(GPEN_BLUR_ATTRIBUTE);
    target.style.removeProperty("--gpen-blur");
  }
}

/** Default target: the document root (the embed passes its shadow host instead). */
function defaultTarget(): HTMLElement | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement;
}

/** Read the currently computed token values (static CSS is the fallback). */
export function readGpenTokens(target: HTMLElement | undefined = defaultTarget()): GpenTokens {
  if (target === undefined) return {};
  const computed = getComputedStyle(target);
  const tokens: GpenTokens = {};
  for (const name of GPEN_TOKENS) {
    const value = computed.getPropertyValue(name).trim();
    if (value !== "") tokens[name] = value;
  }
  return tokens;
}

/** Write tokens as inline styles on the target (JS takes over from here). */
export function applyGpenTokens(
  tokens: GpenTokens,
  target: HTMLElement | undefined = defaultTarget(),
): void {
  if (target === undefined) return;
  for (const name of GPEN_TOKENS) {
    const value = tokens[name];
    if (value === undefined) target.style.removeProperty(name);
    else target.style.setProperty(name, value);
  }
}

/** Drop all inline overrides so the static CSS takes over again. */
export function clearGpenTokens(target: HTMLElement | undefined = defaultTarget()): void {
  if (target === undefined) return;
  for (const name of GPEN_TOKENS) target.style.removeProperty(name);
}

/**
 * The three theme states the settings panel exposes.
 *
 * `'system'` is **not** a pair of resolved tokens: it means "let the platform
 * decide", so it has to stay distinguishable from a user-forced light/dark.
 */
export type GpenThemePreference = "system" | "light" | "dark";

/** Attribute the static CSS keys off (see `themes/day-night.css`). */
export const GPEN_THEME_ATTRIBUTE = "data-gpen-theme";

/**
 * Apply a theme preference by writing (or removing) one attribute.
 *
 * The token values themselves never change: every theme-dependent token is a
 * single `light-dark(light, dark)` declaration and `color-scheme` picks a side.
 * So `'light'`/`'dark'` force `color-scheme` through the attribute rules, and
 * `'system'` removes the attribute, which returns the root to
 * `color-scheme: light dark`.
 *
 * Rejected alternative: JS writing the resolved token values (which is what
 * `setThemeTokens` is for). That duplicates the palette in TypeScript and, more
 * importantly, cannot express "system" — reading back the tokens loses the
 * information that the user never made a choice.
 *
 * Returns whether the preference was applied.
 */
export function applyThemePreference(
  preference: GpenThemePreference,
  target: HTMLElement | undefined = defaultTarget(),
): boolean {
  if (target === undefined) return false;
  if (preference === "system") target.removeAttribute(GPEN_THEME_ATTRIBUTE);
  else target.setAttribute(GPEN_THEME_ATTRIBUTE, preference);
  return true;
}

/** Read back the attribute; `'system'` when it is absent or unrecognized. */
export function readThemePreference(
  target: HTMLElement | undefined = defaultTarget(),
): GpenThemePreference {
  if (target === undefined) return "system";
  const value = target.getAttribute(GPEN_THEME_ATTRIBUTE);
  return value === "light" || value === "dark" ? value : "system";
}
