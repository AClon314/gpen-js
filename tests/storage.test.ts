import "fake-indexeddb/auto";

import { describe, expect, test } from "bun:test";
import {
  createKvStorage,
  createBlobFallbackBackend,
  createMemoryBlobBackend,
  createMemoryKvBackend,
  createMemoryStorage,
  createKvBackend,
  createRuntimeStorage,
  createBlobBackend,
  asExternalUrl,
  bindBlobToKv,
  createBlobKvSyncHooks,
  createTabBusBlobBackend,
  createTabBusBlobBroker,
  deepClone,
  isBlobBackend,
  setAtPath,
  type JsonValue,
  type VscodeStorageBridge,
  type VscodeStorageRequest,
} from "../src/lib/bindings/storage/index.ts";
import { CrossOriginBus } from "../src/lib/crossTabBus/index.ts";
import {
  createMonkeyUploadDownloadSelector,
  type MonkeyDownloadDetails,
} from "../src/lib/bindings/upDownloader/index.ts";

type TestState = {
  profile: {
    name: string;
  };
  items: Array<{
    label: string;
  }>;
  visits: number;
};

describe("storage", () => {
  test("composes independent KV and Blob services into a plain object", async () => {
    const storage = {
      kv: createKvStorage(createMemoryKvBackend<{ value: number }>()),
      blob: createMemoryBlobBackend(),
    };

    expect(Object.keys(storage)).toEqual(["kv", "blob"]);
    await storage.kv.set.value(4);
    await storage.kv.submit();
    await storage.blob.set?.("payload", new Blob(["blob"]));

    expect(await storage.kv.get.value).toBe(4);
    expect(await (await storage.blob.get?.("payload"))?.text()).toBe("blob");
  });

  test("falls back only when the preferred Blob backend cannot initialize", async () => {
    const fallback = createMemoryBlobBackend();
    const preferred = {
      ...createMemoryBlobBackend(),
      name: "preferred:blob",
      async ready() {
        throw new Error("preferred backend unavailable");
      },
    };
    const blob = createBlobFallbackBackend(preferred, fallback);

    await blob.set("payload", new Blob(["fallback"]));
    expect(await (await blob.get("payload"))?.text()).toBe("fallback");
    await blob.close();
  });

  test("selects an injected browser API and exposes separate KV/Blob services", async () => {
    let values: Record<string, JsonValue> = {};
    const storage = createRuntimeStorage<{ visits: number }>({
      dbName: `gpen-browser-test-${Date.now()}`,
      version: "0.1.0-alpha",
      versionNum: [0, 1, 0],
      browser: {
        async get() {
          return values;
        },
        async set(items) {
          values = { ...values, ...items };
        },
      },
    });

    expect(storage.kv.name).toBe("browser.storage.local");
    expect(typeof storage.blob.set).toBe("function");
    await storage.kv.set.visits(2);
    expect(values.gpen).toBeUndefined();
    await storage.kv.submit();
    expect(values.gpen).toEqual({ visits: 2 });

    await storage.close?.();
  });

  test("reads and writes explicit paths", async () => {
    const storage = createMemoryStorage<TestState>();

    expect(await storage.kv.get.profile.name).toBeUndefined();
    await storage.kv.set.profile.name("Ada");
    await storage.kv.set.visits(1);
    await storage.kv.submit();

    expect(await storage.kv.get.profile.name).toBe("Ada");
    expect(await storage.kv.get.visits).toBe(1);
    expect(await storage.kv.keys()).toEqual(["profile", "visits"]);
  });

  test("runs a function initializer once and persists its prepared value", async () => {
    const backend = createMemoryKvBackend<{ version: number; name: string }>({
      version: 1,
      name: "old",
    });
    let calls = 0;
    const store = createKvStorage(backend, {
      initValue(oldValue) {
        calls += 1;
        return { version: 2, name: oldValue.name.toUpperCase() };
      },
    });

    expect(await store.get.name).toBe("old");
    await store.set.name("new");
    expect(await store.get.name).toBe("old");
    expect(calls).toBe(1);
    await store.submit();
    expect(await backend.load()).toEqual({ version: 2, name: "new" });
  });

  test("runs a promise initializer once when cache is disabled", async () => {
    const backend = createMemoryKvBackend<{ value: number; other?: number }>({ value: 1 });
    let resolved = 0;
    const initial = Promise.resolve({ value: 2, other: 0 }).then((value) => {
      resolved += 1;
      return value;
    });
    const store = createKvStorage(backend, { cache: false, initValue: initial });

    await store.set.other(4);
    await store.set.value(5);

    expect(resolved).toBe(1);
    expect(await backend.load()).toEqual({ value: 5, other: 4 });
  });

  test("can opt out of caching for immediate persistence", async () => {
    const backend = createMemoryKvBackend<{ value: number }>();
    const store = createKvStorage(backend, { cache: false });
    await store.set.value(4);

    expect(await store.get.value).toBe(4);
    await store.del.value;
    expect(await backend.load()).toEqual({} as { value: number });
  });

  test("switches cache mode at runtime without losing pending data", async () => {
    const backend = createMemoryKvBackend<{ value: number; other?: number }>({ value: 0 });
    const store = createKvStorage(backend);

    expect(store.cache).toBe(true);
    await store.set.value(1);
    expect(await backend.load()).toEqual({ value: 0 });

    store.cache = false;
    expect(store.cache).toBe(false);
    await store.set.other(2);
    expect(await backend.load()).toEqual({ value: 1, other: 2 });

    store.cache = true;
    await store.set.value(3);
    expect(await backend.load()).toEqual({ value: 1, other: 2 });
    await store.submit();
    expect(await backend.load()).toEqual({ value: 3, other: 2 });
  });

  test("moves Blob bytes through the tabBus broker as ArrayBuffer", async () => {
    const channel = new MessageChannel();
    const clientBus = new CrossOriginBus({ port: channel.port1 });
    const hostBus = new CrossOriginBus({ port: channel.port2 });
    await Promise.all([clientBus.ready, hostBus.ready]);
    const hostStorage = createMemoryStorage();
    const broker = createTabBusBlobBroker(hostBus, hostStorage.blob);
    const remote = createTabBusBlobBackend(clientBus);

    await remote.set("models/latest", new Blob(["binary"], { type: "application/octet-stream" }));
    expect(await (await remote.get("models/latest"))?.text()).toBe("binary");

    remote.close();
    broker.destroy();
    clientBus.destroy();
    hostBus.destroy();
  });

  test("times out when a Blob broker does not answer", async () => {
    const channel = new MessageChannel();
    const clientBus = new CrossOriginBus({ port: channel.port1 });
    const unusedBus = new CrossOriginBus({ port: channel.port2 });
    await Promise.all([clientBus.ready, unusedBus.ready]);
    const remote = createTabBusBlobBackend(clientBus, { timeoutMs: 10 });

    await expect(remote.get("missing")).rejects.toThrow("timed out");
    remote.close();
    clientBus.destroy();
    unusedBus.destroy();
  });

  test("supports sparse array paths and persisted key enumeration", async () => {
    const storage = createMemoryStorage<TestState>();

    await storage.kv.set.items[2].label("third");
    await storage.kv.submit();

    expect(await storage.kv.get.items[2].label).toBe("third");
    expect(await storage.kv.get.items.keys()).toEqual(["2"]);
    expect(await storage.kv.get.items[0].label).toBeUndefined();

    await storage.kv.del.items[2];
    expect(await storage.kv.get.items.keys()).toEqual([]);
  });

  test("stores Blob data separately from KV metadata", async () => {
    const storage = createMemoryStorage<TestState>();

    await storage.kv.set.profile.name("Ada");
    await storage.kv.del.profile;
    await storage.kv.submit();
    expect(await storage.kv.get.profile).toBeUndefined();

    const blob = new Blob(["hello storage"], { type: "text/plain" });
    await storage.blob.set?.("notes/hello", blob);
    const loaded = await storage.blob.get?.("notes/hello");
    expect(loaded).toBeInstanceOf(Blob);
    expect(await loaded?.text()).toBe("hello storage");

    await storage.blob.delete?.("notes/hello");
    expect(await storage.blob.get?.("notes/hello")).toBeUndefined();
  });

  test("synchronizes Blob references to KV and removes stale records", async () => {
    const kv = createKvBackend();
    const blob = bindBlobToKv(createBlobBackend(), { kv });

    await blob.set("attachments/model.bin", new Blob(["data"]), {
      source: "/work/model.bin",
    });
    expect(await kv.get.blob["model.bin"]).toBe("file:///work/model.bin");

    await blob.delete("attachments/model.bin");
    expect(await kv.get.blob["model.bin"]).toBeUndefined();

    const fileWithPath = Object.assign(new Blob(["data"]), { path: "/work/inferred.bin" });
    await blob.set("attachments/inferred.bin", fileWithPath);
    expect(await kv.get.blob["inferred.bin"]).toBe("file:///work/inferred.bin");
    expect(asExternalUrl("C:\\work\\model.bin")).toBe("file:///C:/work/model.bin");
  });

  test("can install Blob-to-KV hooks into a mutable Blob proxy", async () => {
    const kv = createKvBackend();
    const blob = createBlobBackend();
    blob.proxy.setters = createBlobKvSyncHooks({ kv }).setters ?? {};

    await blob.set.pathA.pathB(new Blob(["data"]), { url: "ftp://example.test/model.bin" });
    expect(await kv.get.blob.pathB).toBe("ftp://example.test/model.bin");
  });

  test("keeps cloning explicit and supports root replacement", async () => {
    const source = { nested: { value: 1 } };
    const clone = deepClone(source);
    clone.nested.value = 2;
    expect(source.nested.value).toBe(1);

    const replaced = setAtPath({}, [], ["root"] as JsonValue);
    expect(replaced).toEqual(["root"]);
  });

  test("selects the userscript backend and transfers files through GM_download", async () => {
    const values = new Map<string, JsonValue>();
    let downloadDetails: MonkeyDownloadDetails | undefined;
    const storage = createRuntimeStorage<{ profile: { name: string } }>({
      storageKey: "prefs",
      monkey: {
        async getValue<T extends JsonValue>(key: string, defaultValue: T) {
          return (values.get(key) ?? defaultValue) as T;
        },
        async setValue<T extends JsonValue>(key: string, value: T) {
          values.set(key, value);
        },
      },
    });

    expect(storage.kv.name).toBe("userscript:gm");
    expect(storage.blob.name).toContain("opfs+tabbus:");
    expect(isBlobBackend(storage.blob)).toBe(true);
    await storage.kv.set.profile.name("Ada");
    await storage.kv.submit();
    expect(values.get("prefs")).toEqual({ profile: { name: "Ada" } });

    const file = new File(["data"], "model.bin", { type: "application/octet-stream" });
    const input = { type: "file", files: [file] } as unknown as HTMLInputElement;
    const selector = createMonkeyUploadDownloadSelector((details) => {
      downloadDetails = details;
      details.onload?.();
    });
    expect(selector.upload(input)).toBe(file);
    await selector.download(file, "model.bin");
    expect(downloadDetails?.name).toBe("model.bin");
    expect(downloadDetails?.url).toMatch(/^blob:/);
    await storage.blob.set("model.bin", file);
    expect(await (await storage.blob.get("model.bin"))?.text()).toBe("data");
    await storage.close?.();

    const noDownloadStorage = createRuntimeStorage<{ profile: { name: string } }>({
      monkey: {
        async getValue<T extends JsonValue>(_key: string, defaultValue: T) {
          return defaultValue;
        },
        async setValue<T extends JsonValue>(_key: string, _value: T) {},
      },
    });
    await expect(
      createMonkeyUploadDownloadSelector().download("https://example.com/model.bin", "model.bin"),
    ).rejects.toThrow("GM_download is unavailable");
    await noDownloadStorage.close?.();
  });

  test("uses VS Code state.jsonc and writes blobs below .gpen/blob", async () => {
    const paths: string[] = [];
    const files = new Map<string, Uint8Array>();
    const storage = createRuntimeStorage<{ profile: { name: string } }>({
      storageKey: "prefs",
      host: {
        fileSystem: {
          async mkdir(path: string) {
            paths.push(path);
          },
          async write(path: string, data: Uint8Array) {
            files.set(path, new Uint8Array(data));
          },
          async read(path: string) {
            const data = files.get(path);
            return data === undefined ? undefined : new Uint8Array(data);
          },
          async remove(path: string) {
            files.delete(path);
          },
        },
      },
    });

    expect(storage.kv.name).toBe("vscode:workspace/.gpen/state.jsonc");
    await storage.kv.set.profile.name("Ada");
    expect(files.has(".gpen/state.jsonc")).toBe(false);
    await storage.kv.submit();
    expect(new TextDecoder().decode(files.get(".gpen/state.jsonc"))).toContain('"name": "Ada"');

    if (!isBlobBackend(storage.blob)) throw new Error("Blob backend is unavailable");
    await storage.blob.set("model/latest.bin", new Blob(["hello"]));
    expect(paths).toEqual([".gpen", ".gpen", ".gpen/blob", ".gpen/blob/model"]);
    expect(files.has(".gpen/blob/model/latest.bin")).toBe(true);
    expect(await (await storage.blob.get("model/latest.bin"))?.text()).toBe("hello");
    await expect(storage.blob.get("../outside")).rejects.toThrow("relative path");
  });

  test("uses the VS Code bridge for webview storage", async () => {
    let state: JsonValue = {};
    const bridge: VscodeStorageBridge = {
      async request<T>(message: Omit<VscodeStorageRequest, "type" | "id">) {
        if (message.operation === "kv.load") return state as T;
        if (message.operation === "kv.save") {
          state = message.value ?? {};
          return undefined as T;
        }
        return undefined as T;
      },
    };
    const storage = createRuntimeStorage<{ visits: number }>({ bridge, scope: "global" });

    expect(storage.kv.name).toBe("vscode:globalState");
    await storage.kv.set.visits(3);
    await storage.kv.submit();
    expect(await storage.kv.get.visits).toBe(3);
  });
});
