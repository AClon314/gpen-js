import { asError } from "../../error.js";

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

export interface MonkeyDownloadDetails {
  url: string;
  name: string;
  saveAs?: boolean;
  onload?: () => void;
  onerror?: (error: unknown) => void;
  ontimeout?: () => void;
}

export type MonkeyDownloadApi = (details: MonkeyDownloadDetails) => unknown;

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
    }
  });
}

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

export {
  createVscodeUploadDownloadSelector,
  createVscodeFileTransferBridge,
  DEFAULT_EXTERNAL_STATE_PATH,
  VSCODE_FILE_REQUEST,
  VSCODE_FILE_RESPONSE,
} from "./vscode.js";
export type {
  VscodeFileOperation,
  VscodeFileSystem,
  VscodeFileTransferApi,
  VscodeFileTransferBridge,
  VscodeFileTransferHost,
  VscodeFileTransferOptions,
  VscodeFileTransferRequest,
  VscodeFileTransferResponse,
  VscodeFileTransferWebviewApi,
  VscodeUploadInput,
  VscodeUploadResult,
  VscodeUploadDownloadSelector,
} from "./vscode.js";
