import {
  createBlobBackend,
  createBlobFallbackBackend,
  type BlobStorageOptions,
  type HookedBlobBackend,
} from "./blob.js";
import { createKvStorage, type KvStorageOptions } from "./kv.js";
import { createIndexedDbBlobBackend, openStorageDatabase } from "./website.js";
import { createOpfsTabBusBlobBackend } from "./opfs.js";
import type { JsonValue, Storage } from "./types.js";

export interface MonkeyStorageApi {
  getValue<T extends JsonValue>(key: string, defaultValue: T): T | PromiseLike<T>;
  setValue<T extends JsonValue>(key: string, value: T): void | PromiseLike<void>;
  deleteValue?(key: string): void | PromiseLike<void>;
  listValues?(): string[] | PromiseLike<string[]>;
}

export interface MonkeyStorageOptions<T extends JsonValue = JsonValue>
  extends KvStorageOptions<T>, BlobStorageOptions {
  storageKey?: string;
  monkey?: MonkeyStorageApi;
}

export function getMonkeyStorageApi(api?: MonkeyStorageApi): MonkeyStorageApi | undefined {
  if (api) return api;

  const globalObject = globalThis as typeof globalThis & {
    GM_getValue?: (key: string, defaultValue?: unknown) => unknown;
    GM_setValue?: (key: string, value: unknown) => unknown;
    GM_deleteValue?: (key: string) => unknown;
    GM_listValues?: () => string[] | PromiseLike<string[]>;
    GM?: {
      getValue?: (key: string, defaultValue?: unknown) => unknown;
      setValue?: (key: string, value: unknown) => unknown;
      deleteValue?: (key: string) => unknown;
      listValues?: () => string[] | PromiseLike<string[]>;
    };
  };
  if (
    typeof globalObject.GM_getValue === "function" &&
    typeof globalObject.GM_setValue === "function"
  ) {
    return {
      getValue: async <T extends JsonValue>(key: string, defaultValue: T) =>
        (await globalObject.GM_getValue!(key, defaultValue)) as T,
      setValue: async (key, value) => {
        await globalObject.GM_setValue!(key, value);
      },
      deleteValue:
        typeof globalObject.GM_deleteValue === "function"
          ? async (key) => {
              await globalObject.GM_deleteValue!(key);
            }
          : undefined,
      listValues:
        typeof globalObject.GM_listValues === "function"
          ? async () => await globalObject.GM_listValues!()
          : undefined,
    };
  }

  const namespaced = globalObject.GM;
  if (typeof namespaced?.getValue === "function" && typeof namespaced.setValue === "function") {
    return {
      getValue: async <T extends JsonValue>(key: string, defaultValue: T) =>
        (await namespaced.getValue!(key, defaultValue)) as T,
      setValue: async (key, value) => {
        await namespaced.setValue!(key, value);
      },
      deleteValue:
        typeof namespaced.deleteValue === "function"
          ? async (key) => {
              await namespaced.deleteValue!(key);
            }
          : undefined,
      listValues:
        typeof namespaced.listValues === "function"
          ? async () => await namespaced.listValues!()
          : undefined,
    };
  }

  return undefined;
}

export function createMonkeyStorage<T extends JsonValue = JsonValue>(
  options: MonkeyStorageOptions<T> = {},
): Storage<T, HookedBlobBackend> {
  const api = getMonkeyStorageApi(options.monkey);
  if (!api) throw new Error("Userscript GM storage is unavailable in this runtime");

  const key = options.storageKey ?? "gpen";
  const kv = {
    name: "userscript:gm",
    async load() {
      const value = await api.getValue<T>(key, {} as T);
      return (value === undefined ? {} : value) as T;
    },
    async save(value: T) {
      await api.setValue(key, value);
    },
  };

  const fallbackDbPromise = openStorageDatabase();
  const blobBackend = createBlobFallbackBackend(
    createOpfsTabBusBlobBackend({ targetDomain: options.targetDomain }),
    createIndexedDbBlobBackend(fallbackDbPromise),
  );
  const blob = createBlobBackend(blobBackend, { hooks: options.blobHooks });

  return {
    kv: createKvStorage(kv, options),
    blob,
    close: async () => {
      await blobBackend.close();
      (await fallbackDbPromise.catch(() => undefined))?.close();
    },
  };
}
