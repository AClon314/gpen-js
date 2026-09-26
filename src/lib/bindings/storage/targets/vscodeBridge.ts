import type { BlobBackend, JsonValue, KvBackend } from "../types.js";
import {
  VSCODE_STORAGE_REQUEST,
  VSCODE_STORAGE_RESPONSE,
  type VscodeBlobPayload,
  type VscodeStorageBridge,
  type VscodeStorageOptions,
  type VscodeStorageRequest,
  type VscodeStorageResponse,
  type VscodeStorageScope,
  type VscodeWebviewApi,
} from "./vscodeTypes.js";

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

function getMessageTarget(): MessageTarget {
  const target = globalThis as unknown as Partial<MessageTarget>;
  if (
    typeof target.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  ) {
    throw new Error("VS Code webview message events are unavailable in this runtime");
  }
  return target as MessageTarget;
}

/** 结算一条挂起请求；条目不存在时只诊断，不抛错。 */
function rejectPendingRequest(
  pending: Map<string, PendingRequest>,
  id: string,
  reason: unknown,
  logContext?: string,
): void {
  const current = pending.get(id);
  if (!current) {
    if (logContext !== undefined) console.debug(logContext, reason);
    return;
  }
  pending.delete(id);
  clearTimeout(current.timer);
  current.reject(reason);
}

function requestViaBridge<T>(
  api: VscodeWebviewApi,
  pending: Map<string, PendingRequest>,
  message: Omit<VscodeStorageRequest, "type" | "id">,
  timeoutMs: number,
): Promise<T> {
  const id = `gpen-${++nextRequestId}`;
  const requestMessage = {
    type: VSCODE_STORAGE_REQUEST,
    id,
    ...message,
  } as VscodeStorageRequest;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`VS Code storage request timed out: ${message.operation}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });

    try {
      Promise.resolve(api.postMessage(requestMessage)).then(
        (sent) => {
          if (!sent) {
            rejectPendingRequest(pending, id, new Error("VS Code rejected the storage message"));
          }
        },
        (cause) => {
          rejectPendingRequest(pending, id, cause);
        },
      );
    } catch (cause) {
      const current = pending.get(id);
      if (!current) {
        console.debug("[gpen] ignored rejection: storage vscode pending entry missing", cause);
        return;
      }
      pending.delete(id);
      clearTimeout(current.timer);
      current.reject(cause);
    }
  });
}

/** 建 webview ↔ 扩展的消息桥（带超时与 dispose）。 */
export function createWebviewBridge(api: VscodeWebviewApi, timeoutMs: number): VscodeStorageBridge {
  const target = getMessageTarget();
  const pending = new Map<string, PendingRequest>();

  const onMessage = (event: { data?: unknown }) => {
    const data = event.data;
    if (!data || typeof data !== "object") return;

    const response = data as Partial<VscodeStorageResponse>;
    if (response.type !== VSCODE_STORAGE_RESPONSE || typeof response.id !== "string") return;

    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);

    if (response.ok) {
      request.resolve(response.value);
    } else {
      request.reject(new Error(response.error ?? "VS Code storage request failed"));
    }
  };

  target.addEventListener("message", onMessage);

  return {
    request<T>(message: Omit<VscodeStorageRequest, "type" | "id">): Promise<T> {
      return requestViaBridge<T>(api, pending, message, timeoutMs);
    },
    dispose() {
      target.removeEventListener("message", onMessage);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("VS Code storage bridge was closed"));
      }
      pending.clear();
    },
  };
}

/** 取注入的 / 全局的 `acquireVsCodeApi`。 */
export function getVscodeStorageApi(api?: VscodeWebviewApi): VscodeWebviewApi | undefined {
  const globalObject = globalThis as typeof globalThis & {
    acquireVsCodeApi?: () => VscodeWebviewApi;
  };
  return api ?? globalObject.acquireVsCodeApi?.();
}

/** 当前运行时是否具备 VS Code 存储（宿主 / 桥 / webview API）。 */
export function hasVscodeStorage<T extends JsonValue = JsonValue>(
  options: VscodeStorageOptions<T> = {},
): boolean {
  const globalObject = globalThis as typeof globalThis & {
    acquireVsCodeApi?: () => VscodeWebviewApi;
  };
  return Boolean(
    options.host ||
    options.bridge ||
    options.webview ||
    typeof globalObject.acquireVsCodeApi === "function",
  );
}

/** 用 bridge 建 KV 后端。 */
export function createBridgeKvBackend<T extends JsonValue>(
  bridge: VscodeStorageBridge,
  scope: VscodeStorageScope,
  key: string,
): KvBackend<T> {
  return {
    name: `vscode:${scope}State`,
    async load() {
      const value = await bridge.request<JsonValue>({ operation: "kv.load", scope, key });
      return (value === undefined ? {} : value) as T;
    },
    async save(value) {
      await bridge.request<void>({ operation: "kv.save", scope, key, value });
    },
  };
}

/** 用 bridge 建 Blob 后端。 */
export function createBridgeBlobBackend(
  bridge: VscodeStorageBridge,
  scope: VscodeStorageScope,
): BlobBackend {
  return {
    name: "vscode:workspace/.gpen/blob",
    async set(id, value) {
      const data = await value.arrayBuffer();
      await bridge.request<void>({
        operation: "blob.set",
        scope,
        key: id,
        blob: { data, type: value.type },
      });
    },
    async get(id) {
      const payload = await bridge.request<VscodeBlobPayload | undefined>({
        operation: "blob.get",
        scope,
        key: id,
      });
      return payload === undefined ? undefined : new Blob([payload.data], { type: payload.type });
    },
    async delete(id) {
      await bridge.request<void>({ operation: "blob.delete", scope, key: id });
    },
  };
}
