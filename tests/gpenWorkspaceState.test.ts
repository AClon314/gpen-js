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
