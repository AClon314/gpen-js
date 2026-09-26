import type {
  DeleteNamespace,
  DeleteNode,
  GetNamespace,
  JsonValue,
  KvBackend,
  KvStorage,
  KvStorageOptions,
  KvStorageProxy,
  ReadNode,
  SetNamespace,
  SetNode,
  StoragePathKey,
} from "../types.js";
import {
  asPathKey,
  assertJsonValue,
  deleteAtPath,
  getAtPath,
  listKeysAtPath,
  setAtPath,
} from "./kvJson.js";
import { createKvRuntime, type KvRuntime } from "./kvRuntime.js";

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

/** 用后端与选项创建 KV。 */
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
