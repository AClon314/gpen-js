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
  "--gpen-danger",
  "--gpen-radius",
  "--gpen-radius-sm",
] as const;

export type GpenToken = (typeof GPEN_TOKENS)[number];
export type GpenTokens = Partial<Record<GpenToken, string>>;

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
