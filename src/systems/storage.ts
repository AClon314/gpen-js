/** save & load */

import { file_gpen_v1_gpen as fileGpenV1Gpen } from '@/gen/gpen/v1/gpen_pb.js';

type PathSegment = string | number;
type KvRoot = Record<string, unknown>;

type KvNode<T = unknown> = {
  (): Promise<T>;
  (value: T): Promise<T>;
} & (NonNullable<T> extends readonly (infer U)[]
  ? { [index: number]: KvNode<U> }
  : NonNullable<T> extends object
    ? { [K in keyof NonNullable<T>]-?: KvNode<NonNullable<T>[K]> }
    : {});

interface KvBackend<T extends KvRoot = KvRoot> {
  load(): Promise<T>;
  save(snapshot: T): Promise<void>;
}

interface BrowserStorageLike {
  browser?: {
    storage?: {
      local: {
        get(key: string): Promise<Record<string, unknown>>;
        set(items: Record<string, unknown>): Promise<void>;
      };
    };
  };
}

interface GmStorageLike {
  GM_getValue?: (key: string, defaultValue?: unknown) => unknown;
  GM_setValue?: (key: string, value: unknown) => void;
}

/**
 * Storage backend naming config.
 *
 * Under the hood, these fields map to different tree shapes by environment:
 *
 * ```text
 * Tampermonkey / Greasemonkey
 * └── GM storage
 *     └── kvRootKey
 *         └── { ...entire kv root object... }
 *
 * Browser extension
 * └── browser.storage.local
 *     └── kvRootKey
 *         └── { ...entire kv root object... }
 *
 * Plain web page
 * └── IndexedDB
 *     └── dbName (database)
 *         ├── kvRootKey (object store)
 *         │   └── kvRootKey
 *         │       └── { ...entire kv root object... }
 *         └── handleStoreName (object store)
 *             └── bigFileKey
 *                 └── FileSystemFileHandle
 * ```
 */
interface StorageConfig {
  /** IndexedDB database name used by `indexedDB.open()`. */
  dbName: string;
  /** IndexedDB schema version passed to `indexedDB.open()`. */
  dbVersion: number;
  /** IndexedDB object store name for persisted file handles. */
  handleStoreName: string;
  /**
   * Root key for small kv data.
   * - In Tampermonkey/Greasemonkey this is the `GM_getValue()` / `GM_setValue()` key;
   * - in browser extensions this is the `browser.storage.local` property name;
   * - in IndexedDB this is both the kv object store name and the record key inside it.
   */
  kvRootKey: string;
  /**
   * Default key for persisted file handles.
   * This is only used in IndexedDB, as the record key inside `handleStoreName`.
   */
  bigFileKey: string;
}

type StorageConfigInput = Partial<StorageConfig>;

const GPEN_PROTOCOL_PACKAGE = fileGpenV1Gpen.proto.package ?? '';

function parseProtocolMajorVersion(packageName: string): number | undefined {
  const match = packageName.match(/(?:^|\.)v(\d+)$/);
  if (!match) {
    return undefined;
  }

  const version = Number(match[1]);
  return Number.isInteger(version) && version > 0 ? version : undefined;
}

export const GPEN_PROTOCOL_MAJOR_VERSION =
  parseProtocolMajorVersion(GPEN_PROTOCOL_PACKAGE) ?? 1;

const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  dbName: 'gpen-db',
  dbVersion: GPEN_PROTOCOL_MAJOR_VERSION,
  handleStoreName: 'handles',
  kvRootKey: 'gpen',
  bigFileKey: 'bigFile',
};

interface FileSystemHandleWithPermissions extends FileSystemFileHandle {
  queryPermission?(descriptor?: {
    mode?: 'read' | 'readwrite';
  }): Promise<PermissionState>;
  requestPermission?(descriptor?: {
    mode?: 'read' | 'readwrite';
  }): Promise<PermissionState>;
}

interface WindowWithFilePicker extends Window {
  showOpenFilePicker?: () => Promise<FileSystemFileHandle[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isContainer(
  value: unknown,
): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object';
}

function normalizeRoot<T extends KvRoot = KvRoot>(value: unknown): T {
  if (!isRecord(value)) {
    return {} as T;
  }

  return value as T;
}

function normalizePathSegment(prop: string | symbol): PathSegment {
  if (typeof prop !== 'string') {
    throw new TypeError(`Unsupported path segment: ${String(prop)}`);
  }

  if (/^(0|[1-9]\d*)$/.test(prop)) {
    return Number(prop);
  }

  return prop;
}

function getAtPath(root: KvRoot, path: readonly PathSegment[]): unknown {
  let cursor: unknown = root;

  for (const segment of path) {
    if (!isContainer(cursor)) {
      return undefined;
    }

    cursor = (cursor as Record<string | number, unknown>)[segment];
  }

  return cursor;
}

function ensureChildContainer(
  container: Record<string, unknown> | unknown[],
  segment: PathSegment,
  nextSegment: PathSegment,
): Record<string, unknown> | unknown[] {
  const indexable = container as Record<string | number, unknown>;
  const current = indexable[segment];

  if (isContainer(current)) {
    return current;
  }

  const next = typeof nextSegment === 'number' ? [] : {};
  indexable[segment] = next;
  return next;
}

function setAtPath(
  root: KvRoot,
  path: readonly PathSegment[],
  value: unknown,
): KvRoot {
  if (path.length === 0) {
    return normalizeRoot(value);
  }

  let cursor: Record<string, unknown> | unknown[] = root;

  for (let i = 0; i < path.length - 1; i += 1) {
    cursor = ensureChildContainer(cursor, path[i]!, path[i + 1]!);
  }

  (cursor as Record<string | number, unknown>)[path[path.length - 1]!] = value;
  return root;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line no-param-reassign
    tx.oncomplete = () => resolve();
    // eslint-disable-next-line no-param-reassign
    tx.onabort = () =>
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    // eslint-disable-next-line no-param-reassign
    tx.onerror = () =>
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

function resolveStorageConfig(
  options: StorageConfigInput = {},
): Readonly<StorageConfig> {
  return { ...DEFAULT_STORAGE_CONFIG, ...options };
}

/**
 * Open the IndexedDB database used by this module.
 *
 * @example
 * ```ts
 * const db = await openDb({ dbName: 'my-storage' });
 * ```
 */
export function openDb(options: StorageConfigInput = {}): Promise<IDBDatabase> {
  const config = resolveStorageConfig(options);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(config.dbName, config.dbVersion);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(config.kvRootKey)) {
        db.createObjectStore(config.kvRootKey);
      }

      if (!db.objectStoreNames.contains(config.handleStoreName)) {
        db.createObjectStore(config.handleStoreName);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open IndexedDB'));
  });
}

async function idbGet<T>(
  storeName: string,
  key: IDBValidKey,
  options: StorageConfigInput = {},
): Promise<T | undefined> {
  const db = await openDb(options);

  try {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const value = await requestToPromise(store.get(key) as IDBRequest<T>);
    await transactionToPromise(tx);
    return value;
  } finally {
    db.close();
  }
}

async function idbSet(
  storeName: string,
  key: IDBValidKey,
  value: unknown,
  options: StorageConfigInput = {},
): Promise<void> {
  const db = await openDb(options);

  try {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    await requestToPromise(store.put(value, key));
    await transactionToPromise(tx);
  } finally {
    db.close();
  }
}

function getGlobalStorage() {
  return globalThis as typeof globalThis & BrowserStorageLike & GmStorageLike;
}

/**
 * Create a low-level kv backend.
 * It chooses `GM_*`, `browser.storage.local`, or IndexedDB by environment.
 *
 * @example
 * ```ts
 * const backend = createKvBackend({ kvRootKey: 'prefs' });
 * const data = await backend.load();
 * ```
 */
function createKvBackend(options: StorageConfigInput = {}): KvBackend<KvRoot> {
  const config = resolveStorageConfig(options);
  const globals = getGlobalStorage();

  if (
    typeof globals.GM_getValue === 'function' &&
    typeof globals.GM_setValue === 'function'
  ) {
    return {
      async load() {
        return normalizeRoot(globals.GM_getValue?.(config.kvRootKey, {}));
      },
      async save(snapshot) {
        globals.GM_setValue?.(config.kvRootKey, snapshot);
      },
    };
  }

  if (globals.browser?.storage?.local) {
    const localStorage = globals.browser.storage.local;

    return {
      async load() {
        const result = await localStorage.get(config.kvRootKey);
        return normalizeRoot(result[config.kvRootKey]);
      },
      async save(snapshot) {
        await localStorage.set({
          [config.kvRootKey]: snapshot,
        });
      },
    };
  }

  return {
    async load() {
      return normalizeRoot(
        await idbGet(config.kvRootKey, config.kvRootKey, config),
      );
    },
    async save(snapshot) {
      await idbSet(config.kvRootKey, config.kvRootKey, snapshot, config);
    },
  };
}

/**
 * Create a proxy-based kv store.
 * Reads use `await store.foo()`, writes use `await store.foo(value)`.
 *
 * @example
 * ```ts
 * const store = createKvStore<{ ui: { zoom: number } }>();
 * await store.ui.zoom(2); // write
 * const zoom = await store.ui.zoom(); // read
 * ```
 */
function createKvStore<T extends KvRoot = KvRoot>(
  backend: KvBackend<T> = createKvBackend() as KvBackend<T>,
): KvNode<T> {
  const createNode = <TValue>(path: PathSegment[]): KvNode<TValue> =>
    new Proxy((() => undefined) as unknown as KvNode<TValue>, {
      get(_target, prop) {
        if (prop === 'then') {
          return undefined;
        }

        if (typeof prop === 'symbol') {
          return undefined;
        }

        return createNode([...path, normalizePathSegment(prop)]);
      },
      apply(_target, _thisArg, args: unknown[]) {
        if (args.length === 0) {
          return backend.load().then(state => getAtPath(state, path) as TValue);
        }

        if (args.length === 1) {
          return backend.load().then(async state => {
            const nextState = setAtPath(state, path, args[0]);
            await backend.save(nextState as T);
            return args[0] as TValue;
          });
        }

        throw new TypeError(
          'kv path call only supports 0 args (get) or 1 arg (set)',
        );
      },
    });

  return createNode<T>([]);
}

/**
 * Default kv store for small shared state.
 * Callers should use `await` themselves to keep reads/writes ordered.
 *
 * @example
 * ```ts
 * await kv.session.currentTool('pen');
 * const tool = await kv.session.currentTool();
 * ```
 *
 * Writes do not clone input values. If you need isolation from later mutation,
 * clone the value yourself with something like `structuredClone()`.
 */
export const kv = createKvStore();

/**
 * Create a file store backed by the File System Access API plus IndexedDB.
 *
 * @example
 * ```ts
 * const files = createFileStore({ bigFileKey: 'model.bin' });
 * await files.write(blob);
 * ```
 */
function createFileStore(options: StorageConfigInput = {}) {
  const config = resolveStorageConfig(options);
  let fileHandle: FileSystemFileHandle | null = null;

  return {
    /**
     * Restore a previously stored file handle from IndexedDB.
     *
     * @example
     * ```ts
     * const handle = await file.restore();
     * ```
     */
    async restore(handleKey = config.bigFileKey) {
      const savedHandle = await idbGet<FileSystemHandleWithPermissions>(
        config.handleStoreName,
        handleKey,
        config,
      );

      if (!savedHandle) {
        return null;
      }

      try {
        const perm = await savedHandle.queryPermission?.({ mode: 'readwrite' });

        if (perm === 'granted') {
          fileHandle = savedHandle;
          return fileHandle;
        }

        const requested = await savedHandle.requestPermission?.({
          mode: 'readwrite',
        });

        if (requested === 'granted') {
          fileHandle = savedHandle;
          return fileHandle;
        }
      } catch (error) {
        console.warn('Failed to restore file handle', error);
      }

      return null;
    },

    /**
     * Ask the user to pick a file and persist its handle.
     *
     * @example
     * ```ts
     * const handle = await file.select();
     * ```
     */
    async select(handleKey = config.bigFileKey) {
      const pickerWindow = window as WindowWithFilePicker;
      if (!pickerWindow.showOpenFilePicker) {
        throw new Error('showOpenFilePicker is not supported in this browser');
      }

      const [selected] = await pickerWindow.showOpenFilePicker();
      fileHandle = selected ?? null;

      if (fileHandle) {
        await idbSet(config.handleStoreName, handleKey, fileHandle, config);
      }

      return fileHandle;
    },

    /**
     * Write data into the selected file handle.
     *
     * @example
     * ```ts
     * await file.write(blob);
     * ```
     *
     * Input values are not cloned. If you need isolation from later mutation,
     * clone them yourself with something like `structuredClone()`.
     */
    async write(data: FileSystemWriteChunkType, handleKey = config.bigFileKey) {
      if (!fileHandle) {
        fileHandle =
          (await this.restore(handleKey)) ?? (await this.select(handleKey));
      }

      if (!fileHandle) {
        throw new Error('File handle is unavailable');
      }

      const writable = await fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
    },
  };
}

/** Default file store for large blobs or model files. */
export const file = createFileStore();

export { createFileStore, createKvBackend, createKvStore };
export type { KvNode, KvRoot, PathSegment, StorageConfig };
