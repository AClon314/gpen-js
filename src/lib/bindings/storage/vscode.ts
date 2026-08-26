import {
  createBlobBackend,
  splitBlobId,
  type BlobStorageOptions,
  type HookedBlobBackend,
} from "./blob.js";
import { createKvStorage, type KvStorageOptions } from "./kv.js";
import type { BlobBackend, JsonValue, KvBackend, Storage } from "./types.js";

export const VSCODE_STORAGE_REQUEST = "gpen.storage.request";
export const VSCODE_STORAGE_RESPONSE = "gpen.storage.response";

export type VscodeStorageScope = "workspace" | "global";
export type VscodeStorageOperation =
  | "kv.load"
  | "kv.save"
  | "blob.set"
  | "blob.get"
  | "blob.delete";

export interface VscodeBlobPayload {
  data: ArrayBuffer;
  type?: string;
}

export interface VscodeStorageRequest {
  type: typeof VSCODE_STORAGE_REQUEST;
  id: string;
  operation: VscodeStorageOperation;
  scope: VscodeStorageScope;
  key?: string;
  value?: JsonValue;
  blob?: VscodeBlobPayload;
}

export interface VscodeStorageResponse {
  type: typeof VSCODE_STORAGE_RESPONSE;
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface VscodeWebviewApi {
  postMessage(message: VscodeStorageRequest): boolean | PromiseLike<boolean>;
}

export interface VscodeMemento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): void | PromiseLike<void>;
}

export interface VscodeBlobFileSystem {
  mkdir(path: string): Promise<void>;
  write(path: string, data: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array | undefined>;
  remove(path: string): Promise<void>;
}

interface VscodeStorageHostState {
  workspaceState?: VscodeMemento;
  globalState?: VscodeMemento;
}

export type VscodeStorageHost = VscodeStorageHostState &
  (
    | { blob: BlobBackend; fileSystem?: VscodeBlobFileSystem }
    | { fileSystem: VscodeBlobFileSystem; blob?: BlobBackend }
  );

export interface VscodeStorageBridge {
  request<T>(message: Omit<VscodeStorageRequest, "type" | "id">): Promise<T>;
  dispose?(): void;
}

export interface VscodeStorageOptions<T extends JsonValue = JsonValue>
  extends KvStorageOptions<T>, BlobStorageOptions {
  storageKey?: string;
  statePath?: string;
  scope?: VscodeStorageScope;
  webview?: VscodeWebviewApi;
  bridge?: VscodeStorageBridge;
  host?: VscodeStorageHost;
  requestTimeoutMs?: number;
}

interface MessageTarget {
  addEventListener(type: "message", listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data?: unknown }) => void): void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

let nextRequestId = 0;

function getMessageTarget(): MessageTarget {
  const target = globalThis as unknown as Partial<MessageTarget>;
  if (
    typeof target.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  ) {
    throw new Error("VS Code webview message events are unavailable in this runtime");
  }
  return target as MessageTarget;
}

function createWebviewBridge(api: VscodeWebviewApi, timeoutMs: number): VscodeStorageBridge {
  const target = getMessageTarget();
  const pending = new Map<string, PendingRequest>();

  const onMessage = (event: { data?: unknown }) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    const response = data as Partial<VscodeStorageResponse>;
    if (response.type !== VSCODE_STORAGE_RESPONSE || typeof response.id !== "string") return;

    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);

    if (response.ok) {
      request.resolve(response.value);
    } else {
      request.reject(new Error(response.error ?? "VS Code storage request failed"));
    }
  };

  target.addEventListener("message", onMessage);

  return {
    request<T>(message: Omit<VscodeStorageRequest, "type" | "id">): Promise<T> {
      const id = `gpen-${++nextRequestId}`;
      const requestMessage = {
        type: VSCODE_STORAGE_REQUEST,
        id,
        ...message,
      } as VscodeStorageRequest;

      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`VS Code storage request timed out: ${message.operation}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });

        try {
          Promise.resolve(api.postMessage(requestMessage)).then(
            (sent) => {
              if (!sent) {
                const current = pending.get(id);
                if (!current) return;
                pending.delete(id);
                clearTimeout(current.timer);
                current.reject(new Error("VS Code rejected the storage message"));
              }
            },
            (cause) => {
              const current = pending.get(id);
              if (!current) return;
              pending.delete(id);
              clearTimeout(current.timer);
              current.reject(cause);
            },
          );
        } catch (cause) {
          const current = pending.get(id);
          if (!current) return;
          pending.delete(id);
          clearTimeout(current.timer);
          current.reject(cause);
        }
      });
    },
    dispose() {
      target.removeEventListener("message", onMessage);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("VS Code storage bridge was closed"));
      }
      pending.clear();
    },
  };
}

export function getVscodeStorageApi(api?: VscodeWebviewApi): VscodeWebviewApi | undefined {
  const globalObject = globalThis as typeof globalThis & {
    acquireVsCodeApi?: () => VscodeWebviewApi;
  };
  return api ?? globalObject.acquireVsCodeApi?.();
}

export function hasVscodeStorage<T extends JsonValue = JsonValue>(
  options: VscodeStorageOptions<T> = {},
): boolean {
  const globalObject = globalThis as typeof globalThis & {
    acquireVsCodeApi?: () => VscodeWebviewApi;
  };
  return Boolean(
    options.host ||
    options.bridge ||
    options.webview ||
    typeof globalObject.acquireVsCodeApi === "function",
  );
}

function blobPath(id: string): string {
  return [".gpen", "blob", ...splitBlobId(id)].join("/");
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function stripJsonComments(value: string): string {
  let result = "";
  let quote = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += character;
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (!quote && character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (!quote && character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    result += character;
    if (character === '"' && !escaped) quote = !quote;
    escaped = character === "\\" && !escaped;
    if (character !== "\\") escaped = false;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

const DEFAULT_STATE_PATH = ".gpen/state.jsonc";

function parseState(data: Uint8Array | undefined): JsonValue {
  if (!data) return {};
  const text = new TextDecoder()
    .decode(data)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!text) return {};
  return JSON.parse(stripJsonComments(text)) as JsonValue;
}

function encodeState(value: JsonValue): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

async function ensureBlobDirectories(
  fileSystem: VscodeBlobFileSystem,
  path: string,
): Promise<void> {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    await fileSystem.mkdir(parts.slice(0, index).join("/"));
  }
}

function createHostBlobBackend(host: VscodeStorageHost): BlobBackend {
  if (host.blob) {
    if (
      typeof host.blob.set !== "function" ||
      typeof host.blob.get !== "function" ||
      typeof host.blob.delete !== "function"
    ) {
      throw new TypeError("VS Code host.blob must provide persistent set/get/delete methods");
    }
    return host.blob;
  }
  if (!host.fileSystem) throw new Error("VS Code host must provide a persistent Blob backend");

  const fileSystem = host.fileSystem;
  return {
    name: "vscode:workspace/.gpen/blob",
    async set(id, value) {
      const path = blobPath(id);
      await ensureBlobDirectories(fileSystem, path);
      await fileSystem.write(path, new Uint8Array(await value.arrayBuffer()));
    },
    async get(id) {
      const data = await fileSystem.read(blobPath(id));
      return data === undefined ? undefined : new Blob([toArrayBuffer(data)]);
    },
    async delete(id) {
      await fileSystem.remove(blobPath(id));
    },
  };
}

function selectMemento(host: VscodeStorageHost, scope: VscodeStorageScope): VscodeMemento {
  const memento =
    scope === "global"
      ? (host.globalState ?? host.workspaceState)
      : (host.workspaceState ?? host.globalState);
  if (!memento) throw new Error(`VS Code ${scope}State is unavailable`);
  return memento;
}

function createHostKvBackend<T extends JsonValue>(
  host: VscodeStorageHost,
  scope: VscodeStorageScope,
  key: string,
  statePath: string,
): KvBackend<T> {
  if (host.fileSystem) {
    const fileSystem = host.fileSystem;
    return {
      name: `vscode:workspace/${statePath}`,
      async load() {
        return parseState(await fileSystem.read(statePath)) as T;
      },
      async save(value) {
        await fileSystem.mkdir(".gpen");
        await fileSystem.write(statePath, encodeState(value));
      },
    };
  }
  const memento = selectMemento(host, scope);
  return {
    name: `vscode:${scope}State`,
    async load() {
      const value = await memento.get<JsonValue>(key, {});
      return (value === undefined ? {} : value) as T;
    },
    async save(value) {
      await memento.update(key, value);
    },
  };
}

function createBridgeKvBackend<T extends JsonValue>(
  bridge: VscodeStorageBridge,
  scope: VscodeStorageScope,
  key: string,
): KvBackend<T> {
  return {
    name: `vscode:${scope}State`,
    async load() {
      const value = await bridge.request<JsonValue>({ operation: "kv.load", scope, key });
      return (value === undefined ? {} : value) as T;
    },
    async save(value) {
      await bridge.request<void>({ operation: "kv.save", scope, key, value });
    },
  };
}

function createBridgeBlobBackend(
  bridge: VscodeStorageBridge,
  scope: VscodeStorageScope,
): BlobBackend {
  return {
    name: "vscode:workspace/.gpen/blob",
    async set(id, value) {
      const data = await value.arrayBuffer();
      await bridge.request<void>({
        operation: "blob.set",
        scope,
        key: id,
        blob: { data, type: value.type },
      });
    },
    async get(id) {
      const payload = await bridge.request<VscodeBlobPayload | undefined>({
        operation: "blob.get",
        scope,
        key: id,
      });
      return payload === undefined ? undefined : new Blob([payload.data], { type: payload.type });
    },
    async delete(id) {
      await bridge.request<void>({ operation: "blob.delete", scope, key: id });
    },
  };
}

export function createVscodeStorage<T extends JsonValue = JsonValue>(
  options: VscodeStorageOptions<T> = {},
): Storage<T, HookedBlobBackend> {
  const scope = options.scope ?? "workspace";
  const key = options.storageKey ?? "gpen";

  if (options.host) {
    const blobBackend = createHostBlobBackend(options.host);
    return {
      kv: createKvStorage(
        createHostKvBackend<T>(options.host, scope, key, options.statePath ?? DEFAULT_STATE_PATH),
        options,
      ),
      blob: createBlobBackend(blobBackend, { hooks: options.blobHooks }),
    };
  }

  const bridge =
    options.bridge ??
    createWebviewBridge(
      getVscodeStorageApi(options.webview) ??
        (() => {
          throw new Error("VS Code webview API is unavailable in this runtime");
        })(),
      options.requestTimeoutMs ?? 30000,
    );
  const ownsBridge = !options.bridge;

  return {
    kv: createKvStorage(createBridgeKvBackend<T>(bridge, scope, key), options),
    blob: createBlobBackend(createBridgeBlobBackend(bridge, scope), { hooks: options.blobHooks }),
    ...(ownsBridge ? { close: async () => bridge.dispose?.() } : {}),
  };
}
