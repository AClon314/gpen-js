import { splitBlobId } from "../objects/blob.js";
import { encodeState, parseState } from "./vscodeJson.js";
import type { BlobBackend, JsonValue, KvBackend } from "../types.js";
import type {
  VscodeBlobFileSystem,
  VscodeMemento,
  VscodeStorageHost,
  VscodeStorageScope,
} from "./vscodeTypes.js";

/** 提供 fileSystem 时默认的 KV 状态文件路径。 */
export const DEFAULT_STATE_PATH = ".gpen/state.jsonc";

function blobPath(id: string): string {
  return [".gpen", "blob", ...splitBlobId(id)].join("/");
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

async function ensureBlobDirectories(
  fileSystem: VscodeBlobFileSystem,
  path: string,
): Promise<void> {
  const parts = path.split("/");
  for (let index = 1; index < parts.length; index += 1) {
    await fileSystem.mkdir(parts.slice(0, index).join("/"));
  }
}

/** 用 host 的 blob 或 fileSystem 建持久化 Blob 后端。 */
export function createHostBlobBackend(host: VscodeStorageHost): BlobBackend {
  if (host.blob) {
    if (
      typeof host.blob.set !== "function" ||
      typeof host.blob.get !== "function" ||
      typeof host.blob.delete !== "function"
    ) {
      throw new TypeError("VS Code host.blob must provide persistent set/get/delete methods");
    }
    return host.blob;
  }
  if (!host.fileSystem) throw new Error("VS Code host must provide a persistent Blob backend");

  const fileSystem = host.fileSystem;
  return {
    name: "vscode:workspace/.gpen/blob",
    async set(id, value) {
      const path = blobPath(id);
      await ensureBlobDirectories(fileSystem, path);
      await fileSystem.write(path, new Uint8Array(await value.arrayBuffer()));
    },
    async get(id) {
      const data = await fileSystem.read(blobPath(id));
      return data === undefined ? undefined : new Blob([toArrayBuffer(data)]);
    },
    async delete(id) {
      await fileSystem.remove(blobPath(id));
    },
  };
}

function selectMemento(host: VscodeStorageHost, scope: VscodeStorageScope): VscodeMemento {
  const memento =
    scope === "global"
      ? (host.globalState ?? host.workspaceState)
      : (host.workspaceState ?? host.globalState);
  if (!memento) throw new Error(`VS Code ${scope}State is unavailable`);
  return memento;
}

/** 用 host 的 fileSystem 或 Memento 建 KV 后端。 */
export function createHostKvBackend<T extends JsonValue>(
  host: VscodeStorageHost,
  scope: VscodeStorageScope,
  key: string,
  statePath: string,
): KvBackend<T> {
  if (host.fileSystem) {
    const fileSystem = host.fileSystem;
    return {
      name: `vscode:workspace/${statePath}`,
      async load() {
        return parseState(await fileSystem.read(statePath)) as T;
      },
      async save(value) {
        await fileSystem.mkdir(".gpen");
        await fileSystem.write(statePath, encodeState(value));
      },
    };
  }
  const memento = selectMemento(host, scope);
  return {
    name: `vscode:${scope}State`,
    async load() {
      const value = await memento.get<JsonValue>(key, {});
      return (value === undefined ? {} : value) as T;
    },
    async save(value) {
      await memento.update(key, value);
    },
  };
}
