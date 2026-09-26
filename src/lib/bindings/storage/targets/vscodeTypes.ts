import type { BlobStorageOptions } from "../objects/blob.js";
import type { BlobBackend, JsonValue, KvStorageOptions } from "../types.js";

/** webview → 扩展的存储请求消息类型。 */
export const VSCODE_STORAGE_REQUEST = "gpen.storage.request";
/** 扩展 → webview 的存储响应消息类型。 */
export const VSCODE_STORAGE_RESPONSE = "gpen.storage.response";

/** VS Code 存储作用域：workspace / global。 */
export type VscodeStorageScope = "workspace" | "global";
/** 存储桥支持的操作。 */
export type VscodeStorageOperation =
  | "kv.load"
  | "kv.save"
  | "blob.set"
  | "blob.get"
  | "blob.delete";

/** 通过消息传递的 Blob 载荷（ArrayBuffer + MIME）。 */
export interface VscodeBlobPayload {
  data: ArrayBuffer;
  type?: string;
}

/** 一条存储请求（请求 id + 操作 + 载荷）。 */
export interface VscodeStorageRequest {
  type: typeof VSCODE_STORAGE_REQUEST;
  id: string;
  operation: VscodeStorageOperation;
  scope: VscodeStorageScope;
  key?: string;
  value?: JsonValue;
  blob?: VscodeBlobPayload;
}

/** 一条存储响应（ok / 值 / 错误）。 */
export interface VscodeStorageResponse {
  type: typeof VSCODE_STORAGE_RESPONSE;
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** webview 侧 `postMessage` 的最小形状。 */
export interface VscodeWebviewApi {
  postMessage(message: VscodeStorageRequest): boolean | PromiseLike<boolean>;
}

/** VS Code `Memento` 形状（get / update）。 */
export interface VscodeMemento {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): void | PromiseLike<void>;
}

/** 扩展侧的文件系统操作（mkdir / write / read / remove）。 */
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

/** 扩展宿主实现（memento + blob / fileSystem 二选一）。 */
export type VscodeStorageHost = VscodeStorageHostState &
  (
    | { blob: BlobBackend; fileSystem?: VscodeBlobFileSystem }
    | { fileSystem: VscodeBlobFileSystem; blob?: BlobBackend }
  );

/** 存储请求 / 响应桥（带超时与 dispose）。 */
export interface VscodeStorageBridge {
  request<T>(message: Omit<VscodeStorageRequest, "type" | "id">): Promise<T>;
  dispose?(): void;
}

/** VS Code 存储选项（作用域、webview / bridge / host、超时）。 */
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
