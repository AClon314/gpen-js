import { createBlobBackend, createBlobFallbackBackend, type HookedBlobBackend } from "./blob.js";
import {
  createIndexedDbBlobBackend,
  openStorageDatabase,
  type WebsiteStorageOptions,
} from "./website.js";
import { createKvStorage } from "./kv.js";
import { createOpfsTabBusBlobBackend } from "./opfs.js";
import type { JsonValue, KvBackend, Storage } from "./types.js";

export interface BrowserStorageApi {
  get(keys?: null | string | string[]): Promise<Record<string, JsonValue>>;
  set(items: Record<string, JsonValue>): Promise<void>;
}

export interface BrowserStorageOptions<
  T extends JsonValue = JsonValue,
> extends WebsiteStorageOptions<T> {
  storageKey?: string;
  browser?: BrowserStorageApi;
}

interface BrowserExtensionApi {
  storage?: {
    local?: BrowserStorageApi;
  };
}

export function getBrowserStorage(api?: BrowserStorageApi): BrowserStorageApi | undefined {
  if (api) return api;
  const globalObject = globalThis as typeof globalThis & {
    browser?: BrowserExtensionApi;
    chrome?: BrowserExtensionApi;
  };
  return globalObject.browser?.storage?.local ?? globalObject.chrome?.storage?.local;
}

export function createBrowserKvBackend<T extends JsonValue>(
  area: BrowserStorageApi,
  storageKey: string,
): KvBackend<T> {
  return {
    name: "browser.storage.local",
    async load() {
      const values = await area.get(null);
      return (values[storageKey] ?? {}) as T;
    },
    async save(value) {
      await area.set({ [storageKey]: value });
    },
  };
}

export function createBrowserStorage<T extends JsonValue = JsonValue>(
  options: BrowserStorageOptions<T> = {},
): Storage<T, HookedBlobBackend> {
  const area = getBrowserStorage(options.browser);
  if (!area) throw new Error("WebExtension storage.local is unavailable in this runtime");

  const dbPromise = openStorageDatabase(options);
  const storageKey = options.storageKey ?? "gpen";
  const blobBackend = createBlobFallbackBackend(
    createOpfsTabBusBlobBackend({ targetDomain: options.targetDomain }),
    createIndexedDbBlobBackend(dbPromise, options),
  );
  const blob = createBlobBackend(blobBackend, { hooks: options.blobHooks });

  return {
    kv: createKvStorage(createBrowserKvBackend<T>(area, storageKey), options),
    blob,
    close: async () => {
      await blobBackend.close();
      (await dbPromise).close();
    },
  };
}
