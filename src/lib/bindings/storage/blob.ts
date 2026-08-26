import type { BlobBackend, BlobSetOptions } from "./types.js";

export const DEFAULT_BLOB_TARGET_DOMAIN = "https://xxx.github.com";

export interface BlobStorageOptions {
  /** Origin hosting the OPFS Blob broker iframe. */
  targetDomain?: string;
  /** Optional hooks for linking Blob operations to KV metadata. */
  blobHooks?: BlobStorageHooks;
}

export interface BlobGetHookContext {
  readonly self: HookedBlobBackend;
  readonly id: string;
  readonly path: readonly string[];
  readonly hookName: string;
  readonly value: Blob | undefined;
}

export interface BlobSetHookContext {
  readonly self: HookedBlobBackend;
  readonly id: string;
  readonly path: readonly string[];
  readonly hookName: string;
  readonly value: Blob;
  readonly options: BlobSetOptions | undefined;
}

export interface BlobDeleteHookContext {
  readonly self: HookedBlobBackend;
  readonly id: string;
  readonly path: readonly string[];
  readonly hookName: string;
}

export type BlobGetHook = (
  context: BlobGetHookContext,
) => Blob | undefined | PromiseLike<Blob | undefined>;
export type BlobSetHook = (context: BlobSetHookContext) => unknown | PromiseLike<unknown>;
export type BlobDeleteHook = (context: BlobDeleteHookContext) => unknown | PromiseLike<unknown>;

export interface BlobStorageHooks {
  getters?: Record<string, BlobGetHook>;
  setters?: Record<string, BlobSetHook>;
  deleters?: Record<string, BlobDeleteHook>;
}

/** Mutable hook registries. Assigning a new function at runtime is supported. */
export interface BlobStorageProxy {
  getters: Record<string, BlobGetHook>;
  setters: Record<string, BlobSetHook>;
  deleters: Record<string, BlobDeleteHook>;
}

export type BlobReadPath = PromiseLike<Blob | undefined> & {
  [key: string]: BlobReadPath;
};
export type BlobSetPath = ((value: Blob, options?: BlobSetOptions) => Promise<void>) & {
  [key: string]: BlobSetPath;
};
export type BlobDeletePath = PromiseLike<void> & {
  [key: string]: BlobDeletePath;
};
export type BlobGetAccessor = ((id: string) => Promise<Blob | undefined>) & {
  [key: string]: BlobReadPath;
};
export type BlobSetAccessor = ((
  id: string,
  value: Blob,
  options?: BlobSetOptions,
) => Promise<void>) & {
  [key: string]: BlobSetPath;
};
export type BlobDeleteAccessor = ((id: string) => Promise<void>) & {
  [key: string]: BlobDeletePath;
};

export interface HookedBlobBackend extends BlobBackend {
  readonly proxy: BlobStorageProxy;
  close(): Promise<void>;
  readonly get: BlobGetAccessor;
  readonly set: BlobSetAccessor;
  readonly delete: BlobDeleteAccessor;
  readonly del: BlobDeleteAccessor;
}

type BlobBackendLifecycle = {
  ready?: () => Promise<void>;
  close?: () => void | Promise<void>;
};

function createMemoryBlobBackend(): BlobBackend {
  const values = new Map<string, Blob>();
  return {
    name: "memory:blob",
    async set(id, value) {
      values.set(id, value);
    },
    async get(id) {
      return values.get(id);
    },
    async delete(id) {
      values.delete(id);
    },
  };
}

export interface CreateBlobBackendOptions {
  backend?: BlobBackend;
  hooks?: BlobStorageHooks;
}

function inferSetOptions(
  value: Blob,
  options: BlobSetOptions | undefined,
): BlobSetOptions | undefined {
  if (options?.source || options?.url) return options;
  const source = (value as Blob & { path?: unknown }).path;
  return typeof source === "string" && source ? { ...options, source } : options;
}

function resolveBlobBackend(
  backendOrOptions: BlobBackend | CreateBlobBackendOptions | undefined,
  options: CreateBlobBackendOptions | undefined,
): { backend: BlobBackend; options: CreateBlobBackendOptions } {
  if (!backendOrOptions) return { backend: createMemoryBlobBackend(), options: options ?? {} };
  if ("set" in backendOrOptions && "get" in backendOrOptions && "delete" in backendOrOptions) {
    return { backend: backendOrOptions, options: options ?? {} };
  }
  return {
    backend: backendOrOptions.backend ?? createMemoryBlobBackend(),
    options: backendOrOptions,
  };
}

/**
 * Add an operation proxy and mutable hooks to any Blob backend. The direct
 * set/get/delete methods remain available, so existing backends can be
 * upgraded without changing their callers.
 */
export function createBlobBackend(
  backendOrOptions?: BlobBackend | CreateBlobBackendOptions,
  options?: CreateBlobBackendOptions,
): HookedBlobBackend {
  const resolved = resolveBlobBackend(backendOrOptions, options);
  const backend = resolved.backend;
  const hooks = resolved.options.hooks;
  const proxy: BlobStorageProxy = {
    getters: { ...hooks?.getters },
    setters: { ...hooks?.setters },
    deleters: { ...hooks?.deleters },
  };

  const setBlob = async (id: string, value: Blob, setOptions?: BlobSetOptions): Promise<void> => {
    const path = splitBlobId(id);
    const effectiveOptions = inferSetOptions(value, setOptions);
    await backend.set(id, value, effectiveOptions);
    for (const [hookName, hook] of Object.entries(proxy.setters)) {
      await hook({ self: result, id, path, hookName, value, options: effectiveOptions });
    }
  };
  const getBlob = async (id: string): Promise<Blob | undefined> => {
    const path = splitBlobId(id);
    let value = await backend.get(id);
    for (const [hookName, hook] of Object.entries(proxy.getters)) {
      const next = await hook({ self: result, id, path, hookName, value });
      if (next !== undefined) value = next;
    }
    return value;
  };
  const deleteBlob = async (id: string): Promise<void> => {
    const path = splitBlobId(id);
    await backend.delete(id);
    for (const [hookName, hook] of Object.entries(proxy.deleters)) {
      await hook({ self: result, id, path, hookName });
    }
  };

  const getPath = (path: string[]): BlobReadPath => {
    const target = Object.create(null) as object;
    return new Proxy(target, {
      get(_target, property) {
        if (property === "then") {
          return (
            onfulfilled?: (value: Blob | undefined) => unknown,
            onrejected?: (reason: unknown) => unknown,
          ) => getBlob(path.join("/")).then(onfulfilled, onrejected);
        }
        if (property === "toJSON" || typeof property === "symbol") return undefined;
        return getPath([...path, String(property)]);
      },
    }) as BlobReadPath;
  };

  const setPath = (path: string[]): BlobSetPath => {
    const callable = function () {
      return undefined;
    };
    return new Proxy(callable, {
      apply(_target, _thisArg, args: unknown[]) {
        if (args.length < 1 || args.length > 2) {
          return Promise.reject(
            new TypeError("A Blob set path accepts a Blob and optional options"),
          );
        }
        return setBlob(path.join("/"), args[0] as Blob, args[1] as BlobSetOptions | undefined);
      },
      get(_target, property) {
        if (property === "then" || property === "toJSON" || typeof property === "symbol") {
          return undefined;
        }
        return setPath([...path, String(property)]);
      },
    }) as unknown as BlobSetPath;
  };

  const deletePath = (path: string[]): BlobDeletePath => {
    const target = Object.create(null) as object;
    return new Proxy(target, {
      get(_target, property) {
        if (property === "then") {
          return (
            onfulfilled?: (value: undefined) => unknown,
            onrejected?: (reason: unknown) => unknown,
          ) => deleteBlob(path.join("/")).then(() => onfulfilled?.(undefined), onrejected);
        }
        if (property === "toJSON" || typeof property === "symbol") return undefined;
        return deletePath([...path, String(property)]);
      },
    }) as BlobDeletePath;
  };

  const get = new Proxy(
    function () {
      return undefined;
    },
    {
      apply(_target, _thisArg, args: unknown[]) {
        if (args.length !== 1 || typeof args[0] !== "string") {
          return Promise.reject(new TypeError("Blob get accepts exactly one id"));
        }
        return getBlob(args[0]);
      },
      get(_target, property) {
        if (property === "then" || property === "toJSON" || typeof property === "symbol")
          return undefined;
        return getPath([String(property)]);
      },
    },
  ) as unknown as BlobGetAccessor;
  const set = new Proxy(
    function () {
      return undefined;
    },
    {
      apply(_target, _thisArg, args: unknown[]) {
        if (args.length < 2 || args.length > 3 || typeof args[0] !== "string") {
          return Promise.reject(
            new TypeError("Blob set accepts an id, Blob, and optional options"),
          );
        }
        return setBlob(args[0], args[1] as Blob, args[2] as BlobSetOptions | undefined);
      },
      get(_target, property) {
        if (property === "then" || property === "toJSON" || typeof property === "symbol")
          return undefined;
        return setPath([String(property)]);
      },
    },
  ) as unknown as BlobSetAccessor;
  const del = new Proxy(
    function () {
      return undefined;
    },
    {
      apply(_target, _thisArg, args: unknown[]) {
        if (args.length !== 1 || typeof args[0] !== "string") {
          return Promise.reject(new TypeError("Blob delete accepts exactly one id"));
        }
        return deleteBlob(args[0]);
      },
      get(_target, property) {
        if (property === "then" || property === "toJSON" || typeof property === "symbol")
          return undefined;
        return deletePath([String(property)]);
      },
    },
  ) as unknown as BlobDeleteAccessor;

  const result = {
    name: backend.name,
    proxy,
    get,
    set,
    delete: del,
    del,
    async close() {
      await Promise.resolve((backend as BlobBackendLifecycle).close?.());
    },
  } satisfies HookedBlobBackend;

  return result;
}

export function splitBlobId(id: string): string[] {
  const parts = id.split("/");
  if (!id || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("Blob id must be a relative path without traversal segments");
  }
  return parts;
}

/**
 * Select a preferred persistent backend once, falling back only when its
 * initialization cannot complete. I/O errors after initialization stay visible
 * to the caller instead of silently switching storage locations.
 */
export function createBlobFallbackBackend(
  preferred: BlobBackend & BlobBackendLifecycle,
  fallback: BlobBackend & BlobBackendLifecycle,
): BlobBackend & { close(): Promise<void> } {
  let selected: Promise<BlobBackend> | undefined;
  let closed = false;

  const select = (): Promise<BlobBackend> => {
    if (closed) return Promise.reject(new Error("Blob backend is closed"));
    if (!selected) {
      selected = (async () => {
        try {
          await preferred.ready?.();
          return preferred;
        } catch {
          await Promise.resolve(preferred.close?.()).catch(() => undefined);
          return fallback;
        }
      })();
    }
    return selected;
  };

  return {
    name: `${preferred.name}|fallback:${fallback.name}`,
    async set(id, value) {
      await (await select()).set(id, value);
    },
    async get(id) {
      return (await select()).get(id);
    },
    async delete(id) {
      await (await select()).delete(id);
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all([
        Promise.resolve(preferred.close?.()).catch(() => undefined),
        Promise.resolve(fallback.close?.()).catch(() => undefined),
      ]);
    },
  };
}
