/**
 * `GpenPreferences`: the user-preference layer (cross-document, cross-workspace).
 *
 * The three layers this project keeps apart, and why (handoff §4.1):
 *
 * | layer                                   | lives in                              | example                        |
 * | --------------------------------------- | ------------------------------------- | ------------------------------ |
 * | user preference (this file)             | `gpen.preferences` KV                 | theme, locale, default tool     |
 * | toolbar / session                       | protocol `Gpen.toolbarState`           | brush size/color, eraser mode   |
 * | workspace layout                        | `gpen.workspaceState` KV               | panelLayout, uiScale, activeTool |
 *
 * They are separate KV roots on purpose: `createKvStorage` keeps one in-memory
 * root per instance and `submit()` writes the whole root back, so two features
 * sharing a root would overwrite each other's namespace (see docs/storage.md).
 *
 * `theme` is a tri-state (`system` | `light` | `dark`) — see `themes/theme.ts`
 * for how the static CSS resolves it without duplicating the palette in JS.
 */
import type { JsonValue, Storage } from "../bindings/storage/index.js";
import { createRuntimeStorage, type RuntimeStorageOptions } from "../bindings/storage/index.js";
import { TOOL_IDS, type GpenToolId } from "./gpenWorkspaceState.js";

/** KV key for this root (kept distinct from the workspace/document roots). */
export const GPEN_PREFERENCES_KEY = "gpen.preferences";

export const THEME_PREFERENCES = ["system", "light", "dark"] as const;
export type GpenThemePreference = (typeof THEME_PREFERENCES)[number];

export const LOCALE_PREFERENCES = ["system", "en", "zh-cn"] as const;
export type GpenLocalePreference = (typeof LOCALE_PREFERENCES)[number];

export const AUTO_SAVE_DEBOUNCE_MIN_MS = 0;
export const AUTO_SAVE_DEBOUNCE_MAX_MS = 10_000;
export const AUTO_SAVE_DEBOUNCE_DEFAULT_MS = 250;

/**
 * All persisted user preferences. Keep this JSON-serializable: it goes through
 * the KV adapter untouched.
 */
export interface GpenPreferences {
  [key: string]: JsonValue;
  version: 1;
  theme: GpenThemePreference;
  locale: GpenLocalePreference;
  /** Tool selected when a workspace opens with no session of its own. */
  defaultTool: GpenToolId;
  showStatusBar: boolean;
  /** Document write debounce in milliseconds (0 = write on every change). */
  autoSaveDebounceMs: number;
}

export type GpenPreferencesSnapshot = GpenPreferences;

export interface GpenPreferencesStorage {
  load(): Promise<GpenPreferences | undefined>;
  save(preferences: GpenPreferencesSnapshot): Promise<void>;
  close?(): void | Promise<void>;
}

export type GpenPreferencesStorageRecord = {
  preferences: GpenPreferencesSnapshot;
};

export function createDefaultGpenPreferences(): GpenPreferences {
  return {
    version: 1,
    theme: "system",
    locale: "system",
    defaultTool: "brush",
    showStatusBar: true,
    autoSaveDebounceMs: AUTO_SAVE_DEBOUNCE_DEFAULT_MS,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function normalizeDebounce(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return Math.min(AUTO_SAVE_DEBOUNCE_MAX_MS, Math.max(AUTO_SAVE_DEBOUNCE_MIN_MS, rounded));
}

/**
 * Validate a stored (or partially specified) preferences object.
 *
 * Every field is validated independently and falls back per-field rather than
 * discarding the whole record: a preferences file written by an older version
 * must not reset the settings it does understand.
 */
export function normalizeGpenPreferences(
  value: unknown,
  fallback: GpenPreferences = createDefaultGpenPreferences(),
): GpenPreferences {
  const source = isRecord(value) ? value : {};
  return {
    version: 1,
    theme: isOneOf(THEME_PREFERENCES, source.theme) ? source.theme : fallback.theme,
    locale: isOneOf(LOCALE_PREFERENCES, source.locale) ? source.locale : fallback.locale,
    defaultTool: isOneOf(TOOL_IDS, source.defaultTool) ? source.defaultTool : fallback.defaultTool,
    showStatusBar:
      typeof source.showStatusBar === "boolean" ? source.showStatusBar : fallback.showStatusBar,
    autoSaveDebounceMs: normalizeDebounce(source.autoSaveDebounceMs, fallback.autoSaveDebounceMs),
  };
}

export function serializeGpenPreferences(preferences: GpenPreferences): GpenPreferencesSnapshot {
  return normalizeGpenPreferences(preferences);
}

/** KV adapter over an already-created runtime storage. */
export function createKvGpenPreferencesStorage(
  storage: Pick<Storage<GpenPreferencesStorageRecord>, "kv">,
): GpenPreferencesStorage {
  return {
    async load() {
      const stored = await storage.kv.get.preferences;
      return stored === undefined ? undefined : normalizeGpenPreferences(stored);
    },
    async save(preferences) {
      await storage.kv.set.preferences(serializeGpenPreferences(preferences));
      await storage.kv.submit();
    },
  };
}

/** In-memory adapter (tests, and the fallback when no backend is available). */
export function createMemoryGpenPreferencesStorage(
  initial: GpenPreferences = createDefaultGpenPreferences(),
): GpenPreferencesStorage {
  let current: GpenPreferences | undefined = initial;
  return {
    async load() {
      return current === undefined ? undefined : { ...current };
    },
    async save(preferences) {
      current = serializeGpenPreferences(preferences);
    },
  };
}

/**
 * Default backend for the preferences root: the runtime KV partition, degraded
 * to an in-memory store when the backend cannot be created at all (so the
 * settings panel still works for the session instead of throwing on open).
 */
export function createRuntimeGpenPreferencesStorage(
  options: RuntimeStorageOptions<GpenPreferencesStorageRecord> = {},
): GpenPreferencesStorage {
  const memory = createMemoryGpenPreferencesStorage();
  try {
    // ⚠️ 必须传 `kvKey`：不传就落到 `"root"`，而工作区偏好用的是 `"gpen-root"`。
    // 同一页面里两个 runtime root 会各持一份内存副本、各自 `submit()` 整根写回**同一个**
    // IndexedDB key，互相覆盖（实测：偏好写了读不回来）。见 docs/preferences.md。
    const storage = createRuntimeStorage<GpenPreferencesStorageRecord>({
      kvKey: GPEN_PREFERENCES_KEY,
      ...options,
    });
    const kv = createKvGpenPreferencesStorage(storage);
    return {
      async load() {
        try {
          return await kv.load();
        } catch (error) {
          console.debug("[gpen] ignored rejection: preferences kv load", error);
          return await memory.load();
        }
      },
      async save(preferences) {
        try {
          await kv.save(preferences);
        } catch (error) {
          console.debug("[gpen] ignored rejection: preferences kv save", error);
          await memory.save(preferences);
          return;
        }
      },
      close() {
        return storage.close?.();
      },
    };
  } catch (error) {
    console.debug("[gpen] ignored rejection: preferences runtime storage", error);
    return memory;
  }
}
