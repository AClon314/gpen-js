import type {
  JsonValue,
  KvBackend,
  KvInitialValue,
  KvStorage,
  KvStorageOptions,
  KvStorageProxy,
  StoragePathKey,
} from "../types.js";
import { assertJsonValue, deepClone } from "./kvJson.js";

/** KV 的运行期状态机（缓存、初始化、串行队列、钩子）。 */
export interface KvRuntime<T extends JsonValue> {
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

/**
 * Serialized KV runtime. Kept as a class so the cache/initialization state
 * machine is split into individually small methods instead of one long closure.
 */
class KvRuntimeStore<T extends JsonValue> implements KvRuntime<T> {
  _backend: KvBackend<T>;
  _options: KvStorageOptions<T>;
  _proxy: KvStorageProxy<T>;
  _getSelf: () => KvStorage<T>;
  _cached: boolean;
  _requestedCache: boolean;
  _rootPromise: Promise<T> | undefined;
  _root: T | undefined;
  _dirty = false;
  _nonCachedInitialized = false;
  _initialized = false;
  _persisted = false;
  _cachedRootNeedsReload = false;
  _cacheTransitionFailed = false;
  _cacheTransitionError: unknown;
  _operationTail: Promise<void> = Promise.resolve();
  _initialization: Promise<T>;

  constructor(
    backend: KvBackend<T>,
    options: KvStorageOptions<T>,
    proxy: KvStorageProxy<T>,
    getSelf: () => KvStorage<T>,
  ) {
    this._backend = backend;
    this._options = options;
    this._proxy = proxy;
    this._getSelf = getSelf;
    this._cached = options.cache ?? true;
    this._requestedCache = this._cached;
    // Start once so a promise or callback initializer has one well-defined lifetime.
    this._initialization = this._initialize();
    void this._initialization.catch((e) => {
      console.debug("[gpen] ignored rejection: kv initialization", e);
      return;
    });
  }

  get cache(): boolean {
    return this._requestedCache;
  }

  async _loadBackendRoot(): Promise<T> {
    const loaded = deepClone(await this._backend.load());
    assertJsonValue(loaded);
    return loaded;
  }

  async _initialize(): Promise<T> {
    const loaded = await this._loadBackendRoot();
    const prepared = await resolveInitialValue(this._options.initValue, loaded);
    assertJsonValue(prepared);
    return deepClone(prepared) as T;
  }

  async _useInitialization(): Promise<T> {
    const value = await this._initialization;
    this._initialized = true;
    return value;
  }

  _ensureRoot(): Promise<T> {
    if (!this._rootPromise) {
      const shouldUseInitialization =
        !this._cachedRootNeedsReload || (!this._initialized && !this._persisted);
      const source = shouldUseInitialization ? this._useInitialization() : this._loadBackendRoot();
      this._rootPromise = source.then((loaded) => {
        this._root = loaded;
        this._dirty = shouldUseInitialization && this._options.initValue !== undefined;
        this._cachedRootNeedsReload = false;
        return loaded;
      });
    }
    return this._rootPromise;
  }

  _enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const next = this._operationTail.then(operation);
    this._operationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  _assertCacheTransitionSucceeded(): void {
    if (this._cacheTransitionFailed) throw this._cacheTransitionError;
  }

  async _flushCachedRoot(): Promise<void> {
    if (!this._dirty) return;
    const value = deepClone(await this._ensureRoot());
    await this._backend.save(value);
    this._root = value;
    this._rootPromise = Promise.resolve(value);
    this._dirty = false;
    this._persisted = true;
  }

  async _transitionCache(next: boolean): Promise<void> {
    if (this._cached === next) return;

    if (this._cached && !next) {
      await this._flushCachedRoot();
      if (this._rootPromise) this._nonCachedInitialized = true;
    } else {
      this._rootPromise = undefined;
      this._root = undefined;
      this._dirty = false;
      this._cachedRootNeedsReload = true;
    }

    this._cached = next;
  }

  setCache(value: boolean): void {
    if (this._requestedCache === value && !this._cacheTransitionFailed) return;

    this._requestedCache = value;
    this._cacheTransitionFailed = false;
    this._cacheTransitionError = undefined;
    if (this._cached === value) return;

    const transition = this._enqueue(async () => {
      try {
        await this._transitionCache(value);
      } catch (error) {
        this._cacheTransitionFailed = true;
        this._cacheTransitionError = error;
        throw error;
      }
    });
    void transition.catch((e) => {
      console.debug("[gpen] ignored rejection: kv cache transition", e);
      return;
    });
  }

  async load(): Promise<T> {
    return this._enqueue(async () => {
      this._assertCacheTransitionSucceeded();
      if (!this._cached) await this._flushCachedRoot();
      return this._loadBackendRoot();
    });
  }

  async update(mutator: (root: T) => T): Promise<T> {
    return this._enqueue(async () => {
      this._assertCacheTransitionSucceeded();
      if (this._cached) {
        const current = await this._ensureRoot();
        const next = mutator(current);
        assertJsonValue(next);
        this._root = deepClone(next);
        this._rootPromise = Promise.resolve(this._root);
        this._dirty = true;
        return this._root;
      }

      await this._flushCachedRoot();
      const current = this._nonCachedInitialized
        ? await this._loadBackendRoot()
        : await this._useInitialization();
      this._nonCachedInitialized = true;
      const next = mutator(deepClone(current));
      assertJsonValue(next);
      await this._backend.save(next);
      this._persisted = true;
      return next;
    });
  }

  async submit(): Promise<void> {
    return this._enqueue(async () => {
      this._assertCacheTransitionSucceeded();
      if (!this._cached) {
        await this._flushCachedRoot();
        return;
      }
      if (!this._dirty && this._rootPromise) return;
      const value = deepClone(await this._ensureRoot());
      if (!this._dirty) return;
      await this._backend.save(value);
      this._root = value;
      this._rootPromise = Promise.resolve(value);
      this._dirty = false;
      this._persisted = true;
    });
  }

  async runGetHooks(
    path: StoragePathKey[],
    value: JsonValue | undefined,
    root: T,
  ): Promise<JsonValue | undefined> {
    let current = value;
    for (const [hookName, hook] of Object.entries(this._proxy.getters)) {
      const next = await hook({
        self: this._getSelf(),
        path,
        root,
        hookName,
        value: current,
      });
      if (next !== undefined) current = next;
    }
    return current;
  }

  async runSetHooks(
    path: StoragePathKey[],
    value: JsonValue,
    previousValue: JsonValue | undefined,
    root: T,
  ): Promise<void> {
    for (const [hookName, hook] of Object.entries(this._proxy.setters)) {
      await hook({
        self: this._getSelf(),
        path,
        root,
        hookName,
        value,
        previousValue,
      });
    }
  }

  async runDeleteHooks(
    path: StoragePathKey[],
    previousValue: JsonValue | undefined,
    root: T,
  ): Promise<void> {
    for (const [hookName, hook] of Object.entries(this._proxy.deleters)) {
      await hook({
        self: this._getSelf(),
        path,
        root,
        hookName,
        previousValue,
      });
    }
  }
}

/** 用后端与选项创建 KV 运行期。 */
export function createKvRuntime<T extends JsonValue>(
  backend: KvBackend<T>,
  options: KvStorageOptions<T>,
  proxy: KvStorageProxy<T>,
  getSelf: () => KvStorage<T>,
): KvRuntime<T> {
  return new KvRuntimeStore(backend, options, proxy, getSelf);
}
