import { createBrowserStorage, getBrowserStorage, type BrowserStorageOptions } from "./browser.js";
import { createBlobBackend, type BlobStorageOptions, type HookedBlobBackend } from "./blob.js";
import { createMonkeyStorage, getMonkeyStorageApi, type MonkeyStorageOptions } from "./monkey.js";
import { createVscodeStorage, hasVscodeStorage, type VscodeStorageOptions } from "./vscode.js";
import { createWebsiteStorage, type WebsiteStorageOptions } from "./website.js";
import { createKvStorage } from "./kv.js";
import type {
  BlobBackend,
  JsonValue,
  KvBackend,
  KvStorage,
  KvStorageOptions,
  Storage,
} from "./types.js";

export type {
  /** 一组 KV + Blob 后端（runtime 适配器的公共形状）。 */
  Storage,
  /** Blob 后端的 set / get / delete 接口。 */
  BlobBackend,
  /** 可 JSON 序列化的值（递归定义，含对象与数组）。 */
  JsonValue,
  /** 一份完整 KV 的读写后端（整体 load / save）。 */
  KvBackend,
} from "./types.js";
export type {
  /** 写 Blob 时可带的附加信息（原始来源 / 持久化 URL）。 */
  BlobSetOptions,
} from "./types.js";
export {
  /** 用后端与选项创建 KV。 */
  createKvStorage,
} from "./kv.js";
export {
  /** 结构化克隆一份值（无 structuredClone 时退回 JSON）。 */
  deepClone,
  /** 不可变地删掉 `path` 指向的键，返回新的根。 */
  deleteAtPath,
  /** 列出 `path` 处的键（不是容器则返回空数组）。 */
  listKeysAtPath,
  /** 不可变地往 `path` 写值，返回新的根（沿途缺容器则补）。 */
  setAtPath,
} from "./kvJson.js";
export type {
  /** delete 钩子：删除时联动外部存储之类的副作用。 */
  KvDeleteHook,
  /** delete 钩子的上下文：路径、根与被删的旧值。 */
  KvDeleteHookContext,
  /** get 钩子：可改写 / 兜底读到的值（返回 undefined 走原逻辑）。 */
  KvGetHook,
  /** get 钩子的上下文：路径、根、当前值。 */
  KvGetHookContext,
  /** 首次读取前的初始值：值、Promise，或基于旧值的迁移函数。 */
  KvInitialValue,
  /** set 钩子：写入时联动外部存储之类的副作用。 */
  KvSetHook,
  /** set 钩子的上下文：路径、根、新值与旧值。 */
  KvSetHookContext,
  /** 路径访问器（get / set / del / proxy）+ 提交接口。 */
  KvStorage,
  /** 可按名字注册的 get / set / delete 钩子集合。 */
  KvStorageHooks,
  /** 创建 KV 时的选项（缓存开关、初始值、版本、钩子）。 */
  KvStorageOptions,
  /** Runtime hook registries. The maps are intentionally mutable so plugins can */
  KvStorageProxy,
  /** 路径键：对象字段名或数组下标。 */
  StoragePathKey,
} from "./types.js";

export {
  /** Add an operation proxy and mutable hooks to any Blob backend. The direct */
  createBlobBackend,
  /** Select a preferred persistent backend once, falling back only when its */
  createBlobFallbackBackend,
  /** OPFS broker iframe 的默认来源。 */
  DEFAULT_BLOB_TARGET_DOMAIN,
  /** 把 Blob id 拆成路径段，拒绝空段与 `..` 穿越。 */
  splitBlobId,
} from "./blob.js";
export type {
  /** Blob delete 钩子：删除时联动 KV 之类的副作用。 */
  BlobDeleteHook,
  /** Blob delete 钩子上下文（id、路径）。 */
  BlobDeleteHookContext,
  /** Blob get 钩子：可改写读到的 Blob。 */
  BlobGetHook,
  /** Blob get 钩子上下文（id、路径、读到的值）。 */
  BlobGetHookContext,
  /** 顶层 `get(id)` 访问器，同时可按路径下钻。 */
  BlobGetAccessor,
  /** 可继续下钻的读路径（PromiseLike 的 Blob）。 */
  BlobReadPath,
  /** 顶层 `set(id, value)` 访问器，同时可按路径下钻。 */
  BlobSetAccessor,
  /** 可继续下钻的写路径。 */
  BlobSetPath,
  /** 顶层 `delete(id)` 访问器，同时可按路径下钻。 */
  BlobDeleteAccessor,
  /** 可继续下钻的删除路径。 */
  BlobDeletePath,
  /** Blob set 钩子：写入时联动 KV 之类的副作用。 */
  BlobSetHook,
  /** Blob set 钩子上下文（id、路径、写入的值与选项）。 */
  BlobSetHookContext,
  /** 可按名字注册的 get / set / delete Blob 钩子。 */
  BlobStorageHooks,
  /** Blob 存储选项（目标域 + 与 KV 联动的钩子）。 */
  BlobStorageOptions,
  /** Mutable hook registries. Assigning a new function at runtime is supported. */
  BlobStorageProxy,
  /** 创建带钩子 Blob 后端的选项（后端 + 钩子）。 */
  CreateBlobBackendOptions,
  /** 带钩子代理的 Blob 后端（get / set / delete / del + close）。 */
  HookedBlobBackend,
} from "./blob.js";
export {
  /** Convert a local path to a URL while preserving already URL-shaped sources. */
  asExternalUrl,
  /** Wrap a Blob backend and keep a URL/record for each stored Blob in KV. */
  bindBlobToKv,
  /** Build the hooks separately when a backend is created before the KV object. */
  createBlobKvSyncHooks,
} from "./sync.js";
export type {
  /** Blob↔KV 同步钩子上下文（额外带 KV 键与记录路径）。 */
  BlobKvRecordContext,
  /** 把 Blob 写入映射成 KV 记录的选项。 */
  BlobKvSyncOptions,
} from "./sync.js";
export {
  /** 用依赖创建 Gpen 二进制文档存储。 */
  createGpenBinaryStore,
  /** Blob path prefix; full blob id is `${GPEN_BLOB_PREFIX}/${id}.bin`. */
  GPEN_BLOB_PREFIX,
  /** 二进制文档 Blob 的 MIME 类型。 */
  GPEN_BLOB_TYPE,
  /** Codec version written into every metadata entry; bump on wire-format change. */
  GPEN_CODEC_VERSION,
  /** KV namespace key holding the per-document metadata map. */
  GPEN_KV_NAMESPACE,
  /** Protocol schema version written into every metadata entry. */
  GPEN_SCHEMA_VERSION,
  /** Diagnostic error carrying the storage context for a failed Gpen document operation. */
  GpenStorageError,
} from "./gpenBinary.js";
export type {
  /** Gpen 文档的二进制存储接口（保存 / 读取 / 元数据 / 删除 / 提交）。 */
  GpenBinaryStore,
  /** Gpen 二进制文档存储的依赖（KV / Blob / 可选 bus 与缓存）。 */
  GpenBinaryStoreDeps,
  /** KV root shape expected by the Gpen binary store (`kv.gpen.<documentId>`). */
  GpenKvRoot,
  /** Versioned JSON metadata stored in KV for one Gpen document. Pure JSON: */
  GpenMetadata,
  /** Gpen 文档存储失败的诊断码。 */
  GpenStorageErrorCode,
} from "./gpenBinary.js";
export {
  /** 通过 tab bus 远程读写 Blob 的后端。 */
  createTabBusBlobBackend,
  /** 在持有真实 Blob 的页面里跑 broker，响应其他 tab 的读 / 写 / 删。 */
  createTabBusBlobBroker,
} from "./tabBusBlob.js";
export type {
  /** tab bus Blob 后端选项（名字 / 超时 / 客户端 id）。 */
  TabBusBlobOptions,
} from "./tabBusBlob.js";
export {
  /** 建一个直接读写 OPFS 的 Blob 后端。 */
  createOpfsBlobBackend,
  /** 在 OPFS 宿主页里跑 broker，替跨域页面读写 Blob。 */
  createOpfsBlobBroker,
  /** 建一个通过 tab bus 访问远程 OPFS broker 的 Blob 后端。 */
  createOpfsTabBusBlobBackend,
} from "./opfs.js";
export type {
  /** OPFS Blob 后端选项（根目录句柄 / 子目录）。 */
  OpfsBlobOptions,
  /** 通过 tab bus 访问远程 OPFS broker 的选项。 */
  OpfsTabBusBlobOptions,
} from "./opfs.js";

export {
  /** 用扩展 storage 组装 Storage。 */
  createBrowserStorage,
  /** 取注入的 / 全局的扩展 storage API。 */
  getBrowserStorage,
  /** 用扩展 storage.local 建 KV 后端。 */
  createBrowserKvBackend,
} from "./browser.js";
export type {
  /** WebExtension `storage.local` 的最小形状。 */
  BrowserStorageApi,
  /** 扩展存储选项（storageKey / 注入的 storage API）。 */
  BrowserStorageOptions,
} from "./browser.js";
export {
  /** 用油猴 GM 存储组装 Storage。 */
  createMonkeyStorage,
  /** 取注入的 / 全局的 GM 存储 API。 */
  getMonkeyStorageApi,
} from "./monkey.js";
export type {
  /** 油猴 `GM_*` 存储 API 的最小形状。 */
  MonkeyStorageApi,
  /** 油猴存储选项（KV + Blob + storageKey / api）。 */
  MonkeyStorageOptions,
} from "./monkey.js";
export {
  /** 组装 VS Code webview 端的 Storage。 */
  createVscodeStorage,
  /** 取注入的 / 全局的 `acquireVsCodeApi`。 */
  getVscodeStorageApi,
  /** 当前运行时是否具备 VS Code 存储（宿主 / 桥 / webview API）。 */
  hasVscodeStorage,
  /** webview → 扩展的存储请求消息类型。 */
  VSCODE_STORAGE_REQUEST,
  /** 扩展 → webview 的存储响应消息类型。 */
  VSCODE_STORAGE_RESPONSE,
} from "./vscode.js";
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
} from "./vscode.js";
export {
  /** 用已打开的 IndexedDB 连接建 Blob 后端。 */
  createIndexedDbBlobBackend,
  /** 用已打开的 IndexedDB 连接建 KV 后端。 */
  createIndexedDbKvBackend,
  /** 组装网页端 Storage（KV + Blob，OPFS 不可用时回退）。 */
  createWebsiteStorage,
  /** 打开（必要时升级）IndexedDB，返回连接的 Promise。 */
  openStorageDatabase,
} from "./website.js";
export type {
  /** 网页端 IndexedDB 存储选项（库名 / 两个 store 名 / KV key）。 */
  WebsiteStorageOptions,
} from "./website.js";

/** 纯内存存储选项（KV + Blob）。 */
export type MemoryStorageOptions<T extends JsonValue = JsonValue> = KvStorageOptions<T> &
  BlobStorageOptions;

/** 运行时存储选项的并集（网页 / 扩展 / 油猴 / VS Code）。 */
export type RuntimeStorageOptions<T extends JsonValue = JsonValue> = BrowserStorageOptions<T> &
  WebsiteStorageOptions<T> &
  MonkeyStorageOptions<T> &
  VscodeStorageOptions<T>;

/** 判断对象是否是 Blob 后端（有 set / get / delete）。 */
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

/** 建一个内存 KV 后端（可注入初始数据）。 */
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

/** 建一个内存 Blob 后端。 */
export function createMemoryBlobBackend(): HookedBlobBackend {
  return createBlobBackend();
}

/** 建一个纯内存 Storage（小集成与测试用）。 */
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
