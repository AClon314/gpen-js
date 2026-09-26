import { asError } from "../../error.js";

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

/** 把下载值归一成可点击 URL（Blob 走 object URL，交由调用方回收）。 */
function resolveBrowserDownloadUrl(value: Blob | string): { url: string; objectUrl?: string } {
  if (typeof value === "string") return { url: value };
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Blob download requires URL.createObjectURL");
  }
  const objectUrl = URL.createObjectURL(value);
  return { url: objectUrl, objectUrl };
}

/** 用隐藏的 `<a download>` 触发一次点击下载。 */
function clickDownloadAnchor(url: string, name: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  (document.body ?? document.documentElement)?.append(anchor);
  anchor.click();
  anchor.remove();
}

/** 用 `<a download>` 触发浏览器下载（Blob 先转 object URL）。 */
export function downloadInBrowser(value: Blob | string, name: string): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Browser Blob download requires a document"));
  }

  let objectUrl: string | undefined;
  try {
    const resolved = resolveBrowserDownloadUrl(value);
    objectUrl = resolved.objectUrl;
    if (!resolved.url) throw new Error("Blob download URL is unavailable");
    clickDownloadAnchor(resolved.url, name);
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

/** 一次 GM_download 的幂等结算状态。 */
interface MonkeyDownloadSession {
  finish(): void;
  fail(reason: unknown): void;
}

/** 构造结算回调：只生效一次，并在结算时回收 object URL。 */
function createMonkeyDownloadSession(
  objectUrl: string | undefined,
  resolve: () => void,
  reject: (reason: unknown) => void,
): MonkeyDownloadSession {
  let settled = false;
  const cleanup = () => {
    if (objectUrl && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(objectUrl);
  };
  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    cleanup();
    action();
  };
  return {
    finish: () => settle(resolve),
    fail: (reason) => settle(() => reject(asError(reason, "GM_download failed"))),
  };
}

/** 调用 GM_download（同步抛错或返回 thenable 都汇入同一个 session）。 */
function runMonkeyDownload(
  download: MonkeyDownloadApi,
  details: MonkeyDownloadDetails,
  session: MonkeyDownloadSession,
): void {
  try {
    const result = download(details);
    if (isPromiseLike(result)) result.then(() => session.finish(), session.fail);
  } catch (cause) {
    session.fail(cause);
    // oxlint-disable-next-line catch/no-bare-return -- session.fail() 已 reject，错误已传播
    return;
  }
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
    const session = createMonkeyDownloadSession(objectUrl, resolve, reject);
    runMonkeyDownload(
      download,
      {
        url,
        name,
        onload: session.finish,
        onerror: session.fail,
        ontimeout: () => session.fail(new Error("GM_download timed out")),
      },
      session,
    );
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
