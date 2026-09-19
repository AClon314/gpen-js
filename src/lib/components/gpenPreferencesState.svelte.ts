/**
 * Reactive holder for `GpenPreferences` (the `gpen.preferences` KV record).
 *
 * Why a module-level `$state` instead of a prop threaded down from the layout:
 * the preferences are read by more than one place (the theme is applied before
 * the first paint, the workspace reads `showStatusBar` / `autoSaveDebounceMs`
 * when it mounts, the settings panel edits every field), and the embed mounts
 * its own copy. A single reactive store plus an explicit load/save boundary
 * keeps those readers from each doing their own `storage.load()`.
 *
 * This file has runes, so it is imported directly (not through the `#lib`
 * barrel) — same rule as `themes/theme.svelte.ts`.
 */
import {
  createDefaultGpenPreferences,
  createRuntimeGpenPreferencesStorage,
  normalizeGpenPreferences,
  type GpenPreferences,
  type GpenPreferencesStorage,
} from "./gpenPreferences.js";

const store = $state<{ preferences: GpenPreferences; ready: boolean }>({
  preferences: createDefaultGpenPreferences(),
  ready: false,
});

let storage: GpenPreferencesStorage | undefined;
let loadStarted = false;

/** Current preferences (reactive). */
export function preferences(): GpenPreferences {
  return store.preferences;
}

/** Whether the stored values have been read (defaults are in place until then). */
export function preferencesReady(): boolean {
  return store.ready;
}

/** Replace one or more fields and persist. */
export function updatePreferences(patch: Partial<GpenPreferences>): void {
  const next = normalizeGpenPreferences({ ...store.preferences, ...patch });
  // A no-op patch must not reassign: the settings panel's sliders emit from an
  // `$effect`, so reassigning state here would re-render the slider, which
  // emits again — `effect_update_depth_exceeded` (measured).
  if (!changedPreferences(store.preferences, next)) return;
  store.preferences = next;
  void persist();
}

/** Shallow comparison over the preference fields (JSON-safe scalars only). */
function changedPreferences(left: GpenPreferences, right: GpenPreferences): boolean {
  for (const key of Object.keys(right)) {
    if (!Object.is(left[key], right[key])) return true;
  }
  return false;
}

/** Reset to the defaults and persist. */
export function resetPreferences(): GpenPreferences {
  const next = createDefaultGpenPreferences();
  if (changedPreferences(store.preferences, next)) {
    store.preferences = next;
    void persist();
  }
  return store.preferences;
}

async function persist(): Promise<void> {
  const target = storage;
  if (!target || !store.ready) return;
  try {
    await target.save(store.preferences);
  } catch (error) {
    console.debug("[gpen] ignored rejection: preferences persist", error);
    return;
  }
}

/**
 * Read the stored preferences once. Returns the loaded value.
 *
 * Deliberately idempotent: the overlay can be re-mounted (minimize/restore does
 * *not* unmount it, but an embed host can) without reloading from storage and
 * clobbering unsaved changes.
 */
export async function loadPreferences(): Promise<GpenPreferences> {
  if (loadStarted) return store.preferences;
  loadStarted = true;
  storage = createRuntimeGpenPreferencesStorage();
  try {
    const stored = await storage.load();
    if (stored) store.preferences = normalizeGpenPreferences(stored, store.preferences);
  } catch (error) {
    console.debug("[gpen] ignored rejection: preferences load", error);
    // Keep the defaults; the panel is still usable and will persist on change.
    return store.preferences;
  } finally {
    store.ready = true;
  }
  return store.preferences;
}

/** Release the KV connection (IndexedDB) on teardown. */
export async function closePreferences(): Promise<void> {
  const target = storage;
  storage = undefined;
  loadStarted = false;
  store.ready = false;
  if (!target?.close) return;
  try {
    await target.close();
  } catch (error) {
    console.debug("[gpen] ignored rejection: preferences close", error);
    return;
  }
}

/** Test seam: inject a storage adapter (also used by the demo page). */
export function setPreferencesStorage(next: GpenPreferencesStorage | undefined): void {
  storage = next;
}
