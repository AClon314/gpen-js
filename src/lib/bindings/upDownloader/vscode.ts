import { createSymlink, type ShellCommandRunner, type SymlinkPlatform } from "../shell/symlink.js";
export const VSCODE_FILE_REQUEST = "gpen.upDownloader.request";
export const VSCODE_FILE_RESPONSE = "gpen.upDownloader.response";
export const DEFAULT_EXTERNAL_STATE_PATH = ".gpen/state.jsonc";

export type VscodeFileOperation =
  | "upload"
  | "download"
  | "openFile"
  | "readFile"
  | "writeFile"
  | "mkdir"
  | "symlink";

export interface VscodeFileTransferRequest {
  type: typeof VSCODE_FILE_REQUEST;
  id: string;
  operation: VscodeFileOperation;
  path?: string;
  target?: string;
  name?: string;
  mime?: string;
  data?: ArrayBuffer;
}

export interface VscodeFileTransferResponse {
  type: typeof VSCODE_FILE_RESPONSE;
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface VscodeFileTransferBridge {
  request<T>(message: Omit<VscodeFileTransferRequest, "type" | "id">): Promise<T>;
  dispose?(): void;
}

export interface VscodeFileTransferWebviewApi {
  postMessage(message: VscodeFileTransferRequest): boolean | PromiseLike<boolean>;
}

export interface VscodeFileSystem {
  readFile?(path: string): Promise<Uint8Array | ArrayBuffer | undefined>;
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  mkdir?(path: string): Promise<void>;
  createSymbolicLink?(target: string, linkPath: string): Promise<void>;
  openFile?(path: string): Promise<void>;
}

export interface VscodeFileTransferApi {
  mode?: "local" | "web" | "ssh";
  upload?(file: File, destination?: string): Promise<File | VscodeUploadResult | void>;
  download?(value: Blob | string, name: string): Promise<void>;
  readFile?(path: string): Promise<Uint8Array | ArrayBuffer | undefined>;
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  mkdir?(path: string): Promise<void>;
  createSymbolicLink?(target: string, linkPath: string): Promise<void>;
  openFile?(path: string): Promise<void>;
}

/** A host can be passed directly, or the same shape can be used by tests. */
export type VscodeFileTransferHost = VscodeFileTransferApi & VscodeFileSystem;

export type VscodeUploadInput = HTMLInputElement | File | string;

export interface VscodeUploadResult {
  file?: File;
  source?: string;
  destination?: string;
  linked?: boolean;
  recorded?: boolean;
}

export interface VscodeFileTransferOptions {
  mode?: "local" | "web" | "ssh";
  /** Combined host adapter for callers that expose one unified VS Code API. */
  host?: VscodeFileTransferHost;
  api?: VscodeFileTransferApi;
  fileSystem?: VscodeFileSystem;
  bridge?: VscodeFileTransferBridge;
  webview?: VscodeFileTransferWebviewApi;
  requestTimeoutMs?: number;
  shell?: ShellCommandRunner;
  symlinkPlatform?: SymlinkPlatform;
  destination?: string | ((file: File, source?: string) => string | PromiseLike<string>);
  downloadPath?: string | ((name: string) => string | PromiseLike<string>);
  /** JSONC file used when a local symlink cannot be created. */
  statePath?: string;
  /** KV-like key under the state's `blob` object. */
  recordKey?: (file: File, source: string) => string;
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

function positiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError("VS Code file transfer timeout must be a positive finite number");
  }
  return value;
}

function messageTarget(): MessageTarget {
  const target = globalThis as unknown as Partial<MessageTarget>;
  if (
    typeof target.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  ) {
    throw new Error("VS Code webview message events are unavailable in this runtime");
  }
  return target as MessageTarget;
}

export function createVscodeFileTransferBridge(
  api: VscodeFileTransferWebviewApi,
  timeoutMs = 30000,
): VscodeFileTransferBridge {
  timeoutMs = positiveTimeout(timeoutMs);
  const target = messageTarget();
  const pending = new Map<string, PendingRequest>();
  const onMessage = (event: { data?: unknown }) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    const response = data as Partial<VscodeFileTransferResponse>;
    if (response.type !== VSCODE_FILE_RESPONSE || typeof response.id !== "string") return;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.ok) request.resolve(response.value);
    else request.reject(new Error(response.error ?? "VS Code file transfer failed"));
  };
  target.addEventListener("message", onMessage);

  return {
    request<T>(message: Omit<VscodeFileTransferRequest, "type" | "id">): Promise<T> {
      const id = `gpen-file-${++nextRequestId}`;
      const requestMessage: VscodeFileTransferRequest = {
        type: VSCODE_FILE_REQUEST,
        id,
        ...message,
      };
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`VS Code file request timed out: ${message.operation}`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          Promise.resolve(api.postMessage(requestMessage)).then(
            (sent) => {
              if (sent) return;
              const current = pending.get(id);
              if (!current) return;
              pending.delete(id);
              clearTimeout(current.timer);
              current.reject(new Error("VS Code rejected the file transfer message"));
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
          pending.delete(id);
          clearTimeout(timer);
          reject(cause);
        }
      });
    },
    dispose() {
      target.removeEventListener("message", onMessage);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("VS Code file transfer bridge was closed"));
      }
      pending.clear();
    },
  };
}

function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function isFile(value: unknown): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as { name?: unknown }).name === "string" &&
    "size" in value &&
    typeof (value as { size?: unknown }).size === "number" &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

function selectedFile(input: VscodeUploadInput): File | undefined {
  if (typeof input === "string") return undefined;
  if (isFile(input)) return input;
  if (input.type !== "file") {
    throw new TypeError('VS Code upload requires an <input type="file"> element');
  }
  return input.files?.[0];
}

function filePath(file: File): string | undefined {
  const path = (file as File & { path?: unknown }).path;
  return typeof path === "string" && path ? path : undefined;
}

function attachSourcePath(file: File, source: string | undefined): File {
  if (!source || filePath(file)) return file;
  try {
    Object.defineProperty(file, "path", { value: source, enumerable: false });
  } catch {
    // Some host-provided File implementations are sealed; the upload result
    // still carries source separately through uploadDetailed().
  }
  return file;
}

function fileNameFromPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || "attachment";
}

function externalUrl(path: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(path)) {
    return `file:///${encodeURI(path.replaceAll("\\", "/"))}`;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return path;
  return `file://${encodeURI(path.startsWith("/") ? path : `/${path}`)}`;
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

function parseJsonc(data: Uint8Array | ArrayBuffer | undefined): Record<string, unknown> {
  if (!data) return {};
  const text = new TextDecoder()
    .decode(data)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!text) return {};
  const value: unknown = JSON.parse(stripJsonComments(text));
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function encodeJsonc(value: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

function toFile(bytes: Uint8Array, name: string, type: string): File {
  if (typeof File !== "undefined") return new File([asArrayBuffer(bytes)], name, { type });
  const blob = new Blob([asArrayBuffer(bytes)], { type }) as Blob & {
    name?: string;
    lastModified?: number;
  };
  Object.defineProperty(blob, "name", { value: name, enumerable: true });
  Object.defineProperty(blob, "lastModified", { value: Date.now(), enumerable: true });
  return blob as File;
}

function emptyFile(name: string): File {
  return toFile(new Uint8Array(), name, "application/octet-stream");
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function createVscodeUploadDownloadSelector(
  options: VscodeFileTransferOptions = {},
): VscodeUploadDownloadSelector {
  const api = options.api ?? options.host;
  const fileSystem = options.fileSystem ?? options.host;
  const bridge =
    options.bridge ??
    (options.webview
      ? createVscodeFileTransferBridge(options.webview, options.requestTimeoutMs ?? 30000)
      : undefined);
  const ownsBridge = !options.bridge && Boolean(options.webview);
  const mode = options.mode ?? api?.mode ?? "local";

  const readFile = async (path: string): Promise<Uint8Array | undefined> => {
    if (api?.readFile) {
      const value = await api.readFile(path);
      return value === undefined ? undefined : asBytes(value);
    }
    if (fileSystem?.readFile) {
      const value = await fileSystem.readFile(path);
      return value === undefined ? undefined : asBytes(value);
    }
    if (bridge) {
      const value = await bridge.request<Uint8Array | ArrayBuffer | { data: ArrayBuffer }>({
        operation: "readFile",
        path,
      });
      if (value && typeof value === "object" && "data" in value) return asBytes(value.data);
      return value === undefined ? undefined : asBytes(value);
    }
    throw new Error("VS Code file read API is unavailable");
  };

  const writeFile = async (path: string, data: Uint8Array): Promise<void> => {
    if (api?.writeFile) {
      await api.writeFile(path, data);
      return;
    }
    if (fileSystem?.writeFile) {
      await fileSystem.writeFile(path, data);
      return;
    }
    if (bridge) {
      await bridge.request<void>({ operation: "writeFile", path, data: asArrayBuffer(data) });
      return;
    }
    throw new Error("VS Code file write API is unavailable");
  };

  const mkdir = async (path: string): Promise<void> => {
    if (api?.mkdir) return api.mkdir(path);
    if (fileSystem?.mkdir) return fileSystem.mkdir(path);
    if (bridge) {
      await bridge.request<void>({ operation: "mkdir", path });
    }
  };

  const ensureParent = async (path: string): Promise<void> => {
    const normalized = path.replaceAll("\\", "/");
    const parts = normalized.split("/");
    if (parts.length < 2) return;
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join("/");
      if (parent) await mkdir(parent);
    }
  };

  const createLink = async (target: string, linkPath: string): Promise<void> => {
    const causes: unknown[] = [];
    const attempts: Array<() => Promise<void>> = [];
    if (api?.createSymbolicLink) {
      attempts.push(() => api.createSymbolicLink!(target, linkPath));
    }
    if (fileSystem?.createSymbolicLink) {
      attempts.push(() => fileSystem.createSymbolicLink!(target, linkPath));
    }
    if (bridge) {
      attempts.push(() => bridge.request<void>({ operation: "symlink", target, path: linkPath }));
    }
    attempts.push(() =>
      createSymlink(target, linkPath, {
        run: options.shell,
        platform: options.symlinkPlatform,
      }),
    );

    for (const attempt of attempts) {
      try {
        await attempt();
        return;
      } catch (cause) {
        causes.push(cause);
      }
    }

    throw new AggregateError(causes, "No VS Code symlink provider succeeded");
  };

  const openFile = async (path: string): Promise<void> => {
    if (api?.openFile) {
      await api.openFile(path);
      return;
    }
    if (fileSystem?.openFile) {
      await fileSystem.openFile(path);
      return;
    }
    if (bridge) {
      await bridge.request<void>({ operation: "openFile", path });
      return;
    }
    throw new Error("VS Code open-file API is unavailable");
  };

  const recordExternalFile = async (file: File, source: string): Promise<void> => {
    const statePath = options.statePath ?? DEFAULT_EXTERNAL_STATE_PATH;
    let state: Record<string, unknown> = {};
    try {
      state = parseJsonc(await readFile(statePath));
    } catch {
      state = {};
    }
    const blob = ensureObject(state.blob);
    const key = options.recordKey?.(file, source) ?? file.name;
    blob[key] = externalUrl(source);
    state.blob = blob;
    await ensureParent(statePath);
    await writeFile(statePath, encodeJsonc(state));
  };

  const sourceFor = (input: VscodeUploadInput, file: File | undefined): string | undefined =>
    typeof input === "string" ? input : file ? filePath(file) : undefined;

  const destinationFor = async (
    file: File,
    source: string | undefined,
    explicit?: string,
  ): Promise<string> => {
    if (explicit) return explicit;
    if (options.destination) {
      return await (typeof options.destination === "function"
        ? options.destination(file, source)
        : options.destination);
    }
    return `.gpen/blob/${file.name}`;
  };

  const uploadDetailed = async (
    input: VscodeUploadInput,
    explicitDestination?: string,
  ): Promise<VscodeUploadResult | undefined> => {
    let file = selectedFile(input);
    const source = sourceFor(input, file);
    if (!file && typeof input === "string") {
      try {
        const bytes = await readFile(input);
        if (bytes) file = toFile(bytes, fileNameFromPath(input), "application/octet-stream");
      } catch (cause) {
        // A local shell symlink only needs the path. Reading is best effort so
        // desktop hosts without a file-read adapter can still attach it.
        if (mode !== "local") {
          throw new Error(`Unable to read VS Code upload source: ${input}`, { cause });
        }
      }
      if (!file) {
        if (mode !== "local") {
          throw new Error(`VS Code upload source does not exist: ${input}`);
        }
        file = emptyFile(fileNameFromPath(input));
      }
    }
    if (!file) return undefined;
    if (typeof input === "string") file = attachSourcePath(file, source);

    const destination = await destinationFor(file, source, explicitDestination);
    if (api?.upload) {
      const result = await api.upload(file, destination);
      if (isFile(result)) {
        return { file: result, source, destination };
      }
      if (result && typeof result === "object") {
        const details = result as VscodeUploadResult;
        return {
          ...details,
          file: isFile(details.file) ? details.file : file,
          source: details.source ?? source,
          destination: details.destination ?? destination,
        };
      }
      return { file, source, destination };
    }

    if (mode === "local" && source) {
      try {
        await ensureParent(destination);
        await createLink(source, destination);
        return { file, source, destination, linked: true };
      } catch (cause) {
        try {
          await recordExternalFile(file, source);
          return { file, source, destination, recorded: true };
        } catch (recordError) {
          throw new AggregateError(
            [cause, recordError],
            "Unable to create or record external file",
          );
        }
      }
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    await ensureParent(destination);
    await writeFile(destination, bytes);
    return { file, source, destination };
  };

  const upload = async (
    input: VscodeUploadInput,
    explicitDestination?: string,
  ): Promise<File | undefined> => (await uploadDetailed(input, explicitDestination))?.file;

  const download = async (value: Blob | string, name: string): Promise<void> => {
    if (mode === "local") {
      try {
        if (typeof value === "string") {
          await openFile(value);
          return;
        }
        const destination =
          typeof options.downloadPath === "function"
            ? await options.downloadPath(name)
            : (options.downloadPath ?? `.gpen/downloads/${name}`);
        await ensureParent(destination);
        await writeFile(destination, new Uint8Array(await value.arrayBuffer()));
        await openFile(destination);
        return;
      } catch (cause) {
        // A host may only expose a generic download implementation. Keep it
        // as a last-resort fallback, while preferring VS Code open-file locally.
        if (!api?.download) throw cause;
        await api.download(value, name);
        return;
      }
    }
    if (api?.download) {
      await api.download(value, name);
      return;
    }
    if (bridge) {
      if (typeof value === "string") {
        await bridge.request<void>({ operation: "download", path: value, name });
      } else {
        await bridge.request<void>({
          operation: "download",
          name,
          mime: value.type,
          data: asArrayBuffer(new Uint8Array(await value.arrayBuffer())),
        });
      }
      return;
    }
    if (typeof value === "string") {
      await openFile(value);
      return;
    }
    const destination =
      typeof options.downloadPath === "function"
        ? await options.downloadPath(name)
        : (options.downloadPath ?? `.gpen/downloads/${name}`);
    await ensureParent(destination);
    await writeFile(destination, new Uint8Array(await value.arrayBuffer()));
    await openFile(destination);
  };

  const selector: VscodeUploadDownloadSelector = {
    upload,
    uploadDetailed,
    download,
    ...(ownsBridge ? { close: () => bridge?.dispose?.() } : {}),
  };
  return selector;
}

export interface VscodeUploadDownloadSelector {
  upload(input: VscodeUploadInput, destination?: string): Promise<File | undefined>;
  /** Same operation with the link/record/write outcome exposed to callers. */
  uploadDetailed(
    input: VscodeUploadInput,
    destination?: string,
  ): Promise<VscodeUploadResult | undefined>;
  download(value: Blob | string, name: string): Promise<void>;
  close?(): void;
}
