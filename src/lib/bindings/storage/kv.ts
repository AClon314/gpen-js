import type { JsonValue, KvBackend } from "./types.js";

export type StoragePathKey = string | number;
type JsonRecord = { [key: string]: JsonValue };

export interface KvGetHookContext<T extends JsonValue> {
  readonly self: KvStorage<T>;
  readonly path: readonly StoragePathKey[];
  readonly root: T;
  readonly hookName: string;
  readonly value: JsonValue | undefined;
}

export interface KvSetHookContext<T extends JsonValue> {
  readonly self: KvStorage<T>;
  readonly path: readonly StoragePathKey[];
  readonly root: T;
  readonly hookName: string;
  readonly value: JsonValue;
  readonly previousValue: JsonValue | undefined;
}

export interface KvDeleteHookContext<T extends JsonValue> {
  readonly self: KvStorage<T>;
  readonly path: readonly StoragePathKey[];
  readonly root: T;
  readonly hookName: string;
  readonly previousValue: JsonValue | undefined;
}

export type KvGetHook<T extends JsonValue> = (
  context: KvGetHookContext<T>,
) => JsonValue | undefined | PromiseLike<JsonValue | undefined>;
export type KvSetHook<T extends JsonValue> = (
  context: KvSetHookContext<T>,
) => unknown | PromiseLike<unknown>;
export type KvDeleteHook<T extends JsonValue> = (
  context: KvDeleteHookContext<T>,
) => unknown | PromiseLike<unknown>;

export interface KvStorageHooks<T extends JsonValue> {
  getters?: Record<string, KvGetHook<T>>;
  setters?: Record<string, KvSetHook<T>>;
  deleters?: Record<string, KvDeleteHook<T>>;
}

/** Runtime hook registries. The maps are intentionally mutable so plugins can
 * be installed after the storage object has been created. */
export interface KvStorageProxy<T extends JsonValue> {
  getters: Record<string, KvGetHook<T>>;
  setters: Record<string, KvSetHook<T>>;
  deleters: Record<string, KvDeleteHook<T>>;
}

type PreviousDepth = [never, 0, 1, 2, 3, 4, 5, 6];
type ReservedReadKey = "then" | "keys" | "toJSON";
type ReservedThenKey = "then" | "toJSON";

type ReadProtocol<T> = PromiseLike<T | undefined> & {
  keys(): Promise<string[]>;
};

type SetProtocol<T> = (value: T) => Promise<void>;
type DeleteProtocol = PromiseLike<void>;

type ReadChildren<T, Depth extends number> = Depth extends 0
  ? Record<string, ReadProtocol<JsonValue>>
  : T extends readonly (infer Item)[]
    ? { [index: number]: ReadNode<Item, PreviousDepth[Depth]> }
    : T extends object
      ? {
          [Key in keyof T as Key extends ReservedReadKey ? never : Key]-?: ReadNode<
            T[Key],
            PreviousDepth[Depth]
          >;
        }
      : Record<string, ReadProtocol<JsonValue>>;

type SetChildren<T, Depth extends number> = Depth extends 0
  ? Record<string, SetProtocol<JsonValue>>
  : T extends readonly (infer Item)[]
    ? { [index: number]: SetNode<Item, PreviousDepth[Depth]> }
    : T extends object
      ? {
          [Key in keyof T as Key extends ReservedThenKey ? never : Key]-?: SetNode<
            T[Key],
            PreviousDepth[Depth]
          >;
        }
      : Record<string, SetProtocol<JsonValue>>;

type DeleteChildren<T, Depth extends number> = Depth extends 0
  ? Record<string, DeleteProtocol>
  : T extends readonly (infer Item)[]
    ? { [index: number]: DeleteNode<Item, PreviousDepth[Depth]> }
    : T extends object
      ? {
          [Key in keyof T as Key extends ReservedThenKey ? never : Key]-?: DeleteNode<
            T[Key],
            PreviousDepth[Depth]
          >;
        }
      : Record<string, DeleteProtocol>;

type ReadNode<T, Depth extends number = 6> = ReadProtocol<T> & ReadChildren<T, Depth>;
type SetNode<T, Depth extends number = 6> = SetProtocol<T> & SetChildren<T, Depth>;
type DeleteNode<T, Depth extends number = 6> = DeleteProtocol & DeleteChildren<T, Depth>;

type GetNamespace<T, Depth extends number = 6> = ReadChildren<T, Depth>;
type SetNamespace<T, Depth extends number = 6> = SetChildren<T, Depth>;
type DeleteNamespace<T, Depth extends number = 6> = DeleteChildren<T, Depth>;

export type KvInitialValue<T extends JsonValue> =
  | T
  | PromiseLike<T>
  | ((oldValue: T) => T | PromiseLike<T>);

export interface KvStorageOptions<T extends JsonValue> {
  /** Initial cache mode; can be changed through KvStorage.cache. */
  cache?: boolean;
  /** A value, promise, or migration/default callback evaluated once per store. */
  initValue?: KvInitialValue<T>;
  /** Application/schema version metadata. */
  version?: string;
  versionNum?: readonly number[];
  /** Optional hooks for synchronizing KV with another storage service. */
  hooks?: KvStorageHooks<T>;
}

export type KvStorage<T extends JsonValue, Depth extends number = 6> = {
  readonly name: string;
  cache: boolean;
  readonly get: GetNamespace<T, Depth>;
  readonly set: SetNamespace<T, Depth>;
  readonly del: DeleteNamespace<T, Depth>;
  readonly proxy: KvStorageProxy<T>;
  keys(): Promise<string[]>;
  submit(): Promise<void>;
  readonly version?: string;
  readonly versionNum?: readonly number[];
};

const isContainer = (value: JsonValue | undefined): value is JsonValue[] | JsonRecord =>
  Array.isArray(value) || (typeof value === "object" && value !== null);

const asPathKey = (property: string): StoragePathKey =>
  /^(0|[1-9]\d*)$/.test(property) ? Number(property) : property;

function readChild(
  container: JsonValue[] | JsonRecord,
  key: StoragePathKey,
): JsonValue | undefined {
  return (container as unknown as Record<string, JsonValue | undefined>)[String(key)];
}

function deleteChild(container: JsonValue[] | JsonRecord, key: StoragePathKey): void {
  if (Array.isArray(container) && typeof key === "number") {
    delete container[key];
    return;
  }

  delete (container as JsonRecord)[String(key)];
}

function getAtPath(root: JsonValue, path: StoragePathKey[]): JsonValue | undefined {
  let current: JsonValue | undefined = root;

  for (const key of path) {
    if (!isContainer(current)) return undefined;
    current = readChild(current, key);
  }

  return current;
}

function createContainer(nextKey: StoragePathKey): JsonValue[] | JsonRecord {
  return typeof nextKey === "number" ? [] : {};
}

function assignAtPath(
  container: JsonValue[] | JsonRecord,
  key: StoragePathKey,
  value: JsonValue,
): void {
  if (Array.isArray(container) && typeof key === "number") {
    container[key] = value;
    return;
  }

  (container as JsonRecord)[String(key)] = value;
}

export function setAtPath(root: JsonValue, path: StoragePathKey[], value: JsonValue): JsonValue {
  if (path.length === 0) return value;

  const result = isContainer(root) ? root : createContainer(path[0]);
  let current = result;

  for (let index = 0; index < path.length; index += 1) {
    const key = path[index];
    if (index === path.length - 1) {
      assignAtPath(current, key, value);
      break;
    }

    const nextKey = path[index + 1];
    const existing = readChild(current, key);
    const next = isContainer(existing) ? existing : createContainer(nextKey);
    assignAtPath(current, key, next);
    current = next;
  }

  return result;
}

export function deleteAtPath(root: JsonValue, path: StoragePathKey[]): JsonValue {
  if (path.length === 0) return {};
  if (!isContainer(root)) return root;

  let current: JsonValue[] | JsonRecord = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const next = readChild(current, path[index]);
    if (!isContainer(next)) return root;
    current = next;
  }

  deleteChild(current, path[path.length - 1]);
  return root;
}

export function listKeysAtPath(root: JsonValue, path: StoragePathKey[]): string[] {
  const value = getAtPath(root, path);
  return isContainer(value) ? Object.keys(value) : [];
}

export function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isJsonValue);
}

function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) throw new TypeError("KV values must be JSON values");
}

interface KvRuntime<T extends JsonValue> {
  readonly cache: boolean;
  setCache(value: boolean): void;
  load(): Promise<T>;
  update(mutator: (root: T) => T): Promise<T>;
  submit(): Promise<void>;
  runGetHooks(
    path: StoragePathKey[],
    value: JsonValue | undefined,
    root: T,
  ): Promise<JsonValue | undefined>;
  runSetHooks(
    path: StoragePathKey[],
    value: JsonValue,
    previousValue: JsonValue | undefined,
    root: T,
  ): Promise<void>;
  runDeleteHooks(
    path: StoragePathKey[],
    previousValue: JsonValue | undefined,
    root: T,
  ): Promise<void>;
}

function resolveInitialValue<T extends JsonValue>(
  initial: KvInitialValue<T> | undefined,
  loaded: T,
): Promise<T> {
  if (initial === undefined) return Promise.resolve(loaded);
  if (typeof initial === "function") {
    return Promise.resolve((initial as (oldValue: T) => T | PromiseLike<T>)(loaded));
  }
  return Promise.resolve(initial);
}

function createKvRuntime<T extends JsonValue>(
  backend: KvBackend<T>,
  options: KvStorageOptions<T>,
  proxy: KvStorageProxy<T>,
  getSelf: () => KvStorage<T>,
): KvRuntime<T> {
  let cached = options.cache ?? true;
  let requestedCache = cached;
  let rootPromise: Promise<T> | undefined;
  let root: T | undefined;
  let dirty = false;
  let nonCachedInitialized = false;
  let initialized = false;
  let persisted = false;
  let cachedRootNeedsReload = false;
  let cacheTransitionFailed = false;
  let cacheTransitionError: unknown;
  let operationTail = Promise.resolve();

  const loadBackendRoot = async (): Promise<T> => {
    const loaded = deepClone(await backend.load());
    assertJsonValue(loaded);
    return loaded;
  };

  const initialize = async (): Promise<T> => {
    const loaded = await loadBackendRoot();
    const prepared = await resolveInitialValue(options.initValue, loaded);
    assertJsonValue(prepared);
    return deepClone(prepared) as T;
  };

  // Start once so a promise or callback initializer has one well-defined lifetime.
  const initialization = initialize();
  void initialization.catch(() => undefined);

  const useInitialization = async (): Promise<T> => {
    const value = await initialization;
    initialized = true;
    return value;
  };

  const ensureRoot = (): Promise<T> => {
    if (!rootPromise) {
      const shouldUseInitialization = !cachedRootNeedsReload || (!initialized && !persisted);
      const source = shouldUseInitialization ? useInitialization() : loadBackendRoot();
      rootPromise = source.then((loaded) => {
        root = loaded;
        dirty = shouldUseInitialization && options.initValue !== undefined;
        cachedRootNeedsReload = false;
        return loaded;
      });
    }
    return rootPromise;
  };

  const enqueue = <R>(operation: () => Promise<R>): Promise<R> => {
    const next = operationTail.then(operation);
    operationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const assertCacheTransitionSucceeded = (): void => {
    if (cacheTransitionFailed) throw cacheTransitionError;
  };

  const flushCachedRoot = async (): Promise<void> => {
    if (!dirty) return;
    const value = deepClone(await ensureRoot());
    await backend.save(value);
    root = value;
    rootPromise = Promise.resolve(value);
    dirty = false;
    persisted = true;
  };

  const transitionCache = async (next: boolean): Promise<void> => {
    if (cached === next) return;

    if (cached && !next) {
      await flushCachedRoot();
      if (rootPromise) nonCachedInitialized = true;
    } else {
      rootPromise = undefined;
      root = undefined;
      dirty = false;
      cachedRootNeedsReload = true;
    }

    cached = next;
  };

  const setCache = (value: boolean): void => {
    if (requestedCache === value && !cacheTransitionFailed) return;

    requestedCache = value;
    cacheTransitionFailed = false;
    cacheTransitionError = undefined;
    if (cached === value) return;

    const transition = enqueue(async () => {
      try {
        await transitionCache(value);
      } catch (error) {
        cacheTransitionFailed = true;
        cacheTransitionError = error;
        throw error;
      }
    });
    void transition.catch(() => undefined);
  };

  return {
    get cache() {
      return requestedCache;
    },
    setCache,
    async load() {
      return enqueue(async () => {
        assertCacheTransitionSucceeded();
        if (!cached) await flushCachedRoot();
        return loadBackendRoot();
      });
    },
    async update(mutator) {
      return enqueue(async () => {
        assertCacheTransitionSucceeded();
        if (cached) {
          const current = await ensureRoot();
          const next = mutator(current);
          assertJsonValue(next);
          root = deepClone(next);
          rootPromise = Promise.resolve(root);
          dirty = true;
          return root;
        }

        await flushCachedRoot();
        const current = nonCachedInitialized ? await loadBackendRoot() : await useInitialization();
        nonCachedInitialized = true;
        const next = mutator(deepClone(current));
        assertJsonValue(next);
        await backend.save(next);
        persisted = true;
        return next;
      });
    },
    async submit() {
      return enqueue(async () => {
        assertCacheTransitionSucceeded();
        if (!cached) {
          await flushCachedRoot();
          return;
        }
        if (!dirty && rootPromise) return;
        const value = deepClone(await ensureRoot());
        if (!dirty) return;
        await backend.save(value);
        root = value;
        rootPromise = Promise.resolve(value);
        dirty = false;
        persisted = true;
      });
    },
    async runGetHooks(path, value, root) {
      let current = value;
      for (const [hookName, hook] of Object.entries(proxy.getters)) {
        const next = await hook({
          self: getSelf(),
          path,
          root,
          hookName,
          value: current,
        });
        if (next !== undefined) current = next;
      }
      return current;
    },
    async runSetHooks(path, value, previousValue, root) {
      for (const [hookName, hook] of Object.entries(proxy.setters)) {
        await hook({
          self: getSelf(),
          path,
          root,
          hookName,
          value,
          previousValue,
        });
      }
    },
    async runDeleteHooks(path, previousValue, root) {
      for (const [hookName, hook] of Object.entries(proxy.deleters)) {
        await hook({
          self: getSelf(),
          path,
          root,
          hookName,
          previousValue,
        });
      }
    },
  };
}

function createGetNode<T, TRoot extends JsonValue>(
  runtime: KvRuntime<TRoot>,
  path: StoragePathKey[],
): ReadNode<T> {
  const target = Object.create(null) as object;

  return new Proxy(target, {
    get(_target, property) {
      if (property === "then") {
        return (
          onfulfilled?: (value: T | undefined) => unknown,
          onrejected?: (reason: unknown) => unknown,
        ) =>
          runtime
            .load()
            .then((root) => ({ root, value: getAtPath(root, path) }))
            .then(({ root, value }) => runtime.runGetHooks(path, value, root))
            .then((value) => value as T | undefined)
            .then(onfulfilled, onrejected);
      }
      if (property === "keys") {
        return () => runtime.load().then((root) => listKeysAtPath(root, path));
      }
      if (property === "toJSON" || typeof property === "symbol") return undefined;
      return createGetNode(runtime, [...path, asPathKey(property)]);
    },
  }) as ReadNode<T>;
}

function createSetNode<T, TRoot extends JsonValue>(
  runtime: KvRuntime<TRoot>,
  path: StoragePathKey[],
): SetNode<T> {
  const callable = function () {
    return undefined;
  };

  return new Proxy(callable, {
    apply(_target, _thisArg, args: unknown[]) {
      if (args.length !== 1) {
        return Promise.reject(new TypeError("A set node accepts exactly one argument"));
      }
      const value = args[0];
      assertJsonValue(value);
      let previousValue: JsonValue | undefined;
      return runtime
        .update((root) => {
          previousValue = getAtPath(root, path);
          return setAtPath(root, path, value) as TRoot;
        })
        .then((root) => runtime.runSetHooks(path, value, previousValue, root));
    },
    get(_target, property) {
      if (property === "then" || property === "toJSON" || typeof property === "symbol") {
        return undefined;
      }
      return createSetNode(runtime, [...path, asPathKey(property)]);
    },
  }) as unknown as SetNode<T>;
}

function createDeleteNode<T, TRoot extends JsonValue>(
  runtime: KvRuntime<TRoot>,
  path: StoragePathKey[],
): DeleteNode<T> {
  const target = Object.create(null) as object;

  return new Proxy(target, {
    get(_target, property) {
      if (property === "then") {
        return (
          onfulfilled?: (value: undefined) => unknown,
          onrejected?: (reason: unknown) => unknown,
        ) => {
          let previousValue: JsonValue | undefined;
          return runtime
            .update((root) => {
              previousValue = getAtPath(root, path);
              return deleteAtPath(root, path) as TRoot;
            })
            .then((root) => runtime.runDeleteHooks(path, previousValue, root))
            .then(() => undefined)
            .then(onfulfilled, onrejected);
        };
      }
      if (property === "toJSON" || typeof property === "symbol") return undefined;
      return createDeleteNode(runtime, [...path, asPathKey(property)]);
    },
  }) as DeleteNode<T>;
}

function createGetNamespace<T, TRoot extends JsonValue>(
  runtime: KvRuntime<TRoot>,
): GetNamespace<T> {
  const target = Object.create(null) as object;

  return new Proxy(target, {
    get(_target, property) {
      if (property === "then" || property === "toJSON" || typeof property === "symbol") {
        return undefined;
      }
      return createGetNode<T, TRoot>(runtime, [asPathKey(property)]);
    },
  }) as GetNamespace<T>;
}

function createSetNamespace<T, TRoot extends JsonValue>(
  runtime: KvRuntime<TRoot>,
): SetNamespace<T> {
  const target = Object.create(null) as object;

  return new Proxy(target, {
    get(_target, property) {
      if (property === "then" || property === "toJSON" || typeof property === "symbol") {
        return undefined;
      }
      return createSetNode<T, TRoot>(runtime, [asPathKey(property)]);
    },
  }) as SetNamespace<T>;
}

function createDeleteNamespace<T, TRoot extends JsonValue>(
  runtime: KvRuntime<TRoot>,
): DeleteNamespace<T> {
  const target = Object.create(null) as object;

  return new Proxy(target, {
    get(_target, property) {
      if (property === "then" || property === "toJSON" || typeof property === "symbol") {
        return undefined;
      }
      return createDeleteNode<T, TRoot>(runtime, [asPathKey(property)]);
    },
  }) as DeleteNamespace<T>;
}

export function createKvStorage<T extends JsonValue>(
  backend: KvBackend<T>,
  options: KvStorageOptions<T> = {},
): KvStorage<T> {
  const proxy: KvStorageProxy<T> = {
    getters: { ...options.hooks?.getters },
    setters: { ...options.hooks?.setters },
    deleters: { ...options.hooks?.deleters },
  };
  let self: KvStorage<T>;
  const runtime = createKvRuntime(backend, options, proxy, () => self);

  self = {
    name: backend.name,
    get cache() {
      return runtime.cache;
    },
    set cache(value) {
      runtime.setCache(value);
    },
    get: createGetNamespace<T, T>(runtime),
    set: createSetNamespace<T, T>(runtime),
    del: createDeleteNamespace<T, T>(runtime),
    proxy,
    keys: () => runtime.load().then((root) => listKeysAtPath(root, [])),
    submit: () => runtime.submit(),
    version: options.version,
    versionNum: options.versionNum,
  };
  return self;
}
