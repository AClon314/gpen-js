import "fake-indexeddb/auto";

import { describe, expect, test } from "bun:test";
import {
  asExternalUrl,
  bindBlobToKv,
  createBlobBackend,
  createBlobFallbackBackend,
  createBlobKvSyncHooks,
  createGpenBinaryStore,
  createKvBackend,
  createKvStorage,
  createMemoryBlobBackend,
  createMemoryKvBackend,
  createOpfsTabBusBlobBackend,
  createTabBusBlobBackend,
  createTabBusBlobBroker,
  createVscodeStorage,
  deepClone,
  deleteAtPath,
  GpenStorageError,
  listKeysAtPath,
  setAtPath,
  splitBlobId,
  type BlobBackend,
  type GpenKvRoot,
  type JsonValue,
  type StoragePathKey,
} from "../src/lib/bindings/storage/index.ts";
import type { ITabBus, TabBusMessage } from "../src/lib/crossTabBus/index.ts";

/**
 * 内存 loopback bus：`send` 直接派发给所有监听者。用于把
 * `createTabBusBlobBackend` 与 `createTabBusBlobBroker` 接在同一条链路上。
 */
function createLoopbackBus(): ITabBus {
  const listeners = new Set<(message: TabBusMessage) => void>();
  return {
    async send(type, payload) {
      for (const listener of listeners) listener({ type, payload });
    },
    onMessage(callback) {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    destroy() {
      listeners.clear();
    },
  };
}

/** 记录调用顺序的 KV，用来断言 hook 的副作用。 */
function recordingKv() {
  const calls: string[] = [];
  return { calls, kv: createKvBackend() };
}

describe("characterization — Blob backend", () => {
  test("accepts every overload and keeps the memory fallback", async () => {
    for (const blob of [
      createBlobBackend(),
      createBlobBackend({}),
      createBlobBackend(createMemoryBlobBackend()),
      createBlobBackend(createMemoryBlobBackend(), {}),
    ]) {
      await blob.set("a/b", new Blob(["x"]));
      expect(await (await blob.get("a/b"))?.text()).toBe("x");
      await blob.del("a/b");
      expect(await blob.get("a/b")).toBeUndefined();
    }
    const explicit = createBlobBackend();
    expect(explicit.name).toBe("memory:blob");
  });

  test("drills into paths with get / set / delete and accepts ids", async () => {
    const blob = createBlobBackend();
    await blob.set.pathA.pathB(new Blob(["nested"]));
    expect(await (await blob.get.pathA.pathB)?.text()).toBe("nested");
    expect(await (await blob.get("pathA/pathB"))?.text()).toBe("nested");
    await blob.delete.pathA.pathB;
    expect(await blob.get.pathA.pathB).toBeUndefined();
  });

  test("rejects malformed accessor arguments with TypeError", async () => {
    const blob = createBlobBackend();
    await expect((blob.get as (id: string) => Promise<unknown>)()).rejects.toThrow(
      "Blob get accepts exactly one id",
    );
    await expect(
      (blob.set as (id: string, value?: Blob) => Promise<unknown>)("only-an-id"),
    ).rejects.toThrow("Blob set accepts an id, Blob, and optional options");
    await expect(
      (blob.delete as unknown as (a: string, b: string) => Promise<unknown>)("a", "b"),
    ).rejects.toThrow("Blob delete accepts exactly one id");
  });

  test("infers source from a File-like path property only when no option was given", async () => {
    const blob = createBlobBackend();
    const seen: Array<string | undefined> = [];
    blob.proxy.setters.capture = ({ options }) => {
      seen.push(options?.source);
    };
    const file = Object.assign(new Blob(["data"]), { path: "/work/inferred.bin" });
    await blob.set("inferred.bin", file);
    await blob.set("explicit.bin", file, { source: "/work/explicit.bin" });
    expect(seen).toEqual(["/work/inferred.bin", "/work/explicit.bin"]);
  });

  test("lets getters rewrite the value and shows self/path/id to hooks", async () => {
    const blob = createBlobBackend();
    const seen: string[] = [];
    blob.proxy.getters.rewrite = ({ id, path, self }) => {
      seen.push(`${id}|${path.join(".")}|${self === blob}`);
      return new Blob(["rewritten"]);
    };
    await blob.set("a/b/c", new Blob(["original"]));
    expect(await (await blob.get.a.b.c)?.text()).toBe("rewritten");
    expect(seen).toEqual(["a/b/c|a.b.c|true"]);
  });

  test("closes the wrapped backend once", async () => {
    let closes = 0;
    const backend: BlobBackend & { close(): Promise<void> } = {
      name: "counted",
      async set() {},
      async get() {
        return undefined;
      },
      async delete() {},
      async close() {
        closes += 1;
      },
    };
    const blob = createBlobBackend(backend);
    await blob.close();
    expect(closes).toBe(1);
  });

  test("splitBlobId rejects traversal and empty segments", () => {
    expect(splitBlobId("a/b")).toEqual(["a", "b"]);
    for (const bad of ["", ".", "..", "a/../b", "a//b", "a\\b"]) {
      expect(() => splitBlobId(bad)).toThrow("relative path");
    }
  });
});

describe("characterization — Blob fallback selection", () => {
  test("uses the preferred backend once ready resolves", async () => {
    let readyCalls = 0;
    const preferred = {
      ...createMemoryBlobBackend(),
      name: "preferred",
      async ready() {
        readyCalls += 1;
      },
    };
    const fallback = createMemoryBlobBackend();
    const blob = createBlobFallbackBackend(preferred, fallback);
    expect(blob.name).toBe("preferred|fallback:memory:blob");
    await blob.set("k", new Blob(["preferred"]));
    await blob.set("k2", new Blob(["preferred"]));
    expect(readyCalls).toBe(1);
    expect(await (await blob.get("k"))?.text()).toBe("preferred");
    await blob.close();
  });

  test("keeps I/O errors after initialization visible instead of switching", async () => {
    const preferred = {
      ...createMemoryBlobBackend(),
      name: "preferred",
      async ready() {},
      async get() {
        throw new Error("disk gone");
      },
    };
    const blob = createBlobFallbackBackend(preferred, createMemoryBlobBackend());
    await expect(blob.get("k")).rejects.toThrow("disk gone");
    await blob.close();
  });

  test("rejects operations and closes idempotently after close", async () => {
    const blob = createBlobFallbackBackend(createMemoryBlobBackend(), createMemoryBlobBackend());
    await blob.close();
    await blob.close();
    await expect(blob.get("k")).rejects.toThrow("Blob backend is closed");
  });
});

describe("characterization — KV JSON validation and path helpers", () => {
  test("rejects non-JSON values synchronously", () => {
    const kv = createKvBackend();
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      () => undefined,
      new Date(),
      new (class Foo {})() as unknown,
    ]) {
      expect(() => kv.set.value(value as JsonValue)).toThrow("KV values must be JSON values");
    }
  });

  test("clones through structuredClone and falls back to JSON", () => {
    const source = { nested: { value: 1 } };
    const clone = deepClone(source);
    clone.nested.value = 2;
    expect(source.nested.value).toBe(1);

    const original = globalThis.structuredClone;
    // @ts-expect-error 临时移除，覆盖 JSON 回退分支
    delete globalThis.structuredClone;
    try {
      const fallback = deepClone({ a: [1, 2] });
      expect(fallback).toEqual({ a: [1, 2] });
    } finally {
      globalThis.structuredClone = original;
    }
  });

  test("setAtPath / deleteAtPath / listKeysAtPath handle edge cases", () => {
    expect(setAtPath({}, [], [1] as JsonValue)).toEqual([1]);
    expect(setAtPath(null as unknown as JsonValue, ["a", 0], "v")).toEqual({ a: ["v"] });
    expect(deleteAtPath({ a: { b: 1 } }, [])).toEqual({});
    expect(deleteAtPath(null as unknown as JsonValue, ["a"])).toBeNull();
    expect(deleteAtPath({ a: 1 }, ["a", "b"])).toEqual({ a: 1 });
    expect(listKeysAtPath({ a: { b: 1, c: 2 } }, ["a"])).toEqual(["b", "c"]);
    expect(listKeysAtPath({ a: 1 }, ["a"])).toEqual([]);
  });

  test("runs named hooks in insertion order and lets get hooks rewrite", async () => {
    const order: string[] = [];
    const kv = createKvStorage(createMemoryKvBackend<{ value?: number }>(), {
      hooks: {
        getters: {
          first: ({ value }) => {
            order.push("get:first");
            return value;
          },
          second: () => {
            order.push("get:second");
            return 42;
          },
        },
        setters: {
          a: () => {
            order.push("set:a");
          },
          b: () => {
            order.push("set:b");
          },
        },
        deleters: {
          d: ({ previousValue }) => {
            order.push(`del:${String(previousValue)}`);
          },
        },
      },
    });

    expect(await kv.get.value).toBe(42);
    expect(order).toEqual(["get:first", "get:second"]);
    await kv.set.value(7);
    expect(order.slice(2)).toEqual(["set:a", "set:b"]);
    order.length = 0;
    await kv.del.value;
    expect(order).toEqual(["del:7"]);
  });

  test("flushes the cache on a true→false transition and reloads on false→true", async () => {
    const backend = createMemoryKvBackend<{ value: number }>({ value: 0 });
    const kv = createKvStorage(backend);
    await kv.set.value(1);
    kv.cache = false;
    await kv.set.value(2);
    expect(await backend.load()).toEqual({ value: 2 });
    kv.cache = true;
    await kv.set.value(3);
    expect(await backend.load()).toEqual({ value: 2 });
    await kv.submit();
    expect(await backend.load()).toEqual({ value: 3 });
  });

  test("enumerates root keys and nested keys", async () => {
    const kv = createKvBackend<{ a: { b: number } }>();
    await kv.set.a.b(1);
    await kv.set.a({ b: 2 });
    await kv.submit();
    expect(await kv.keys()).toEqual(["a"]);
    expect(await kv.get.a.keys()).toEqual(["b"]);
  });

  test("rejects a set node called with more than one argument", async () => {
    const kv = createKvBackend();
    await expect(
      (kv.set.foo as unknown as (...args: unknown[]) => Promise<void>)(1, 2),
    ).rejects.toThrow("A set node accepts exactly one argument");
  });
});

describe("characterization — Blob↔KV sync hooks", () => {
  test("supports record builders, resolver functions and custom keys", async () => {
    const { kv } = recordingKv();
    const blob = bindBlobToKv(createBlobBackend(), {
      kv,
      recordPath: ({ id }) => ["files", ...splitBlobId(id)],
      key: () => "entry",
      record: ({ key, recordPath, value }) => ({
        key,
        path: [...recordPath],
        size: value.size,
      }),
    });

    await blob.set("models/latest.bin", new Blob(["1234"]));
    const record = await kv.get.files["models"]["latest.bin"]["entry"];
    expect(record).toEqual({
      key: "entry",
      path: ["files", "models", "latest.bin", "entry"],
      size: 4,
    });

    await blob.delete("models/latest.bin");
    expect(await kv.get.files["models"]["latest.bin"]["entry"]).toBeUndefined();
  });

  test("can keep records on delete and skip automatic submit", async () => {
    const backend = createMemoryKvBackend<Record<string, JsonValue>>();
    const kv = createKvStorage(backend);
    const blob = bindBlobToKv(createBlobBackend(), {
      kv,
      submit: false,
      removeOnDelete: false,
    });
    await blob.set("a.bin", new Blob(["x"]), { url: "https://example.test/a.bin" });
    expect(await backend.load()).toEqual({});

    await blob.delete("a.bin");
    await kv.submit();
    expect(await kv.get.blob["a.bin"]).toBe("https://example.test/a.bin");
  });

  test("supports installing only the setter hook", async () => {
    const { kv } = recordingKv();
    const blob = createBlobBackend();
    const hooks = createBlobKvSyncHooks({ kv, removeOnDelete: false });
    blob.proxy.setters = hooks.setters ?? {};
    expect(hooks.deleters).toBeUndefined();
    await blob.set.file(new Blob(["x"]));
    expect(await kv.get.blob.file).toBe("blob:file");
  });

  test("appends the key below an explicit record path array", async () => {
    const kv = createKvBackend<{ meta: { folder: Record<string, string> } }>();
    const blob = bindBlobToKv(createBlobBackend(), {
      kv,
      recordPath: ["meta", "folder"] as StoragePathKey[],
    });
    await blob.set("dir/a.bin", new Blob(["x"]));
    expect(await kv.get.meta.folder["a.bin"]).toBe("blob:dir/a.bin");
  });

  test("renders external URLs for windows, posix and URL-shaped sources", () => {
    expect(asExternalUrl("C:\\work\\m.bin")).toBe("file:///C:/work/m.bin");
    expect(asExternalUrl("/work/m.bin")).toBe("file:///work/m.bin");
    expect(asExternalUrl("https://x/y")).toBe("https://x/y");
  });
});

describe("characterization — tab bus Blob backend", () => {
  test("round-trips Blobs through a broker and deletes them", async () => {
    const bus = createLoopbackBus();
    const host = createMemoryBlobBackend();
    const broker = createTabBusBlobBroker(bus, host);
    const remote = createTabBusBlobBackend(bus, { name: "remote" });

    expect(remote.name).toBe("remote");
    await remote.set("models/latest", new Blob(["binary"], { type: "application/octet-stream" }));
    expect(await (await host.get("models/latest"))?.text()).toBe("binary");
    const loaded = await remote.get("models/latest");
    expect(loaded?.type).toBe("application/octet-stream");
    expect(await loaded?.text()).toBe("binary");
    await remote.delete("models/latest");
    expect(await host.get("models/latest")).toBeUndefined();
    expect(await remote.get("models/latest")).toBeUndefined();

    remote.close();
    broker.destroy();
    bus.destroy();
  });

  test("surfaces broker backend failures to the caller", async () => {
    const bus = createLoopbackBus();
    const failing = {
      ...createMemoryBlobBackend(),
      async set() {
        throw new Error("backend exploded");
      },
    };
    const broker = createTabBusBlobBroker(bus, failing);
    const remote = createTabBusBlobBackend(bus);
    await expect(remote.set("k", new Blob(["x"]))).rejects.toThrow("backend exploded");
    remote.close();
    broker.destroy();
  });

  test("ignores malformed requests", async () => {
    const bus = createLoopbackBus();
    const host = createMemoryBlobBackend();
    const broker = createTabBusBlobBroker(bus, host);
    await bus.send("gpen.storage.blob.request", { nonsense: true });
    await bus.send("gpen.storage.blob.request", null);
    broker.destroy();
    expect(await host.get("anything")).toBeUndefined();
  });

  test("rejects a non-positive timeout and closed clients", async () => {
    expect(() => createTabBusBlobBackend(createLoopbackBus(), { timeoutMs: 0 })).toThrow(
      "positive finite number",
    );
    const remote = createTabBusBlobBackend(createLoopbackBus(), { timeoutMs: 20 });
    remote.close();
    await expect(remote.get("k")).rejects.toThrow("closed");
  });

  test("stops responding after destroy", async () => {
    const bus = createLoopbackBus();
    const broker = createTabBusBlobBroker(bus, createMemoryBlobBackend());
    broker.destroy();
    const remote = createTabBusBlobBackend(bus, { timeoutMs: 20 });
    await expect(remote.get("k")).rejects.toThrow("timed out");
    remote.close();
  });
});

describe("characterization — Gpen binary store", () => {
  test("validates metadata shapes with distinct diagnostics", async () => {
    const storage = createMemoryBlobBackend();
    const kv = createKvStorage(createMemoryKvBackend<GpenKvRoot>());
    const store = createGpenBinaryStore({ kv, blob: storage });
    const cases: Array<[unknown, string]> = [
      [null, "metadata entry is not a JSON object"],
      [[], "metadata entry is not a JSON object"],
      [{ document_id: "other" }, "does not match the requested id"],
      [
        { document_id: "x", schema_version: "v1", codec_version: 1 },
        "size must be a non-negative integer",
      ],
      [
        { document_id: "x", schema_version: "v1", codec_version: 1, size: -1 },
        "size must be a non-negative integer",
      ],
      [
        { document_id: "x", schema_version: "v1", codec_version: 1, size: 1 },
        "updated_at must be a string",
      ],
      [
        { document_id: "x", schema_version: "v1", codec_version: 1, size: 1, updated_at: "t" },
        "blob reference must be a non-empty string",
      ],
    ];
    for (const [value, message] of cases) {
      await kv.set.gpen["x"](value as JsonValue);
      await kv.submit();
      const error = await store.load("x").then(
        () => undefined,
        (cause: unknown) => cause as GpenStorageError,
      );
      expect(error).toBeInstanceOf(GpenStorageError);
      expect(error?.message).toContain(message);
    }
  });

  test("delete still removes malformed metadata entries", async () => {
    const kv = createKvStorage(createMemoryKvBackend<GpenKvRoot>());
    const blob = createMemoryBlobBackend();
    const store = createGpenBinaryStore({ kv, blob });
    await kv.set.gpen["broken"]({ document_id: "broken", size: "nope" } as unknown as JsonValue);
    await kv.submit();

    await store.del("broken");
    expect(await store.getMetadata("broken")).toBeUndefined();
  });

  test("rejects a negative debounce interval", () => {
    expect(() =>
      createGpenBinaryStore({
        kv: createKvStorage(createMemoryKvBackend<GpenKvRoot>()),
        blob: createMemoryBlobBackend(),
        debounceMs: -1,
      }),
    ).toThrow("non-negative finite number");
  });

  test("returns a placeholder metadata snapshot before the trailing write", async () => {
    const kv = createKvStorage(createMemoryKvBackend<GpenKvRoot>());
    const store = createGpenBinaryStore({
      kv,
      blob: createMemoryBlobBackend(),
      cache: true,
      debounceMs: 1000,
    });
    const { GpenT } = await import("gpen-protocol/flatbuffers");
    const snapshot = await store.save("doc", new GpenT());
    expect(snapshot).toMatchObject({ document_id: "doc", size: 0, blob: "gpen/doc.bin" });
    store.dispose();
  });

  test("commits pending writes before sending a cross-tab message", async () => {
    const sent: string[] = [];
    const bus: ITabBus = {
      async send(type) {
        sent.push(type);
      },
      onMessage() {
        return () => undefined;
      },
      destroy() {},
    };
    const kv = createKvStorage(createMemoryKvBackend<GpenKvRoot>());
    const { GpenT } = await import("gpen-protocol/flatbuffers");
    const store = createGpenBinaryStore({
      kv,
      blob: createMemoryBlobBackend(),
      crossTabBus: bus,
      cache: true,
      debounceMs: 1000,
    });
    await store.save("doc", new GpenT());
    await store.sendCrossTab("gpen.test", { ok: true });
    expect(sent).toEqual(["gpen.test"]);
    expect(await store.getMetadata("doc")).toBeDefined();
    store.dispose();
  });

  test("refuses operations after dispose and without a bus", async () => {
    const kv = createKvStorage(createMemoryKvBackend<GpenKvRoot>());
    const { GpenT } = await import("gpen-protocol/flatbuffers");
    const store = createGpenBinaryStore({ kv, blob: createMemoryBlobBackend() });
    await expect(store.sendCrossTab("x", {})).rejects.toThrow("crossTabBus was not configured");
    store.dispose();
    store.dispose();
    await expect(store.load("doc")).rejects.toThrow("disposed");
    await expect(store.save("doc", new GpenT())).rejects.toThrow("disposed");
  });
});

describe("characterization — VS Code JSONC state", () => {
  test("parses comments and trailing commas in .gpen/state.jsonc", async () => {
    const files = new Map<string, Uint8Array>();
    files.set(
      ".gpen/state.jsonc",
      new TextEncoder().encode(
        `{\n  // line comment\n  "profile": { "name": "Ada" /* block */, },\n  "items": [1, 2, /* trailing */],\n}`,
      ),
    );
    const storage = createVscodeStorage<{ profile: { name: string }; items: number[] }>({
      host: {
        fileSystem: {
          async mkdir() {},
          async write(path, data) {
            files.set(path, new Uint8Array(data));
          },
          async read(path) {
            const data = files.get(path);
            return data === undefined ? undefined : new Uint8Array(data);
          },
          async remove(path) {
            files.delete(path);
          },
        },
      },
    });

    expect(await storage.kv.get.profile.name).toBe("Ada");
    expect(await storage.kv.get.items[1]).toBe(2);
  });
});

describe("characterization — OPFS tab bus backend guards", () => {
  test("requires a browser document with a real origin", async () => {
    const noDocument = createOpfsTabBusBlobBackend({ document: undefined });
    await expect(noDocument.set("k", new Blob(["x"]))).rejects.toThrow(
      "requires a browser document",
    );

    const opaque = createOpfsTabBusBlobBackend({
      document: { defaultView: { location: { origin: "null" } } } as unknown as Document,
    });
    await expect(opaque.set("k", new Blob(["x"]))).rejects.toThrow("non-opaque page origin");
  });

  test("rejects work after close", async () => {
    const backend = createOpfsTabBusBlobBackend({ document: undefined });
    await backend.close();
    await expect(backend.ready()).rejects.toThrow("closed");
  });
});
