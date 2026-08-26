import {
  createBlobBackend,
  type BlobDeleteHookContext,
  type BlobSetHookContext,
  type BlobStorageHooks,
  type HookedBlobBackend,
} from "./blob.js";
import type { BlobBackend, JsonValue } from "./types.js";
import type { KvStorage, StoragePathKey } from "./kv.js";

export interface BlobKvRecordContext extends BlobSetHookContext {
  readonly key: string;
  readonly recordPath: readonly StoragePathKey[];
}

export interface BlobKvSyncOptions<T extends JsonValue> {
  /** KV store receiving the external Blob reference. */
  kv: KvStorage<T>;
  /** Location of the metadata object. Defaults to `blob/<basename>`. */
  recordPath?:
    | readonly StoragePathKey[]
    | ((context: BlobSetHookContext) => readonly StoragePathKey[]);
  /** Key below recordPath. Defaults to the Blob id's basename. */
  key?: string | ((context: BlobSetHookContext) => string);
  /** URL written to KV. Defaults to set options' url/source, then blob:<id>. */
  url?:
    | string
    | ((context: BlobSetHookContext) => string | undefined | PromiseLike<string | undefined>);
  /** Build a complete JSON record instead of storing only a URL string. */
  record?: (context: BlobKvRecordContext) => JsonValue | PromiseLike<JsonValue>;
  /** Submit KV after a Blob mutation. Defaults to true. */
  submit?: boolean;
  /** Remove the matching KV entry after Blob deletion. Defaults to true. */
  removeOnDelete?: boolean;
}

type BlobKeyContext = BlobSetHookContext | BlobDeleteHookContext;

function pathNode(root: unknown, path: readonly StoragePathKey[]): unknown {
  let node = root;
  for (const key of path) {
    if (!node || (typeof node !== "object" && typeof node !== "function")) {
      throw new TypeError("Cannot address a KV path through a non-object node");
    }
    node = (node as Record<string, unknown>)[String(key)];
  }
  return node;
}

async function setKvPath<T extends JsonValue>(
  kv: KvStorage<T>,
  path: readonly StoragePathKey[],
  value: JsonValue,
): Promise<void> {
  if (path.length === 0) throw new TypeError("A KV record path cannot be empty");
  const node = pathNode(kv.set, path);
  if (typeof node !== "function") throw new TypeError("KV set path is not writable");
  await (node as (value: JsonValue) => Promise<void>)(value);
}

async function deleteKvPath<T extends JsonValue>(
  kv: KvStorage<T>,
  path: readonly StoragePathKey[],
): Promise<void> {
  if (path.length === 0) throw new TypeError("A KV record path cannot be empty");
  const node = pathNode(kv.del, path);
  if (!node || (typeof node !== "object" && typeof node !== "function")) {
    throw new TypeError("KV delete path is unavailable");
  }
  await (node as PromiseLike<void>);
}

/** Convert a local path to a URL while preserving already URL-shaped sources. */
export function asExternalUrl(value: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return `file:///${encodeURI(value.replaceAll("\\", "/"))}`;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
  return `file://${encodeURI(value.startsWith("/") ? value : `/${value}`)}`;
}

function contextForKey<T extends JsonValue>(
  resolver: BlobKvSyncOptions<T>["key"],
  context: BlobKeyContext,
): string {
  if (typeof resolver === "function") return resolver(context as BlobSetHookContext);
  return resolver ?? context.path[context.path.length - 1] ?? context.id;
}

function contextForRecordPath<T extends JsonValue>(
  resolver: BlobKvSyncOptions<T>["recordPath"],
  context: BlobKeyContext,
): readonly StoragePathKey[] {
  if (typeof resolver === "function") return resolver(context as BlobSetHookContext);
  return resolver ?? ["blob"];
}

/** Build the hooks separately when a backend is created before the KV object. */
export function createBlobKvSyncHooks<T extends JsonValue>(
  options: BlobKvSyncOptions<T>,
): BlobStorageHooks {
  const submit = options.submit ?? true;
  const recordPath = (context: BlobKeyContext): readonly StoragePathKey[] =>
    contextForRecordPath(options.recordPath, context);
  const recordKey = (context: BlobKeyContext): string => contextForKey(options.key, context);
  const completePath = (context: BlobKeyContext): readonly StoragePathKey[] => [
    ...recordPath(context),
    recordKey(context),
  ];

  const urlFor = async (context: BlobSetHookContext): Promise<string> => {
    const configured = typeof options.url === "function" ? await options.url(context) : options.url;
    const source = configured ?? context.options?.url ?? context.options?.source;
    return source ? asExternalUrl(source) : `blob:${context.id}`;
  };

  return {
    setters: {
      blobToKvRecord: async (context) => {
        const key = recordKey(context);
        const recordContext: BlobKvRecordContext = {
          ...context,
          key,
          recordPath: completePath(context),
        };
        const value = options.record ? await options.record(recordContext) : await urlFor(context);
        await setKvPath(options.kv, completePath(context), value);
        if (submit) await options.kv.submit();
      },
    },
    ...(options.removeOnDelete === false
      ? {}
      : {
          deleters: {
            blobToKvRecord: async (context: { id: string; path: readonly string[] }) => {
              await deleteKvPath(options.kv, completePath(context as BlobDeleteHookContext));
              if (submit) await options.kv.submit();
            },
          },
        }),
  };
}

/** Wrap a Blob backend and keep a URL/record for each stored Blob in KV. */
export function bindBlobToKv<T extends JsonValue>(
  blob: BlobBackend,
  options: BlobKvSyncOptions<T>,
): HookedBlobBackend {
  return createBlobBackend(blob, { hooks: createBlobKvSyncHooks(options) });
}
