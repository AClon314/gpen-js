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
