import "fake-indexeddb/auto";

import { describe, expect, test } from "bun:test";
import { createRuntimeStorage, createWebsiteStorage } from "../src/lib/bindings/storage/index.ts";

type WebsiteState = {
  profile: {
    name: string;
  };
  visits: number;
};

let databaseSequence = 0;

function uniqueDatabaseName(): string {
  databaseSequence += 1;
  return `gpen-website-test-${databaseSequence}`;
}

describe("website IndexedDB backend", () => {
  test("persists KV values and Blob values across storage instances", async () => {
    const options = {
      dbName: uniqueDatabaseName(),
      kvKey: "website-state",
      version: "0.1.0-alpha",
      versionNum: [0, 1, 0] as const,
    };
    const storage = createWebsiteStorage<WebsiteState>(options);

    await storage.kv.set.profile.name("Ada");
    await storage.kv.set.visits(3);
    await storage.kv.submit();
    await storage.blob.set?.(
      "notes/hello.txt",
      new Blob(["hello from IndexedDB"], { type: "text/plain" }),
    );

    expect(await storage.kv.get.profile.name).toBe("Ada");
    expect(await storage.kv.get.visits).toBe(3);
    expect(await storage.kv.keys()).toEqual(["profile", "visits"]);
    expect(await (await storage.blob.get?.("notes/hello.txt"))?.text()).toBe(
      "hello from IndexedDB",
    );
    expect((await storage.blob.get?.("notes/hello.txt"))?.type).toMatch(/^text\/plain/);

    await storage.close?.();

    const reopenedStorage = createWebsiteStorage<WebsiteState>(options);
    expect(await reopenedStorage.kv.get.profile.name).toBe("Ada");
    expect(await reopenedStorage.kv.get.visits).toBe(3);
    expect(await (await reopenedStorage.blob.get?.("notes/hello.txt"))?.text()).toBe(
      "hello from IndexedDB",
    );

    await reopenedStorage.blob.delete?.("notes/hello.txt");
    expect(await reopenedStorage.blob.get?.("notes/hello.txt")).toBeUndefined();
    await reopenedStorage.close?.();
  });

  test("uses separate object stores for KV and Blob", async () => {
    const storage = createWebsiteStorage<{ kind: string }>({
      dbName: uniqueDatabaseName(),
      versionNum: [0, 2, 0],
    });

    await storage.kv.set.kind("website");
    await storage.kv.submit();
    await storage.blob.set?.("payload", new Blob(["blob"]));

    expect(await storage.kv.get.kind).toBe("website");
    expect(await (await storage.blob.get?.("payload"))?.text()).toBe("blob");
    await storage.close?.();
  });

  test("uses versionNum to upgrade the IndexedDB schema", async () => {
    const dbName = uniqueDatabaseName();
    const first = createWebsiteStorage<{ value: number }>({
      dbName,
      kvStoreName: "kv-v1",
      blobStoreName: "blob-v1",
      versionNum: [0, 1, 0],
    });
    await first.kv.set.value(1);
    await first.kv.submit();
    await first.close?.();

    const second = createWebsiteStorage<{ value: number }>({
      dbName,
      kvStoreName: "kv-v2",
      blobStoreName: "blob-v2",
      versionNum: [0, 2, 0],
    });
    await second.kv.set.value(2);
    await second.kv.submit();
    expect(await second.kv.get.value).toBe(2);
    await second.close?.();
  });

  test("runtime selection returns the same composed Storage shape", async () => {
    const storage = createRuntimeStorage<{ value: number }>({
      dbName: uniqueDatabaseName(),
      versionNum: [0, 3, 0],
    });

    expect(Object.keys(storage)).toEqual(["kv", "blob", "close"]);
    expect(storage.kv.name).toBe("indexeddb:kv");
    expect(storage.blob.name).toContain("opfs+tabbus:");
    await storage.close?.();
  });
});
