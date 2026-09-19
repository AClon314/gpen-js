/**
 * Pure layer-tree behaviour layer (implementation of `docs/tree.md`).
 *
 * No Svelte, no DOM, no storage: flattening, keyboard focus, selection,
 * typeahead, search and drag & drop are plain functions so they can be unit
 * tested (`tests/tree.test.ts`) and reused by any renderer.
 */
export * from "./types.js";
export * from "./rows.js";
export * from "./keyboard.js";
export * from "./selection.js";
export * from "./typeahead.js";
export * from "./search.js";
export * from "./dropTarget.js";
export * from "./drop.js";
