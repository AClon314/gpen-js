import { describe, expect, test } from "bun:test";
// IndexedDB shim: the website storage backend (the one `createRuntimeStorage`
// picks in a plain page) needs it, and the point of the last test is the real
// backend, not a stub.
import "fake-indexeddb/auto";

import {
  AUTO_SAVE_DEBOUNCE_DEFAULT_MS,
  AUTO_SAVE_DEBOUNCE_MAX_MS,
  AUTO_SAVE_DEBOUNCE_MIN_MS,
  BLUR_LEGACY_AMOUNT,
  BLUR_MAX,
  BLUR_MIN,
  createDefaultGpenPreferences,
  createKvGpenPreferencesStorage,
  createMemoryGpenPreferencesStorage,
  createRuntimeGpenPreferencesStorage,
  GPEN_PREFERENCES_KEY,
  normalizeGpenPreferences,
  serializeGpenPreferences,
} from "../src/lib/components/gpenPreferences";
import { createKvStorage, createMemoryKvBackend } from "../src/lib/bindings/storage/index";
import { createRuntimeStorage } from "../src/lib/bindings/storage/index";
import { GPEN_WORKSPACE_STATE_KEY } from "../src/lib/components/gpenWorkspaceState";

describe("gpen preferences", () => {
  test("defaults are the documented shape", () => {
    const defaults = createDefaultGpenPreferences();
    expect(defaults).toEqual({
      version: 1,
      theme: "system",
      locale: "system",
      defaultTool: "brush",
      showStatusBar: true,
      blur: 0,
      autoSaveDebounceMs: AUTO_SAVE_DEBOUNCE_DEFAULT_MS,
    });
  });

  test("normalize validates each field independently", () => {
    const normalized = normalizeGpenPreferences({
      theme: "dark",
      locale: "klingon",
      defaultTool: "laser",
      showStatusBar: "yes",
      blur: "yes",
      autoSaveDebounceMs: Number.NaN,
    });
    expect(normalized.theme).toBe("dark");
    // One bad field does not reset the ones that are fine.
    expect(normalized.locale).toBe("system");
    expect(normalized.defaultTool).toBe("brush");
    expect(normalized.showStatusBar).toBe(true);
    // 磨砂玻璃是「模糊半径」数值，不是布尔：字符串（非法）回落到 fallback 的 0。
    expect(normalized.blur).toBe(0);
    expect(normalized.autoSaveDebounceMs).toBe(AUTO_SAVE_DEBOUNCE_DEFAULT_MS);
  });

  test("normalize migrates the legacy boolean blur and clamps the radius", () => {
    // 旧版本存过 boolean：`true` 迁到原来的 2px 观感，`false` 就是 0。
    expect(normalizeGpenPreferences({ blur: true }).blur).toBe(BLUR_LEGACY_AMOUNT);
    expect(normalizeGpenPreferences({ blur: false }).blur).toBe(BLUR_MIN);
    expect(normalizeGpenPreferences({ blur: 8 }).blur).toBe(8);
    expect(normalizeGpenPreferences({ blur: 999 }).blur).toBe(BLUR_MAX);
    expect(normalizeGpenPreferences({ blur: -4 }).blur).toBe(BLUR_MIN);
    // 半径是整数：小数四舍五入（与 debounce 同一策略）。
    expect(normalizeGpenPreferences({ blur: 3.6 }).blur).toBe(4);
    // fallback 也是数值时，非法输入回落到该数值。
    expect(
      normalizeGpenPreferences({ blur: "nope" }, { ...createDefaultGpenPreferences(), blur: 6 })
        .blur,
    ).toBe(6);
  });

  test("normalize clamps the debounce into the supported range", () => {
    expect(normalizeGpenPreferences({ autoSaveDebounceMs: -5 }).autoSaveDebounceMs).toBe(
      AUTO_SAVE_DEBOUNCE_MIN_MS,
    );
    expect(normalizeGpenPreferences({ autoSaveDebounceMs: 1e9 }).autoSaveDebounceMs).toBe(
      AUTO_SAVE_DEBOUNCE_MAX_MS,
    );
    expect(normalizeGpenPreferences({ autoSaveDebounceMs: 120.6 }).autoSaveDebounceMs).toBe(121);
  });

  test("normalize survives non-objects and uses the injected fallback", () => {
    const fallback = { ...createDefaultGpenPreferences(), theme: "dark" as const };
    expect(normalizeGpenPreferences(undefined, fallback).theme).toBe("dark");
    expect(normalizeGpenPreferences("nope", fallback).theme).toBe("dark");
    expect(normalizeGpenPreferences([], fallback).theme).toBe("dark");
    expect(normalizeGpenPreferences(null).theme).toBe("system");
  });

  test("serialize round-trips through normalize", () => {
    const value = createDefaultGpenPreferences();
    value.theme = "light";
    value.autoSaveDebounceMs = 5000;
    expect(serializeGpenPreferences(value)).toEqual(value);
  });

  test("KV storage round-trips under the preferences namespace", async () => {
    const backend = createMemoryKvBackend<Record<string, never>>();
    // The adapter takes the `{ kv }` seam, not a bare KvStorage.
    const adapter = createKvGpenPreferencesStorage({ kv: createKvStorage(backend) });

    expect(await adapter.load()).toBeUndefined();
    await adapter.save({ ...createDefaultGpenPreferences(), theme: "dark", locale: "zh-cn" });
    const loaded = await adapter.load();
    expect(loaded?.theme).toBe("dark");
    expect(loaded?.locale).toBe("zh-cn");
    // Stored under `preferences`, not at the root.
    const root = await backend.load();
    expect(Object.keys(root)).toEqual(["preferences"]);
  });

  test("memory storage round-trips and copies on read", async () => {
    const adapter = createMemoryGpenPreferencesStorage();
    await adapter.save({ ...createDefaultGpenPreferences(), showStatusBar: false });
    const first = await adapter.load();
    expect(first?.showStatusBar).toBe(false);
    first!.showStatusBar = true;
    // Mutating the returned object must not write through.
    expect((await adapter.load())?.showStatusBar).toBe(false);
  });

  test("runtime storage falls back to memory instead of throwing", async () => {
    const adapter = createRuntimeGpenPreferencesStorage();
    await adapter.save({ ...createDefaultGpenPreferences(), defaultTool: "eraser" });
    const loaded = await adapter.load();
    expect(loaded?.defaultTool).toBe("eraser");
    await adapter.close?.();
  });

  test("the preferences key is its own namespace, not the workspace one", () => {
    // Sharing a KV root is the bug this guards: `createKvStorage` keeps one
    // in-memory root and `submit()` writes the whole root back, so two features
    // on one key would overwrite each other's namespace.
    expect(GPEN_PREFERENCES_KEY).not.toBe(GPEN_WORKSPACE_STATE_KEY);
  });

  test("two runtime roots do not overwrite each other", async () => {
    const preferences = createRuntimeStorage<{ preferences?: unknown }>({
      kvKey: GPEN_PREFERENCES_KEY,
    });
    const workspace = createRuntimeStorage<{ workspace?: unknown }>({ kvKey: "gpen-root" });
    await preferences.kv.set.preferences({ version: 1, theme: "dark" });
    await preferences.kv.submit();
    await workspace.kv.set.workspace({ version: 1, uiScale: 1.5 });
    await workspace.kv.submit();

    expect((await preferences.kv.get.preferences)?.theme).toBe("dark");
    expect((await workspace.kv.get.workspace)?.uiScale).toBe(1.5);
    // Reloading the preference root from scratch must not see the workspace data.
    const reread = createRuntimeStorage<{ preferences?: unknown }>({
      kvKey: GPEN_PREFERENCES_KEY,
    });
    expect((await reread.kv.get.preferences)?.theme).toBe("dark");
    expect(await reread.kv.get.workspace).toBeUndefined();
  });
});
