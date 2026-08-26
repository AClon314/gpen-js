import { createBrowserStorage, getBrowserStorage, type BrowserStorageOptions } from "./browser.js";
import { createBlobBackend, type BlobStorageOptions, type HookedBlobBackend } from "./blob.js";
import { createMonkeyStorage, getMonkeyStorageApi, type MonkeyStorageOptions } from "./monkey.js";
import { createVscodeStorage, hasVscodeStorage, type VscodeStorageOptions } from "./vscode.js";
import { createWebsiteStorage, type WebsiteStorageOptions } from "./website.js";
import { createKvStorage, type KvStorageOptions } from "./kv.js";
import type { BlobBackend, JsonValue, KvBackend, Storage } from "./types.js";
import type { KvStorage } from "./kv.js";

export type MemoryStorageOptions<T extends JsonValue = JsonValue> = KvStorageOptions<T> &
  BlobStorageOptions;

export type RuntimeStorageOptions<T extends JsonValue = JsonValue> = BrowserStorageOptions<T> &
  WebsiteStorageOptions<T> &
  MonkeyStorageOptions<T> &
  VscodeStorageOptions<T>;

export function isBlobBackend(blob: unknown): blob is BlobBackend {
  if (!blob || typeof blob !== "object") return false;
  return (
    "name" in blob &&
    typeof blob.name === "string" &&
    "set" in blob &&
    typeof blob.set === "function" &&
    "get" in blob &&
    typeof blob.get === "function" &&
    "delete" in blob &&
    typeof blob.delete === "function"
  );
}

export function createMemoryKvBackend<T extends JsonValue = JsonValue>(
  initial: T = {} as T,
): KvBackend<T> {
  let root = initial;
  return {
    name: "memory:kv",
    async load() {
      return root;
    },
    async save(value) {
      root = value;
    },
  };
}

/** Create a self-contained in-memory KV service for small integrations and tests. */
export function createKvBackend<T extends JsonValue = JsonValue>(
  initial: T = {} as T,
  options: KvStorageOptions<T> = {},
): KvStorage<T> {
  return createKvStorage(createMemoryKvBackend(initial), options);
}

export function createMemoryBlobBackend(): HookedBlobBackend {
  return createBlobBackend();
}

export function createMemoryStorage<T extends JsonValue = JsonValue>(
  initial: T = {} as T,
  options: MemoryStorageOptions<T> = {},
): Storage<T, HookedBlobBackend> {
  return {
    kv: createKvStorage(createMemoryKvBackend(initial), options),
    blob: createBlobBackend({ hooks: options.blobHooks }),
  };
}

/** Select the environment adapter, then compose it into the common Storage object. */
export function createRuntimeStorage<T extends JsonValue = JsonValue>(
  options: RuntimeStorageOptions<T> = {},
): Storage<T, HookedBlobBackend> {
  if (getMonkeyStorageApi(options.monkey)) return createMonkeyStorage<T>(options);
  if (hasVscodeStorage(options)) return createVscodeStorage<T>(options);
  return getBrowserStorage(options.browser)
    ? createBrowserStorage<T>(options)
    : createWebsiteStorage<T>(options);
}

export type { Storage, BlobBackend, JsonValue, KvBackend } from "./types.js";
export type { BlobSetOptions } from "./types.js";
export { createKvStorage, deepClone, deleteAtPath, listKeysAtPath, setAtPath } from "./kv.js";
export type {
  KvDeleteHook,
  KvDeleteHookContext,
  KvGetHook,
  KvGetHookContext,
  KvInitialValue,
  KvSetHook,
  KvSetHookContext,
  KvStorage,
  KvStorageHooks,
  KvStorageOptions,
  KvStorageProxy,
  StoragePathKey,
} from "./kv.js";

export {
  createBlobBackend,
  createBlobFallbackBackend,
  DEFAULT_BLOB_TARGET_DOMAIN,
  splitBlobId,
} from "./blob.js";
export type {
  BlobDeleteHook,
  BlobDeleteHookContext,
  BlobGetHook,
  BlobGetHookContext,
  BlobGetAccessor,
  BlobReadPath,
  BlobSetAccessor,
  BlobSetPath,
  BlobDeleteAccessor,
  BlobDeletePath,
  BlobSetHook,
  BlobSetHookContext,
  BlobStorageHooks,
  BlobStorageOptions,
  BlobStorageProxy,
  CreateBlobBackendOptions,
  HookedBlobBackend,
} from "./blob.js";
export { asExternalUrl, bindBlobToKv, createBlobKvSyncHooks } from "./sync.js";
export type { BlobKvRecordContext, BlobKvSyncOptions } from "./sync.js";
export { createTabBusBlobBackend, createTabBusBlobBroker } from "./tabBusBlob.js";
export type { TabBusBlobOptions } from "./tabBusBlob.js";
export {
  createOpfsBlobBackend,
  createOpfsBlobBroker,
  createOpfsTabBusBlobBackend,
} from "./opfs.js";
export type { OpfsBlobOptions, OpfsTabBusBlobOptions } from "./opfs.js";

export { createBrowserStorage, getBrowserStorage, createBrowserKvBackend } from "./browser.js";
export type { BrowserStorageApi, BrowserStorageOptions } from "./browser.js";
export { createMonkeyStorage, getMonkeyStorageApi } from "./monkey.js";
export type { MonkeyStorageApi, MonkeyStorageOptions } from "./monkey.js";
export {
  createVscodeStorage,
  getVscodeStorageApi,
  hasVscodeStorage,
  VSCODE_STORAGE_REQUEST,
  VSCODE_STORAGE_RESPONSE,
} from "./vscode.js";
export type {
  VscodeBlobFileSystem,
  VscodeBlobPayload,
  VscodeMemento,
  VscodeStorageBridge,
  VscodeStorageHost,
  VscodeStorageOperation,
  VscodeStorageOptions,
  VscodeStorageRequest,
  VscodeStorageResponse,
  VscodeStorageScope,
  VscodeWebviewApi,
} from "./vscode.js";
export {
  createIndexedDbBlobBackend,
  createIndexedDbKvBackend,
  createWebsiteStorage,
  openStorageDatabase,
} from "./website.js";
export type { WebsiteStorageOptions } from "./website.js";
