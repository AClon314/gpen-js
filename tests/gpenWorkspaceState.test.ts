import "fake-indexeddb/auto";

import { afterEach, describe, expect, test } from "bun:test";

import { createMemoryStorage } from "../src/lib/bindings/storage/index.ts";
import {
  createDefaultGpenWorkspaceState,
  createKvGpenWorkspaceStateStorage,
  createLocalStorageGpenWorkspaceStateStorage,
  createMigratingGpenWorkspaceStateStorage,
  createRuntimeGpenWorkspaceStateStorage,
  GPEN_UI_SCALE_KEY,
  GPEN_WORKSPACE_STATE_KEY,
  normalizeGpenWorkspaceState,
  normalizeUiScale,
  readLegacyLocalStorageGpenWorkspaceStatePatch,
  type GpenWorkspaceStateStorage,
  type GpenWorkspaceStorageRecord,
} from "../src/lib/components/gpenWorkspaceState";

let databaseSequence = 0;

function uniqueDatabaseName(): string {
  databaseSequence += 1;
  return `gpen-workspace-state-test-${databaseSequence}`;
}

function installLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const map = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, String(value)),
      removeItem: (key: string) => void map.delete(key),
      clear: () => map.clear(),
      key: (index: number) => [...map.keys()][index] ?? null,
      get length() {
        return map.size;
      },
    },
  });
  return map;
}

afterEach(() => {
  // @ts-expect-error test cleanup: bun has no localStorage until a test installs one.
  delete globalThis.localStorage;
});

describe("workspace state legacy localStorage", () => {
  test("reads the state object and merges the older uiScale key", () => {
    installLocalStorage({
      [GPEN_WORKSPACE_STATE_KEY]: JSON.stringify({ version: 1, activeTool: "eraser" }),
      [GPEN_UI_SCALE_KEY]: "1.5",
    });

    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toEqual({
      version: 1,
      activeTool: "eraser",
      uiScale: 1.5,
    });
  });

  test("reads the uiScale-only format and rejects garbage", () => {
    installLocalStorage({ [GPEN_UI_SCALE_KEY]: "0.75" });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toEqual({ uiScale: 0.75 });

    installLocalStorage({ [GPEN_WORKSPACE_STATE_KEY]: "[1,2,3]" });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toBeUndefined();
  });

  test("gives up on the whole read when the state JSON is malformed", () => {
    // 旧实现里 `JSON.parse` 的异常会直接跳出整个 try，连合法的 `gpen.uiScale`
    // 也一并丢弃。这条测试把那个边界钉住，避免重构时“顺手修好”而改变行为。
    installLocalStorage({
      [GPEN_WORKSPACE_STATE_KEY]: "{not json",
      [GPEN_UI_SCALE_KEY]: "1.25",
    });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toBeUndefined();
  });

  test("ignores a non-object state payload and falls back to uiScale", () => {
    installLocalStorage({
      [GPEN_WORKSPACE_STATE_KEY]: "42",
      [GPEN_UI_SCALE_KEY]: "1.5",
    });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toEqual({ uiScale: 1.5 });
  });

  test("keeps the state object when its uiScale is already set", () => {
    installLocalStorage({
      [GPEN_WORKSPACE_STATE_KEY]: JSON.stringify({ version: 1, uiScale: 0.5 }),
      [GPEN_UI_SCALE_KEY]: "1.5",
    });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toEqual({
      version: 1,
      uiScale: 0.5,
    });
  });

  test("returns the state object untouched when the legacy uiScale key is absent", () => {
    installLocalStorage({
      [GPEN_WORKSPACE_STATE_KEY]: JSON.stringify({ version: 1, activeTool: "lasso" }),
    });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toEqual({
      version: 1,
      activeTool: "lasso",
    });
  });

  test("rejects a non-numeric legacy uiScale", () => {
    installLocalStorage({ [GPEN_UI_SCALE_KEY]: "not-a-number" });
    expect(readLegacyLocalStorageGpenWorkspaceStatePatch()).toBeUndefined();
  });

  test("save keeps both the state object and the legacy key in sync", async () => {
    const map = installLocalStorage();
    const storage = createLocalStorageGpenWorkspaceStateStorage();
    await storage.save({ ...createDefaultGpenWorkspaceState(), uiScale: 1.25 });

    expect(JSON.parse(map.get(GPEN_WORKSPACE_STATE_KEY) ?? "null")).toMatchObject({
      uiScale: 1.25,
    });
    expect(map.get(GPEN_UI_SCALE_KEY)).toBe("1.25");
  });

  test("is a no-op when localStorage is unavailable", async () => {
    const storage = createLocalStorageGpenWorkspaceStateStorage();
    expect(await storage.load()).toBeUndefined();
    await storage.save(createDefaultGpenWorkspaceState());
  });
});

describe("workspace state normalization", () => {
  test("treats non-objects as an empty source", () => {
    const defaults = createDefaultGpenWorkspaceState();
    for (const value of [undefined, null, 42, "state", [1, 2, 3]]) {
      expect(normalizeGpenWorkspaceState(value)).toEqual(defaults);
    }
  });

  test("fills only the fields that are missing", () => {
    const fallback = {
      ...createDefaultGpenWorkspaceState(),
      uiScale: 1.5,
      open: true,
      activeTool: "picker" as const,
    };
    expect(normalizeGpenWorkspaceState({}, fallback)).toMatchObject({
      uiScale: 1.5,
      open: true,
      activeTool: "picker",
    });
    expect(normalizeGpenWorkspaceState({ open: false }, fallback)).toMatchObject({
      uiScale: 1.5,
      open: false,
      activeTool: "picker",
    });
  });

  test("upgrades an old version number to the current one", () => {
    // 存储里的 `version` 不被信任：它只用于日后迁移，输出永远是当前版本。
    expect(normalizeGpenWorkspaceState({ version: 2, uiScale: 1.5 }).version).toBe(1);
    expect(normalizeGpenWorkspaceState("nonsense").version).toBe(1);
  });

  test("rejects non-finite uiScale and re-clamps the valid ones", () => {
    const fallback = { ...createDefaultGpenWorkspaceState(), uiScale: 1.5 };
    expect(normalizeGpenWorkspaceState({ uiScale: Number.NaN }, fallback).uiScale).toBe(1.5);
    expect(
      normalizeGpenWorkspaceState({ uiScale: Number.POSITIVE_INFINITY }, fallback).uiScale,
    ).toBe(1.5);
    expect(normalizeGpenWorkspaceState({ uiScale: "2" }, fallback).uiScale).toBe(1.5);
    expect(normalizeGpenWorkspaceState({ uiScale: 99 }).uiScale).toBe(normalizeUiScale(99));
    expect(normalizeGpenWorkspaceState({ uiScale: 0 }).uiScale).toBe(normalizeUiScale(0));
  });

  test("rejects an unknown tool id", () => {
    const fallback = { ...createDefaultGpenWorkspaceState(), activeTool: "eraser" as const };
    expect(normalizeGpenWorkspaceState({ activeTool: "teleport" }, fallback).activeTool).toBe(
      "eraser",
    );
    expect(normalizeGpenWorkspaceState({ activeTool: 7 }, fallback).activeTool).toBe("eraser");
  });

  test("a present but invalid panelLayout becomes null instead of the fallback", () => {
    const fallback = {
      ...createDefaultGpenWorkspaceState(),
      panelLayout: { grid: { width: 800, height: 600 } },
    };
    // 字段存在 = 用户的那份布局（哪怕坏了），不能被默认布局盖掉。
    expect(normalizeGpenWorkspaceState({ panelLayout: "nope" }, fallback).panelLayout).toBeNull();
    // 字段缺失才用 fallback。
    expect(normalizeGpenWorkspaceState({}, fallback).panelLayout).toEqual(fallback.panelLayout);
  });

  test("a present but invalid ballPosition becomes null and valid ones round", () => {
    const fallback = {
      ...createDefaultGpenWorkspaceState(),
      ballPosition: { x: 10, y: 20 },
    };
    expect(
      normalizeGpenWorkspaceState({ ballPosition: { x: 1, y: "2" } }, fallback).ballPosition,
    ).toBeNull();
    expect(
      normalizeGpenWorkspaceState({ ballPosition: { x: 1.6, y: -2.4 } }, fallback).ballPosition,
    ).toEqual({ x: 2, y: -2 });
    expect(normalizeGpenWorkspaceState({}, fallback).ballPosition).toEqual({ x: 10, y: 20 });
  });
});

describe("workspace state KV adapter", () => {
  test("round-trips through the KV namespace", async () => {
    const kv = createMemoryStorage<GpenWorkspaceStorageRecord>();
    const storage = createKvGpenWorkspaceStateStorage(kv);

    expect(await storage.load()).toBeUndefined();
    await storage.save({ ...createDefaultGpenWorkspaceState(), uiScale: 1.75, activeTool: "fill" });
    expect(await storage.load()).toMatchObject({ uiScale: 1.75, activeTool: "fill" });
  });

  test("migration copies legacy data once and then trusts the KV", async () => {
    const kv = createMemoryStorage<GpenWorkspaceStorageRecord>();
    const target = createKvGpenWorkspaceStateStorage(kv);
    let legacyLoads = 0;
    const legacy: GpenWorkspaceStateStorage = {
      async load() {
        legacyLoads += 1;
        return { uiScale: 0.5, activeTool: "picker" };
      },
      async save() {},
    };
    const storage = createMigratingGpenWorkspaceStateStorage(target, legacy);

    const first = await storage.load();
    expect(first).toMatchObject({ uiScale: 0.5, activeTool: "picker" });
    expect(legacyLoads).toBe(1);

    // Second load reads the migrated record from KV and never touches legacy.
    const second = await storage.load();
    expect(second).toMatchObject({ uiScale: 0.5, activeTool: "picker" });
    expect(legacyLoads).toBe(1);
  });

  test("prefers existing KV data over legacy values", async () => {
    const kv = createMemoryStorage<GpenWorkspaceStorageRecord>();
    const target = createKvGpenWorkspaceStateStorage(kv);
    await target.save({ ...createDefaultGpenWorkspaceState(), uiScale: 2 });
    const storage = createMigratingGpenWorkspaceStateStorage(target, {
      async load() {
        return { uiScale: 0.5 };
      },
      async save() {},
    });

    expect(await storage.load()).toMatchObject({ uiScale: 2 });
  });
});

describe("workspace state runtime storage", () => {
  test("persists across instances through the runtime KV", async () => {
    const dbName = uniqueDatabaseName();
    const first = createRuntimeGpenWorkspaceStateStorage({ dbName });
    await first.save({ ...createDefaultGpenWorkspaceState(), uiScale: 1.5, activeTool: "lasso" });
    await first.close?.();

    const second = createRuntimeGpenWorkspaceStateStorage({ dbName });
    expect(await second.load()).toMatchObject({ uiScale: 1.5, activeTool: "lasso" });
    await second.close?.();
  });

  test("migrates the legacy localStorage record into the runtime KV", async () => {
    const dbName = uniqueDatabaseName();
    const local = installLocalStorage({
      [GPEN_WORKSPACE_STATE_KEY]: JSON.stringify({ version: 1, activeTool: "transform" }),
      [GPEN_UI_SCALE_KEY]: "1.5",
    });

    const first = createRuntimeGpenWorkspaceStateStorage({ dbName });
    expect(await first.load()).toMatchObject({ uiScale: 1.5, activeTool: "transform" });
    await first.close?.();

    // The legacy keys are only a migration source: clearing them must not lose
    // the preference once the KV has the record.
    local.clear();
    const second = createRuntimeGpenWorkspaceStateStorage({ dbName });
    expect(await second.load()).toMatchObject({ uiScale: 1.5, activeTool: "transform" });
    await second.close?.();
  });
});
