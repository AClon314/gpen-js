import { createSymlink, type ShellCommandRunner, type SymlinkPlatform } from "../shell/symlink.js";
/** webview → 扩展的文件传输请求消息类型。 */
export const VSCODE_FILE_REQUEST = "gpen.upDownloader.request";
/** 扩展 → webview 的文件传输响应消息类型。 */
export const VSCODE_FILE_RESPONSE = "gpen.upDownloader.response";
/** 默认的本地状态文件路径（`.gpen/state.jsonc`）。 */
export const DEFAULT_EXTERNAL_STATE_PATH = ".gpen/state.jsonc";

/** 文件传输桥支持的操作。 */
export type VscodeFileOperation =
  | "upload"
  | "download"
  | "openFile"
  | "readFile"
  | "writeFile"
  | "mkdir"
  | "symlink";

/** 一条文件传输请求（请求 id + 操作 + 载荷）。 */
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

/** 一条文件传输响应（ok / 值 / 错误）。 */
export interface VscodeFileTransferResponse {
  type: typeof VSCODE_FILE_RESPONSE;
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** 文件传输请求 / 响应桥（带超时与 dispose）。 */
export interface VscodeFileTransferBridge {
  request<T>(message: Omit<VscodeFileTransferRequest, "type" | "id">): Promise<T>;
  dispose?(): void;
}

/** webview 侧 `postMessage` 的最小形状。 */
export interface VscodeFileTransferWebviewApi {
  postMessage(message: VscodeFileTransferRequest): boolean | PromiseLike<boolean>;
}

/** 扩展侧的文件系统操作（读 / 写 / mkdir / 符号链接 / 打开）。 */
export interface VscodeFileSystem {
  readFile?(path: string): Promise<Uint8Array | ArrayBuffer | undefined>;
  writeFile?(path: string, data: Uint8Array): Promise<void>;
  mkdir?(path: string): Promise<void>;
  createSymbolicLink?(target: string, linkPath: string): Promise<void>;
  openFile?(path: string): Promise<void>;
}

/** 宿主提供的文件传输 API（上传 / 下载 / 文件操作）。 */
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

/** 上传输入：文件输入元素、File 或路径字符串。 */
export type VscodeUploadInput = HTMLInputElement | File | string;

/** 一次上传的结果（目标文件、来源 / 目的地、是否建链 / 记账）。 */
export interface VscodeUploadResult {
  file?: File;
  source?: string;
  destination?: string;
  linked?: boolean;
  recorded?: boolean;
}

/** VS Code 文件传输选项（模式、宿主 / 桥、路径策略、状态文件）。 */
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

/** 基于 webview postMessage 的请求 / 响应桥。 */
/** 解析扩展响应：按 id 结算对应的 pending 请求。 */
function createBridgeMessageHandler(
  pending: Map<string, PendingRequest>,
): (event: { data?: unknown }) => void {
  return (event) => {
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
}

/** 结算一条已被上层放弃的 pending 请求（postMessage 返回 false / reject / throw）。 */
function rejectPendingRequest(
  pending: Map<string, PendingRequest>,
  id: string,
  error: unknown,
): void {
  const request = pending.get(id);
  if (!request) return;
  pending.delete(id);
  clearTimeout(request.timer);
  request.reject(error);
}

/** 发送一条请求并等待扩展响应。 */
function sendBridgeRequest<T>(
  api: VscodeFileTransferWebviewApi,
  pending: Map<string, PendingRequest>,
  timeoutMs: number,
  message: Omit<VscodeFileTransferRequest, "type" | "id">,
): Promise<T> {
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
          rejectPendingRequest(
            pending,
            id,
            new Error("VS Code rejected the file transfer message"),
          );
        },
        (cause) => rejectPendingRequest(pending, id, cause),
      );
    } catch (cause) {
      pending.delete(id);
      clearTimeout(timer);
      reject(cause);
    }
  });
}

/** 关闭桥：摘除监听并拒绝所有在途请求。 */
function disposeVscodeFileTransferBridge(
  target: MessageTarget,
  onMessage: (event: { data?: unknown }) => void,
  pending: Map<string, PendingRequest>,
): void {
  target.removeEventListener("message", onMessage);
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error("VS Code file transfer bridge was closed"));
  }
  pending.clear();
}

/** 基于 webview postMessage 的请求 / 响应桥。 */
export function createVscodeFileTransferBridge(
  api: VscodeFileTransferWebviewApi,
  timeoutMs = 30000,
): VscodeFileTransferBridge {
  const timeout = positiveTimeout(timeoutMs);
  const target = messageTarget();
  const pending = new Map<string, PendingRequest>();
  const onMessage = createBridgeMessageHandler(pending);
  target.addEventListener("message", onMessage);

  return {
    request<T>(message: Omit<VscodeFileTransferRequest, "type" | "id">): Promise<T> {
      return sendBridgeRequest<T>(api, pending, timeout, message);
    },
    dispose() {
      disposeVscodeFileTransferBridge(target, onMessage, pending);
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
    return file; // unrecahble
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

/** 跳过一段双引号字符串（含转义），返回闭合引号之后的下标。 */
function skipJsonString(value: string, start: number): number {
  let index = start + 1;
  while (index < value.length) {
    const character = value[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    index += 1;
    if (character === '"') break;
  }
  return index;
}

/** 跳过一行 `//` 注释，返回换行符下标（换行本身保留）。 */
function skipLineComment(value: string, start: number): number {
  const end = value.indexOf("\n", start);
  return end === -1 ? value.length : end;
}

/** 跳过一段块注释，返回注释结束之后的下标。 */
function skipBlockComment(value: string, start: number): number {
  const end = value.indexOf("*/", start + 2);
  return end === -1 ? value.length : end + 2;
}

/** 去掉 JSONC 的 `//` / 块注释与尾逗号；字符串内的注释标记原样保留。 */
export function stripJsonComments(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    const character = value[index];
    if (character === '"') {
      const end = skipJsonString(value, index);
      result += value.slice(index, end);
      index = end;
      continue;
    }
    if (character === "/" && value[index + 1] === "/") {
      index = skipLineComment(value, index);
      continue;
    }
    if (character === "/" && value[index + 1] === "*") {
      index = skipBlockComment(value, index);
      continue;
    }
    result += character;
    index += 1;
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
  Object.defineProperty(blob, "lastModified", {
    value: Date.now(),
    enumerable: true,
  });
  return blob as File;
}

function emptyFile(name: string): File {
  return toFile(new Uint8Array(), name, "application/octet-stream");
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** 组装 selector 时共享的宿主 / 桥 / 模式解析结果。 */
interface VscodeFileContextBase {
  options: VscodeFileTransferOptions;
  api?: VscodeFileTransferApi;
  fileSystem?: VscodeFileSystem;
  bridge?: VscodeFileTransferBridge;
  mode: "local" | "web" | "ssh";
  ownsBridge: boolean;
}

/** 在宿主能力之上补齐文件读写 / 目录 / 链接 / 记账等操作。 */
interface VscodeFileContext extends VscodeFileContextBase {
  readFile(path: string): Promise<Uint8Array | undefined>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  ensureParent(path: string): Promise<void>;
  createLink(target: string, linkPath: string): Promise<void>;
  openFile(path: string): Promise<void>;
  recordExternalFile(file: File, source: string): Promise<void>;
  sourceFor(input: VscodeUploadInput, file: File | undefined): string | undefined;
  destinationFor(file: File, source: string | undefined, explicit?: string): Promise<string>;
}

async function readVscodeFile(
  base: VscodeFileContextBase,
  path: string,
): Promise<Uint8Array | undefined> {
  const { api, fileSystem, bridge } = base;
  if (api?.readFile) {
    const value = await api.readFile(path);
    return value === undefined ? undefined : asBytes(value);
  }
  if (fileSystem?.readFile) {
    const value = await fileSystem.readFile(path);
    return value === undefined ? undefined : asBytes(value);
  }
  if (!bridge) throw new Error("VS Code file read API is unavailable");
  const value = await bridge.request<Uint8Array | ArrayBuffer | { data: ArrayBuffer }>({
    operation: "readFile",
    path,
  });
  if (value && typeof value === "object" && "data" in value) return asBytes(value.data);
  return value === undefined ? undefined : asBytes(value);
}

async function writeVscodeFile(
  base: VscodeFileContextBase,
  path: string,
  data: Uint8Array,
): Promise<void> {
  const { api, fileSystem, bridge } = base;
  if (api?.writeFile) {
    await api.writeFile(path, data);
    return;
  }
  if (fileSystem?.writeFile) {
    await fileSystem.writeFile(path, data);
    return;
  }
  if (!bridge) throw new Error("VS Code file write API is unavailable");
  await bridge.request<void>({
    operation: "writeFile",
    path,
    data: asArrayBuffer(data),
  });
}

async function mkdirVscodePath(base: VscodeFileContextBase, path: string): Promise<void> {
  const { api, fileSystem, bridge } = base;
  if (api?.mkdir) return await api.mkdir(path);
  if (fileSystem?.mkdir) return await fileSystem.mkdir(path);
  if (bridge) await bridge.request<void>({ operation: "mkdir", path });
}

async function ensureVscodeParent(base: VscodeFileContextBase, path: string): Promise<void> {
  const parts = path.replaceAll("\\", "/").split("/");
  if (parts.length < 2) return;
  for (let index = 1; index < parts.length; index += 1) {
    const parent = parts.slice(0, index).join("/");
    if (parent) await mkdirVscodePath(base, parent);
  }
}

async function createVscodeLink(
  base: VscodeFileContextBase,
  target: string,
  linkPath: string,
): Promise<void> {
  const { api, fileSystem, bridge, options } = base;
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
      // oxlint-disable-next-line catch/must-return-or-throw -- 收集各 provider 失败，循环外统一抛 AggregateError
    } catch (cause) {
      causes.push(cause);
    }
  }

  throw new AggregateError(causes, "No VS Code symlink provider succeeded");
}

async function openVscodeFile(base: VscodeFileContextBase, path: string): Promise<void> {
  const { api, fileSystem, bridge } = base;
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
}

async function recordVscodeExternalFile(
  ops: Pick<VscodeFileContext, "readFile" | "writeFile" | "ensureParent">,
  options: VscodeFileTransferOptions,
  file: File,
  source: string,
): Promise<void> {
  const statePath = options.statePath ?? DEFAULT_EXTERNAL_STATE_PATH;
  let state: Record<string, unknown> = {};
  try {
    state = parseJsonc(await ops.readFile(statePath));
    // oxlint-disable-next-line catch/must-return-or-throw -- 读取/解析失败时回落到空状态继续
  } catch {
    state = {};
  }
  const blob = ensureObject(state.blob);
  const key = options.recordKey?.(file, source) ?? file.name;
  blob[key] = externalUrl(source);
  state.blob = blob;
  await ops.ensureParent(statePath);
  await ops.writeFile(statePath, encodeJsonc(state));
}

function vscodeSourceFor(input: VscodeUploadInput, file: File | undefined): string | undefined {
  if (typeof input === "string") return input;
  return file ? filePath(file) : undefined;
}

async function vscodeDestinationFor(
  options: VscodeFileTransferOptions,
  file: File,
  source: string | undefined,
  explicit?: string,
): Promise<string> {
  if (explicit) return explicit;
  if (options.destination) {
    return await (typeof options.destination === "function"
      ? options.destination(file, source)
      : options.destination);
  }
  return `.gpen/blob/${file.name}`;
}

async function resolveVscodeDownloadPath(
  options: VscodeFileTransferOptions,
  name: string,
): Promise<string> {
  if (typeof options.downloadPath === "function") return await options.downloadPath(name);
  return options.downloadPath ?? `.gpen/downloads/${name}`;
}

function createVscodeFileContext(options: VscodeFileTransferOptions): VscodeFileContext {
  const api = options.api ?? options.host;
  const fileSystem = options.fileSystem ?? options.host;
  const bridge =
    options.bridge ??
    (options.webview
      ? createVscodeFileTransferBridge(options.webview, options.requestTimeoutMs ?? 30000)
      : undefined);
  const base: VscodeFileContextBase = {
    options,
    api,
    fileSystem,
    bridge,
    mode: options.mode ?? api?.mode ?? "local",
    ownsBridge: !options.bridge && Boolean(options.webview),
  };
  const readFile = (path: string) => readVscodeFile(base, path);
  const writeFile = (path: string, data: Uint8Array) => writeVscodeFile(base, path, data);
  const ensureParent = (path: string) => ensureVscodeParent(base, path);
  return {
    ...base,
    readFile,
    writeFile,
    mkdir: (path) => mkdirVscodePath(base, path),
    ensureParent,
    createLink: (target, linkPath) => createVscodeLink(base, target, linkPath),
    openFile: (path) => openVscodeFile(base, path),
    sourceFor: vscodeSourceFor,
    destinationFor: (file, source, explicit) =>
      vscodeDestinationFor(options, file, source, explicit),
    recordExternalFile: (file, source) =>
      recordVscodeExternalFile({ readFile, writeFile, ensureParent }, options, file, source),
  };
}

async function readUploadSourceFile(context: VscodeFileContext, input: string): Promise<File> {
  let file: File | undefined;
  try {
    const bytes = await context.readFile(input);
    if (bytes) file = toFile(bytes, fileNameFromPath(input), "application/octet-stream");
  } catch (cause) {
    if (context.mode !== "local") {
      throw new Error(`Unable to read VS Code upload source: ${input}`, { cause });
    }
  }
  if (file) return file;
  if (context.mode !== "local") {
    throw new Error(`VS Code upload source does not exist: ${input}`);
  }
  return emptyFile(fileNameFromPath(input));
}

async function resolveUploadFile(
  context: VscodeFileContext,
  input: VscodeUploadInput,
): Promise<File | undefined> {
  const selected = selectedFile(input);
  if (selected || typeof input !== "string") return selected;
  return await readUploadSourceFile(context, input);
}

async function uploadViaHostApi(
  api: VscodeFileTransferApi,
  file: File,
  source: string | undefined,
  destination: string,
): Promise<VscodeUploadResult> {
  const result = await api.upload!(file, destination);
  if (isFile(result)) return { file: result, source, destination };
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

async function recordUploadFallback(
  context: VscodeFileContext,
  file: File,
  source: string,
  destination: string,
  linkCause: unknown,
): Promise<VscodeUploadResult> {
  try {
    await context.recordExternalFile(file, source);
    return { file, source, destination, recorded: true };
  } catch (recordError) {
    throw new AggregateError([linkCause, recordError], "Unable to create or record external file");
  }
}

async function linkOrRecordUpload(
  context: VscodeFileContext,
  file: File,
  source: string,
  destination: string,
): Promise<VscodeUploadResult> {
  try {
    await context.ensureParent(destination);
    await context.createLink(source, destination);
    return { file, source, destination, linked: true };
  } catch (cause) {
    return await recordUploadFallback(context, file, source, destination, cause);
  }
}

async function transferUpload(
  context: VscodeFileContext,
  file: File,
  source: string | undefined,
  destination: string,
): Promise<VscodeUploadResult> {
  const { api } = context;
  if (api?.upload) return await uploadViaHostApi(api, file, source, destination);
  if (context.mode === "local" && source) {
    return await linkOrRecordUpload(context, file, source, destination);
  }
  await context.ensureParent(destination);
  await context.writeFile(destination, new Uint8Array(await file.arrayBuffer()));
  return { file, source, destination };
}

type DetailedUploader = (
  input: VscodeUploadInput,
  destination?: string,
) => Promise<VscodeUploadResult | undefined>;

function createDetailedUploader(context: VscodeFileContext): DetailedUploader {
  return async (input, explicitDestination) => {
    let file = await resolveUploadFile(context, input);
    if (!file) return undefined;
    const source = context.sourceFor(input, file);
    if (typeof input === "string") file = attachSourcePath(file, source);
    const destination = await context.destinationFor(file, source, explicitDestination);
    return await transferUpload(context, file, source, destination);
  };
}

async function writeDownloadToPath(
  context: VscodeFileContext,
  value: Blob | string,
  name: string,
): Promise<void> {
  if (typeof value === "string") {
    await context.openFile(value);
    return;
  }
  const destination = await resolveVscodeDownloadPath(context.options, name);
  await context.ensureParent(destination);
  await context.writeFile(destination, new Uint8Array(await value.arrayBuffer()));
  await context.openFile(destination);
}

async function downloadViaBridge(
  bridge: VscodeFileTransferBridge,
  value: Blob | string,
  name: string,
): Promise<void> {
  if (typeof value === "string") {
    await bridge.request<void>({ operation: "download", path: value, name });
    return;
  }
  await bridge.request<void>({
    operation: "download",
    name,
    mime: value.type,
    data: asArrayBuffer(new Uint8Array(await value.arrayBuffer())),
  });
}

async function downloadLocal(
  context: VscodeFileContext,
  value: Blob | string,
  name: string,
): Promise<void> {
  const { api } = context;
  try {
    await writeDownloadToPath(context, value, name);
  } catch (cause) {
    // A host may only expose a generic download implementation. Keep it
    // as a last-resort fallback, while preferring VS Code open-file locally.
    if (!api?.download) throw cause;
    await api.download(value, name);
    console.debug("[gpen] ignored rejection: vscode download fallback", cause);
  }
}

async function downloadRemote(
  context: VscodeFileContext,
  value: Blob | string,
  name: string,
): Promise<void> {
  const { api, bridge } = context;
  if (api?.download) {
    await api.download(value, name);
    return;
  }
  if (bridge) {
    await downloadViaBridge(bridge, value, name);
    return;
  }
  await writeDownloadToPath(context, value, name);
}

function createSelectorDownloader(
  context: VscodeFileContext,
): (value: Blob | string, name: string) => Promise<void> {
  return async (value, name) => {
    if (context.mode === "local") return await downloadLocal(context, value, name);
    return await downloadRemote(context, value, name);
  };
}

/** 创建 VS Code 版上传 / 下载选择器。 */
export function createVscodeUploadDownloadSelector(
  options: VscodeFileTransferOptions = {},
): VscodeUploadDownloadSelector {
  const context = createVscodeFileContext(options);
  const uploadDetailed = createDetailedUploader(context);
  return {
    upload: async (input, destination) => (await uploadDetailed(input, destination))?.file,
    uploadDetailed,
    download: createSelectorDownloader(context),
    ...(context.ownsBridge ? { close: () => context.bridge?.dispose?.() } : {}),
  };
}

/** VS Code 选择器的对外接口（含 detailed 上传）。 */
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
