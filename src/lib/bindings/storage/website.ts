import {
  createBlobBackend,
  createBlobFallbackBackend,
  type BlobStorageOptions,
  type HookedBlobBackend,
} from "./blob.js";
import { createKvStorage, type KvStorageOptions } from "./kv.js";
import { createOpfsTabBusBlobBackend } from "./opfs.js";
import type { BlobBackend, JsonValue, KvBackend, Storage } from "./types.js";

export interface WebsiteStorageOptions<T extends JsonValue = JsonValue>
  extends KvStorageOptions<T>, BlobStorageOptions {
  dbName?: string;
  kvStoreName?: string;
  blobStoreName?: string;
  kvKey?: string;
}

const DEFAULT_DB_NAME = "gpen-storage";
const DEFAULT_KV_STORE = "kv";
const DEFAULT_BLOB_STORE = "blobs";
const DEFAULT_KV_KEY = "root";

function databaseVersion(versionNum: readonly number[] | undefined): number | undefined {
  if (!versionNum) return undefined;
  if (
    versionNum.length === 0 ||
    versionNum.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    throw new RangeError("versionNum must contain non-negative safe integers");
  }

  const version = versionNum.reduce((value, part) => value * 1000 + part, 0);
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError("versionNum cannot be represented as an IndexedDB version");
  }
  return version;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function openStorageDatabase<T extends JsonValue = JsonValue>(
  options: WebsiteStorageOptions<T> = {},
): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is unavailable in this runtime"));
  }

  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const kvStoreName = options.kvStoreName ?? DEFAULT_KV_STORE;
  const blobStoreName = options.blobStoreName ?? DEFAULT_BLOB_STORE;
  const version = databaseVersion(options.versionNum);

  return new Promise((resolve, reject) => {
    const request =
      version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(kvStoreName)) db.createObjectStore(kvStoreName);
      if (!db.objectStoreNames.contains(blobStoreName)) db.createObjectStore(blobStoreName);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab"));
  });
}

export function createIndexedDbKvBackend<T extends JsonValue>(
  dbPromise: Promise<IDBDatabase>,
  options: WebsiteStorageOptions<T> = {},
): KvBackend<T> {
  const storeName = options.kvStoreName ?? DEFAULT_KV_STORE;
  const key = options.kvKey ?? DEFAULT_KV_KEY;

  return {
    name: `indexeddb:${storeName}`,
    async load() {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readonly");
      const value = await requestValue(transaction.objectStore(storeName).get(key));
      return (value as T | undefined) ?? ({} as T);
    },
    async save(value) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value, key);
      await completeTransaction(transaction);
    },
  };
}

export function createIndexedDbBlobBackend<T extends JsonValue = JsonValue>(
  dbPromise: Promise<IDBDatabase>,
  options: WebsiteStorageOptions<T> = {},
): BlobBackend {
  const storeName = options.blobStoreName ?? DEFAULT_BLOB_STORE;

  return {
    name: `indexeddb:${storeName}`,
    async set(id, value) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value, id);
      await completeTransaction(transaction);
    },
    async get(id) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readonly");
      return (await requestValue(transaction.objectStore(storeName).get(id))) as Blob | undefined;
    },
    async delete(id) {
      const db = await dbPromise;
      const transaction = db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(id);
      await completeTransaction(transaction);
    },
  };
}

export function createWebsiteStorage<T extends JsonValue = JsonValue>(
  options: WebsiteStorageOptions<T> = {},
): Storage<T, HookedBlobBackend> {
  const dbPromise = openStorageDatabase(options);
  const blobBackend = createBlobFallbackBackend(
    createOpfsTabBusBlobBackend({ targetDomain: options.targetDomain }),
    createIndexedDbBlobBackend(dbPromise, options),
  );
  const blob = createBlobBackend(blobBackend, { hooks: options.blobHooks });

  return {
    kv: createKvStorage(createIndexedDbKvBackend(dbPromise, options), options),
    blob,
    close: async () => {
      await blobBackend.close();
      (await dbPromise).close();
    },
  };
}
