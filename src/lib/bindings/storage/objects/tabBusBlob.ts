import { asError } from "../../../error.js";
import type { BlobBackend } from "../types.js";
import type { ITabBus, TabBusMessage, TabBusSendOptions } from "../../../crossTabBus/index.js";

/** tab bus Blob 后端选项（名字 / 超时 / 客户端 id）。 */
export interface TabBusBlobOptions {
  name?: string;
  timeoutMs?: number;
  clientId?: string;
}

type BlobOperation = "set" | "get" | "delete";

type BlobRequest = {
  clientId: string;
  requestId: string;
  operation: BlobOperation;
  id: string;
  data?: ArrayBuffer;
  type?: string;
};

type BlobResponse = {
  clientId: string;
  requestId: string;
  ok: boolean;
  data?: ArrayBuffer;
  type?: string;
  error?: string;
};

type PendingRequest = {
  resolve(value: BlobResponse): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

const BLOB_REQUEST = "gpen.storage.blob.request";
const BLOB_RESPONSE = "gpen.storage.blob.response";
const DEFAULT_TIMEOUT_MS = 30_000;
let nextClientId = 0;

function createClientId(): string {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") return randomUuid.call(globalThis.crypto);
  return `blob-client-${Date.now().toString(36)}-${++nextClientId}`;
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function isBlobOperation(value: unknown): value is BlobOperation {
  return value === "set" || value === "get" || value === "delete";
}

function isBlobRequest(value: unknown): value is BlobRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<BlobRequest>;
  return (
    typeof request.clientId === "string" &&
    typeof request.requestId === "string" &&
    isBlobOperation(request.operation) &&
    typeof request.id === "string" &&
    (request.data === undefined || isArrayBuffer(request.data)) &&
    (request.type === undefined || typeof request.type === "string")
  );
}

function timeoutMs(value: number | undefined): number {
  const result = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(result) || result <= 0) {
    throw new RangeError("Tab bus Blob timeoutMs must be a positive finite number");
  }
  return result;
}

/** 结算一条属于本 client 的响应；其余消息按协议忽略。 */
function settleResponse(
  clientId: string,
  message: TabBusMessage,
  pending: Map<string, PendingRequest>,
): void {
  if (message.type !== BLOB_RESPONSE || !message.payload) return;
  const response = message.payload as Partial<BlobResponse>;
  if (typeof response.clientId !== "string" || response.clientId !== clientId) return;
  if (typeof response.requestId !== "string" || typeof response.ok !== "boolean") return;

  const request = pending.get(response.requestId);
  if (!request) return;
  pending.delete(response.requestId);
  clearTimeout(request.timer);
  if (response.ok) request.resolve(response as BlobResponse);
  else request.reject(new Error(response.error ?? "Blob broker request failed"));
}

/** 发送一条请求并等待 broker 响应；超时 / 关闭 / 发送失败都 reject。 */
function sendBlobRequest(
  bus: ITabBus,
  payload: BlobRequest,
  transferables: readonly Transferable[] | undefined,
  pending: Map<string, PendingRequest>,
  requestTimeoutMs: number,
  isClosed: () => boolean,
): Promise<BlobResponse> {
  return new Promise<BlobResponse>((resolve, reject) => {
    if (isClosed()) {
      reject(new Error("Blob broker client is closed"));
      return;
    }

    const timer = setTimeout(() => {
      pending.delete(payload.requestId);
      reject(new Error(`Blob broker request timed out: ${payload.operation}`));
    }, requestTimeoutMs);
    pending.set(payload.requestId, { resolve, reject, timer });

    const sendOptions: TabBusSendOptions | undefined = transferables?.length
      ? { transferables }
      : undefined;
    void bus.send(BLOB_REQUEST, payload, sendOptions).catch((error) => {
      const current = pending.get(payload.requestId);
      if (!current) {
        console.debug("[gpen] ignored rejection: tabBusBlob pending entry missing", error);
        return;
      }
      pending.delete(payload.requestId);
      clearTimeout(current.timer);
      reject(error);
    });
  });
}

/** 在 broker 侧执行一条请求，并把结果（或错误）写回响应。 */
async function answerBlobRequest(
  request: BlobRequest,
  backend: BlobBackend,
  sendResponse: (response: BlobResponse, transferables?: readonly Transferable[]) => Promise<void>,
): Promise<void> {
  try {
    if (request.operation === "set") {
      if (request.data === undefined) throw new Error("Blob set request has no data");
      await backend.set(request.id, new Blob([request.data], { type: request.type }));
      await sendResponse({ clientId: request.clientId, requestId: request.requestId, ok: true });
      return;
    }
    if (request.operation === "delete") {
      await backend.delete(request.id);
      await sendResponse({ clientId: request.clientId, requestId: request.requestId, ok: true });
      return;
    }

    const blob = await backend.get(request.id);
    const data = blob?.arrayBuffer();
    const response: BlobResponse = {
      clientId: request.clientId,
      requestId: request.requestId,
      ok: true,
      data: data ? await data : undefined,
      type: blob?.type,
    };
    await sendResponse(response, response.data ? [response.data] : undefined);
  } catch (error) {
    await sendResponse({
      clientId: request.clientId,
      requestId: request.requestId,
      ok: false,
      error: asError(error, String(error)).message,
    });
    // oxlint-disable-next-line catch/no-bare-return -- 已通过 sendResponse 回传错误
    return;
  }
}

/** 通过 tab bus 远程读写 Blob 的后端。 */
export function createTabBusBlobBackend(
  bus: ITabBus,
  options: TabBusBlobOptions = {},
): BlobBackend & { close(): void } {
  const clientId = options.clientId ?? createClientId();
  const requestTimeoutMs = timeoutMs(options.timeoutMs);
  const pending = new Map<string, PendingRequest>();
  let nextRequestId = 0;
  let closed = false;

  const unsubscribe = bus.onMessage((message) => {
    if (closed) return;
    settleResponse(clientId, message, pending);
  });

  const nextPayload = (operation: BlobOperation, id: string): BlobRequest => ({
    clientId,
    requestId: `${clientId}:${++nextRequestId}`,
    operation,
    id,
  });
  const request = (payload: BlobRequest, transferables?: readonly Transferable[]) =>
    sendBlobRequest(bus, payload, transferables, pending, requestTimeoutMs, () => closed);

  return {
    name: options.name ?? "tabbus:blob",
    async set(id, value) {
      const payload = nextPayload("set", id);
      const data = await value.arrayBuffer();
      await request({ ...payload, data, type: value.type }, [data]);
    },
    async get(id) {
      const response = await request(nextPayload("get", id));
      return response.data === undefined
        ? undefined
        : new Blob([response.data], { type: response.type });
    },
    async delete(id) {
      await request(nextPayload("delete", id));
    },
    close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("Blob broker client is closed"));
      }
      pending.clear();
    },
  };
}

/** 在持有真实 Blob 的页面里跑 broker，响应其他 tab 的读 / 写 / 删。 */
export function createTabBusBlobBroker(bus: ITabBus, backend: BlobBackend): { destroy(): void } {
  let destroyed = false;

  const sendResponse = async (response: BlobResponse, transferables?: readonly Transferable[]) => {
    if (destroyed) return;
    await bus.send(BLOB_RESPONSE, response, transferables?.length ? { transferables } : undefined);
  };

  const unsubscribe = bus.onMessage((message) => {
    if (destroyed || message.type !== BLOB_REQUEST || !isBlobRequest(message.payload)) return;
    void answerBlobRequest(message.payload, backend, sendResponse).catch((e) => {
      console.debug("[gpen] ignored rejection: tabBusBlob handleRequest", e);
      return;
    });
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
    },
  };
}
