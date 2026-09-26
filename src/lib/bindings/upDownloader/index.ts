import { asError } from "../../error.js";

export {
  /** 创建 VS Code 版上传 / 下载选择器。 */
  createVscodeUploadDownloadSelector,
  /** 基于 webview postMessage 的请求 / 响应桥。 */
  createVscodeFileTransferBridge,
  /** 默认的本地状态文件路径（`.gpen/state.jsonc`）。 */
  DEFAULT_EXTERNAL_STATE_PATH,
  /** webview → 扩展的文件传输请求消息类型。 */
  VSCODE_FILE_REQUEST,
  /** 扩展 → webview 的文件传输响应消息类型。 */
  VSCODE_FILE_RESPONSE,
} from "./vscode.js";
export type {
  /** 文件传输桥支持的操作。 */
  VscodeFileOperation,
  /** 扩展侧的文件系统操作（读 / 写 / mkdir / 符号链接 / 打开）。 */
  VscodeFileSystem,
  /** 宿主提供的文件传输 API（上传 / 下载 / 文件操作）。 */
  VscodeFileTransferApi,
  /** 文件传输请求 / 响应桥（带超时与 dispose）。 */
  VscodeFileTransferBridge,
  /** A host can be passed directly, or the same shape can be used by tests. */
  VscodeFileTransferHost,
  /** VS Code 文件传输选项（模式、宿主 / 桥、路径策略、状态文件）。 */
  VscodeFileTransferOptions,
  /** 一条文件传输请求（请求 id + 操作 + 载荷）。 */
  VscodeFileTransferRequest,
  /** 一条文件传输响应（ok / 值 / 错误）。 */
  VscodeFileTransferResponse,
  /** webview 侧 `postMessage` 的最小形状。 */
  VscodeFileTransferWebviewApi,
  /** 上传输入：文件输入元素、File 或路径字符串。 */
  VscodeUploadInput,
  /** 一次上传的结果（目标文件、来源 / 目的地、是否建链 / 记账）。 */
  VscodeUploadResult,
  /** VS Code 选择器的对外接口（含 detailed 上传）。 */
  VscodeUploadDownloadSelector,
} from "./vscode.js";

/** 统一的文件选择 / 下载接口。 */
export interface FileSelector {
  upload(input: HTMLInputElement | File): File | undefined;
  download(value: Blob | string, name: string): Promise<void>;
}

function isFileLike(value: unknown): value is File {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<File>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.size === "number" &&
    typeof candidate.arrayBuffer === "function"
  );
}

/** Accept both the MDN file input element and an already selected File. */
export function uploadFromInput(input: HTMLInputElement | File): File | undefined {
  if (isFileLike(input)) return input;
  if (input.type !== "file") {
    throw new TypeError('Blob upload requires an <input type="file"> element');
  }
  return input.files?.[0];
}

function revokeObjectUrl(url: string | undefined): void {
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
}

/** 用 `<a download>` 触发浏览器下载（Blob 先转 object URL）。 */
export function downloadInBrowser(value: Blob | string, name: string): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Browser Blob download requires a document"));
  }

  let objectUrl: string | undefined;
  try {
    if (typeof value !== "string") {
      if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
        throw new Error("Blob download requires URL.createObjectURL");
      }
      objectUrl = URL.createObjectURL(value);
    }

    const url = objectUrl ?? (typeof value === "string" ? value : undefined);
    if (!url) throw new Error("Blob download URL is unavailable");

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    (document.body ?? document.documentElement)?.append(anchor);
    anchor.click();
    anchor.remove();

    if (objectUrl) setTimeout(() => revokeObjectUrl(objectUrl), 0);
    return Promise.resolve();
  } catch (cause) {
    revokeObjectUrl(objectUrl);
    return Promise.reject(cause);
  }
}

/** Create the MDN/File API selector explicitly. */
export function createNativeUploadDownloadSelector(): FileSelector {
  return {
    upload: uploadFromInput,
    download: downloadInBrowser,
  };
}

/** 油猴 `GM_download` 的参数。 */
export interface MonkeyDownloadDetails {
  url: string;
  name: string;
  saveAs?: boolean;
  onload?: () => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}

/** 油猴下载 API 的最小形状。 */
export type MonkeyDownloadApi = (details: MonkeyDownloadDetails) => unknown;

/** 取注入的 / 全局的 GM 下载 API。 */
export function getMonkeyDownloadApi(api?: MonkeyDownloadApi): MonkeyDownloadApi | undefined {
  if (api) return api;
  const globalObject = globalThis as typeof globalThis & {
    GM_download?: MonkeyDownloadApi;
    GM?: {
      download?: MonkeyDownloadApi;
    };
  };
  if (typeof globalObject.GM_download === "function") {
    return (details) => globalObject.GM_download!(details);
  }
  if (typeof globalObject.GM?.download === "function") {
    return (details) => globalObject.GM!.download!(details);
  }
  return undefined;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function downloadWithMonkey(
  download: MonkeyDownloadApi,
  value: Blob | string,
  name: string,
): Promise<void> {
  let objectUrl: string | undefined;
  if (typeof value !== "string") {
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      return Promise.reject(new Error("Blob download requires URL.createObjectURL"));
    }
    objectUrl = URL.createObjectURL(value);
  }

  const url: string = typeof value === "string" ? value : objectUrl!;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (objectUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (reason: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(asError(reason, "GM_download failed"));
    };

    try {
      const result = download({
        url,
        name,
        onload: finish,
        onerror: fail,
        ontimeout: () => fail(new Error("GM_download timed out")),
      });
      if (isPromiseLike(result)) {
        result.then(() => finish(), fail);
      }
    } catch (cause) {
      fail(cause);
      // oxlint-disable-next-line catch/no-bare-return -- fail() 已 reject，错误已传播
      return;
    }
  });
}

/** 优先用 GM_download、否则退回原生下载的 FileSelector。 */
export function createMonkeyUploadDownloadSelector(api?: MonkeyDownloadApi): FileSelector {
  const download = getMonkeyDownloadApi(api);
  return {
    upload: uploadFromInput,
    async download(value, name) {
      if (!download) throw new Error("Userscript GM_download is unavailable in this runtime");
      await downloadWithMonkey(download, value, name);
    },
  };
}

/**
 * Create a file selector/downloader without persistence.
 *
 * The selector uses `GM_download` when a userscript manager exposes it and
 * otherwise falls back to the native File API. The selected file can be
 * passed to any Blob backend later; this helper does not call `set()`, `get()`
 * or `delete()`.
 *
 * @example
 * ```ts
 * const selector = createUploadDownloadOnlyBlob();
 * const file = selector.upload(fileInput);
 * if (file) await selector.download(file, file.name);
 * ```
 */
export function createUploadDownloadOnlyBlob(): FileSelector {
  return createRuntimeUploadDownloadSelector();
}

/**
 * Select the download implementation for the current runtime.
 *
 * Pass an API explicitly when adapting a userscript host or when testing; in
 * normal use the function detects `GM_download` and `GM.download` globally.
 */
export function createRuntimeUploadDownloadSelector(api?: MonkeyDownloadApi): FileSelector {
  const monkey = getMonkeyDownloadApi(api);
  return monkey ? createMonkeyUploadDownloadSelector(monkey) : createNativeUploadDownloadSelector();
}
