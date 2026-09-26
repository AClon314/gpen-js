import { createBlobBackend, type HookedBlobBackend } from "./blob.js";
import { createKvStorage } from "./kv.js";
import {
  createBridgeBlobBackend,
  createBridgeKvBackend,
  createWebviewBridge,
  getVscodeStorageApi,
} from "./vscodeBridge.js";
import { createHostBlobBackend, createHostKvBackend, DEFAULT_STATE_PATH } from "./vscodeFs.js";
import type { JsonValue, Storage } from "./types.js";
import type { VscodeStorageOptions } from "./vscodeTypes.js";

export {
  /** 取注入的 / 全局的 `acquireVsCodeApi`。 */
  getVscodeStorageApi,
  /** 当前运行时是否具备 VS Code 存储（宿主 / 桥 / webview API）。 */
  hasVscodeStorage,
} from "./vscodeBridge.js";
export {
  /** webview → 扩展的存储请求消息类型。 */
  VSCODE_STORAGE_REQUEST,
  /** 扩展 → webview 的存储响应消息类型。 */
  VSCODE_STORAGE_RESPONSE,
} from "./vscodeTypes.js";
export type {
  /** 扩展侧的文件系统操作（mkdir / write / read / remove）。 */
  VscodeBlobFileSystem,
  /** 通过消息传递的 Blob 载荷（ArrayBuffer + MIME）。 */
  VscodeBlobPayload,
  /** VS Code `Memento` 形状（get / update）。 */
  VscodeMemento,
  /** 存储请求 / 响应桥（带超时与 dispose）。 */
  VscodeStorageBridge,
  /** 扩展宿主实现（memento + blob / fileSystem 二选一）。 */
  VscodeStorageHost,
  /** 存储桥支持的操作。 */
  VscodeStorageOperation,
  /** VS Code 存储选项（作用域、webview / bridge / host、超时）。 */
  VscodeStorageOptions,
  /** 一条存储请求（请求 id + 操作 + 载荷）。 */
  VscodeStorageRequest,
  /** 一条存储响应（ok / 值 / 错误）。 */
  VscodeStorageResponse,
  /** VS Code 存储作用域：workspace / global。 */
  VscodeStorageScope,
  /** webview 侧 `postMessage` 的最小形状。 */
  VscodeWebviewApi,
} from "./vscodeTypes.js";

/** 组装 VS Code webview 端的 Storage。 */
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
