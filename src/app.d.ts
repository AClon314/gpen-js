// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  /**
   * 构建期常量：`package.json` 的 version。由 Vite 的 `define` 注入
   * （website 走 `vite.config.ts`，embed 走 `vite.embed.config.ts`）。
   */
  const __GPEN_VERSION__: string;
}

declare module "svelte/elements" {
  export interface SvelteHTMLElements {
    "gpen-button": import("svelte/elements").HTMLAttributes<HTMLElement> & {
      label?: string;
      disabled?: boolean;
      "ongpen-click"?: (e: CustomEvent<{ clicks: number; label: string }>) => void;
    };
  }
}

export {};
