import { asError } from "../../error.js";
import type { BlobBackend } from "./types.js";
import type { ITabBus, TabBusSendOptions } from "../../crossTabBus/index.js";

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

type PendingRequest = {
  resolve(value: BlobResponse): void;
  reject(error: unknown): void;
  timer: ReturnType<typeof setTimeout>;
};

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
    if (closed || message.type !== BLOB_RESPONSE || !message.payload) return;
    const response = message.payload as Partial<BlobResponse>;
    if (
      typeof response.clientId !== "string" ||
      response.clientId !== clientId ||
      typeof response.requestId !== "string" ||
      typeof response.ok !== "boolean"
    ) {
      return;
    }

    const request = pending.get(response.requestId);
    if (!request) return;
    pending.delete(response.requestId);
    clearTimeout(request.timer);
    if (response.ok) request.resolve(response as BlobResponse);
    else request.reject(new Error(response.error ?? "Blob broker request failed"));
  });

  const request = (payload: BlobRequest, transferables?: readonly Transferable[]) => {
    return new Promise<BlobResponse>((resolve, reject) => {
      if (closed) {
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
        if (!current) return;
        pending.delete(payload.requestId);
        clearTimeout(current.timer);
        reject(error);
      });
    });
  };

  const nextPayload = (operation: BlobOperation, id: string): BlobRequest => ({
    clientId,
    requestId: `${clientId}:${++nextRequestId}`,
    operation,
    id,
  });

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

export function createTabBusBlobBroker(bus: ITabBus, backend: BlobBackend): { destroy(): void } {
  let destroyed = false;

  const sendResponse = async (response: BlobResponse, transferables?: readonly Transferable[]) => {
    if (destroyed) return;
    await bus.send(BLOB_RESPONSE, response, transferables?.length ? { transferables } : undefined);
  };

  const unsubscribe = bus.onMessage((message) => {
    if (destroyed || message.type !== BLOB_REQUEST || !isBlobRequest(message.payload)) return;
    const request = message.payload;
    void (async () => {
      try {
        if (request.operation === "set") {
          if (request.data === undefined) throw new Error("Blob set request has no data");
          await backend.set(request.id, new Blob([request.data], { type: request.type }));
          await sendResponse({
            clientId: request.clientId,
            requestId: request.requestId,
            ok: true,
          });
          return;
        }
        if (request.operation === "delete") {
          await backend.delete(request.id);
          await sendResponse({
            clientId: request.clientId,
            requestId: request.requestId,
            ok: true,
          });
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
      }
    })().catch(() => undefined);
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
    },
  };
}
