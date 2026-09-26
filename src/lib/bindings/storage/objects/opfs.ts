import { DEFAULT_BLOB_TARGET_DOMAIN, splitBlobId, type BlobStorageOptions } from "./blob.js";
import { asError } from "../../../error.js";
import { CrossOriginBus } from "../../../crossTabBus/index.js";
import { createTabBusBlobBackend, createTabBusBlobBroker } from "./tabBusBlob.js";
import type { BlobBackend } from "../types.js";
import type { ITabBus } from "../../../crossTabBus/index.js";

/** OPFS Blob 后端选项（根目录句柄 / 子目录）。 */
export interface OpfsBlobOptions {
  root?: FileSystemDirectoryHandle;
  directory?: string;
}

/** 通过 tab bus 访问远程 OPFS broker 的选项。 */
export interface OpfsTabBusBlobOptions extends BlobStorageOptions {
  /** Path of the broker page on targetDomain. */
  brokerPath?: string;
  channelName?: string;
  timeoutMs?: number;
  loadTimeoutMs?: number;
  document?: Document;
}

async function getDirectory(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of parts) current = await current.getDirectoryHandle(part, { create });
  return current;
}

async function defaultRoot(): Promise<FileSystemDirectoryHandle> {
  const storage = globalThis.navigator?.storage;
  if (!storage?.getDirectory) throw new Error("Origin Private File System is unavailable");
  return storage.getDirectory();
}

function splitDirectory(value: string): string[] {
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("OPFS directory must be a relative path without traversal segments");
  }
  return parts;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "NotFoundError"
  );
}

/** 建一个直接读写 OPFS 的 Blob 后端。 */
export function createOpfsBlobBackend(options: OpfsBlobOptions = {}): BlobBackend {
  const directoryParts = splitDirectory(options.directory ?? "gpen/blob");
  let rootPromise: Promise<FileSystemDirectoryHandle> | undefined;
  const getRoot = () =>
    (rootPromise ??= options.root ? Promise.resolve(options.root) : defaultRoot());

  return {
    name: `opfs:/${directoryParts.join("/")}`,
    async set(id, value) {
      const parts = splitBlobId(id);
      const root = await getRoot();
      const directory = await getDirectory(root, [...directoryParts, ...parts.slice(0, -1)], true);
      const file = await directory.getFileHandle(parts.at(-1)!, { create: true });
      const writable = await file.createWritable();
      try {
        await writable.write(value);
        await writable.close();
      } catch (error) {
        await writable.abort().catch((e) => {
          console.debug("[gpen] ignored rejection: opfs writable.abort", e);
          return;
        });
        throw error;
      }
    },
    async get(id) {
      const parts = splitBlobId(id);
      const root = await getRoot();
      try {
        const directory = await getDirectory(
          root,
          [...directoryParts, ...parts.slice(0, -1)],
          false,
        );
        const file = await directory.getFileHandle(parts.at(-1)!, { create: false });
        return file.getFile();
      } catch (error) {
        if (isNotFoundError(error)) return undefined;
        throw error;
      }
    },
    async delete(id) {
      const parts = splitBlobId(id);
      const root = await getRoot();
      try {
        const directory = await getDirectory(
          root,
          [...directoryParts, ...parts.slice(0, -1)],
          false,
        );
        await directory.removeEntry(parts.at(-1)!);
      } catch (error) {
        if (isNotFoundError(error)) {
          console.debug("[gpen] ignored rejection: opfs delete entry not found", error);
          return;
        }
        throw error;
      }
    },
  };
}

/** 在 OPFS 宿主页里跑 broker，替跨域页面读写 Blob。 */
export async function createOpfsBlobBroker(
  bus: ITabBus,
  options: OpfsBlobOptions = {},
): Promise<{ destroy(): void }> {
  const root = options.root ?? (await defaultRoot());
  return createTabBusBlobBroker(bus, createOpfsBlobBackend({ ...options, root }));
}

const DEFAULT_BROKER_PATH = "/storage-broker";
const DEFAULT_LOAD_TIMEOUT_MS = 10_000;

function targetOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new TypeError(
      `Blob targetDomain must be an absolute http(s) URL: ${asError(cause, String(cause)).message}`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Blob targetDomain must use http or https");
  }
  return url.origin;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result <= 0) {
    throw new RangeError("Blob iframe timeout must be a positive finite number");
  }
  return result;
}

function waitForIframe(
  iframe: HTMLIFrameElement,
  container: HTMLElement,
  timeout: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Blob broker iframe timed out")), timeout);

    const cleanup = () => {
      clearTimeout(timer);
      iframe.removeEventListener("load", onload);
      iframe.removeEventListener("error", onerror);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onload = () => finish();
    const onerror = () => finish(new Error("Blob broker iframe failed to load"));

    iframe.addEventListener("load", onload, { once: true });
    iframe.addEventListener("error", onerror, { once: true });
    try {
      container.append(iframe);
    } catch (cause) {
      finish(asError(cause, String(cause)));
      // oxlint-disable-next-line catch/no-bare-return -- finish() 已 reject，错误已传播
      return;
    }
  });
}

type OpfsTabBusConnection = {
  iframe: HTMLIFrameElement;
  bus: CrossOriginBus;
  backend: BlobBackend & { close(): void };
};

/** 校验宿主 document 可用，并拒绝 opaque origin（`"null"`）。 */
function requireOwnerDocument(candidate: Document | undefined): Document {
  const ownerWindow = candidate?.defaultView;
  if (!candidate || !ownerWindow) {
    throw new Error("OPFS Blob broker requires a browser document");
  }
  if (!ownerWindow.location.origin || ownerWindow.location.origin === "null") {
    throw new Error("OPFS Blob broker requires a non-opaque page origin");
  }
  return candidate;
}

/** 建出指向 broker 页的隐藏 iframe（含 parentOrigin / channel / timeout 参数）。 */
function buildBrokerIframe(
  ownerDocument: Document,
  options: OpfsTabBusBlobOptions,
  preferredOrigin: string,
  channelName: string,
  loadTimeoutMs: number,
): HTMLIFrameElement {
  const iframe = ownerDocument.createElement("iframe");
  iframe.hidden = true;
  iframe.setAttribute("aria-hidden", "true");
  const brokerUrl = new URL(options.brokerPath ?? DEFAULT_BROKER_PATH, preferredOrigin);
  brokerUrl.searchParams.set("parentOrigin", ownerDocument.defaultView!.location.origin);
  brokerUrl.searchParams.set("channel", channelName);
  brokerUrl.searchParams.set("timeout", String(loadTimeoutMs));
  iframe.src = brokerUrl.toString();
  return iframe;
}

/** 装载 broker iframe、建好跨域 bus，并返回可用的远程 Blob 后端。 */
async function openOpfsBrokerConnection(
  options: OpfsTabBusBlobOptions,
  preferredOrigin: string,
  channelName: string,
  loadTimeoutMs: number,
  isClosed: () => boolean,
): Promise<OpfsTabBusConnection> {
  if (isClosed()) throw new Error("OPFS Blob backend is closed");

  const ownerDocument = requireOwnerDocument(options.document ?? globalThis.document);
  const iframe = buildBrokerIframe(
    ownerDocument,
    options,
    preferredOrigin,
    channelName,
    loadTimeoutMs,
  );

  const container = ownerDocument.body ?? ownerDocument.documentElement;
  if (!container) throw new Error("OPFS Blob broker requires a document container");

  let bus: CrossOriginBus | undefined;
  try {
    await waitForIframe(iframe, container, loadTimeoutMs);
    if (isClosed() || !iframe.contentWindow) throw new Error("OPFS Blob broker was closed");

    bus = new CrossOriginBus({
      remoteWindow: iframe.contentWindow,
      targetOrigin: preferredOrigin,
      channel: channelName,
      timeout: loadTimeoutMs,
    });
    await bus.ready;
    if (isClosed()) {
      bus.destroy();
      throw new Error("OPFS Blob broker was closed");
    }

    const backend = createTabBusBlobBackend(bus, {
      name: `opfs+tabbus:${preferredOrigin}`,
      timeoutMs: loadTimeoutMs,
    });
    return { iframe, bus, backend };
  } catch (cause) {
    bus?.destroy();
    iframe.remove();
    throw cause;
  }
}

/** 建一个通过 tab bus 访问远程 OPFS broker 的 Blob 后端。 */
export function createOpfsTabBusBlobBackend(
  options: OpfsTabBusBlobOptions = {},
): BlobBackend & { ready(): Promise<void>; close(): Promise<void> } {
  const preferredOrigin = targetOrigin(options.targetDomain ?? DEFAULT_BLOB_TARGET_DOMAIN);
  const channelName = options.channelName ?? `gpen:storage:blob:${preferredOrigin}`;
  const loadTimeoutMs = positiveTimeout(options.loadTimeoutMs, DEFAULT_LOAD_TIMEOUT_MS);
  let connectionPromise: Promise<OpfsTabBusConnection> | undefined;
  let connection: OpfsTabBusConnection | undefined;
  let closed = false;

  const getConnection = (): Promise<OpfsTabBusConnection> => {
    connectionPromise ??= openOpfsBrokerConnection(
      options,
      preferredOrigin,
      channelName,
      loadTimeoutMs,
      () => closed,
    ).then((result) => {
      connection = result;
      return result;
    });
    return connectionPromise;
  };
  const getBackend = async () => (await getConnection()).backend;

  return {
    name: `opfs+tabbus:${preferredOrigin}`,
    async ready() {
      await getConnection();
    },
    async set(id, value) {
      await (await getBackend()).set(id, value);
    },
    async get(id) {
      return (await getBackend()).get(id);
    },
    async delete(id) {
      await (await getBackend()).delete(id);
    },
    async close() {
      if (closed) return;
      closed = true;
      const current = connection;
      if (!current) return;
      current.backend.close();
      current.bus.destroy();
      current.iframe.remove();
      connection = undefined;
    },
  };
}
