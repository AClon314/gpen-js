/**
 * FBS-005: FlatBuffers Gpen documents on top of the existing Blob/KV storage.
 *
 * Binary Gpen payloads (unframed v1 FlatBuffers, see the
 * `gpen-protocol` repo's `flatbuffers.md`) are stored in the Blob backend under
 * `gpen/<document-id>.bin`. The KV only holds versioned JSON metadata
 * (`kv.gpen.<id>`); Uint8Array/ArrayBuffer values are never written to KV.
 *
 * The two backends do not form a transaction: `save` writes the blob first
 * and then the metadata. If the metadata update fails, the next `load`
 * reports the inconsistency through the `size_mismatch`
 * diagnostic (blob size vs. stored metadata size) instead of silently
 * serving a half-written document.
 */
import type { GpenT } from "../../protocol/codec";
import { decodeGpen, encodeGpen, GpenCodecError } from "../../protocol/codec";
import { splitBlobId } from "./blob.js";
import type { KvStorage } from "./types.js";
import type { ITabBus, TabBusSendOptions } from "../../crossTabBus/index.js";
import type { BlobBackend } from "./types.js";

/** Protocol schema version written into every metadata entry. */
export const GPEN_SCHEMA_VERSION = "v1" as const;
/** Codec version written into every metadata entry; bump on wire-format change. */
export const GPEN_CODEC_VERSION = 1;
/** KV namespace key holding the per-document metadata map. */
export const GPEN_KV_NAMESPACE = "gpen";
/** Blob path prefix; full blob id is `${GPEN_BLOB_PREFIX}/${id}.bin`. */
export const GPEN_BLOB_PREFIX = "gpen";
/** 二进制文档 Blob 的 MIME 类型。 */
export const GPEN_BLOB_TYPE = "application/octet-stream";

/**
 * Versioned JSON metadata stored in KV for one Gpen document. Pure JSON:
 * no binary, no Blob, no file handles — only scalars and the blob reference.
 *
 * Declared as a type alias (not an interface) so it satisfies `JsonValue`'s
 * implicit index signature and can be stored in `KvStorage`.
 */
export type GpenMetadata = {
  document_id: string;
  /** Schema version of the document; validated against `GPEN_SCHEMA_VERSION` on load. */
  schema_version: string;
  /** Codec version; validated against `GPEN_CODEC_VERSION` on load. */
  codec_version: number;
  /** Blob size in bytes; load verifies `blob.size === size`. */
  size: number;
  /** ISO-8601 timestamp of the last successful save. */
  updated_at: string;
  /** Blob backend id of the binary payload (e.g. `gpen/<document-id>.bin`). */
  blob: string;
};

/** KV root shape expected by the Gpen binary store (`kv.gpen.<documentId>`). */
export type GpenKvRoot = {
  gpen: Record<string, GpenMetadata>;
};

/** Gpen 文档存储失败的诊断码。 */
export type GpenStorageErrorCode =
  /** The document could not be encoded (codec-level failure). */
  | "encode_failed"
  /** The stored bytes could not be decoded (codec-level failure). */
  | "decode_failed"
  /** No metadata entry exists for the requested document id. */
  | "metadata_missing"
  /** The metadata entry exists but is not a well-formed GpenMetadata object. */
  | "invalid_metadata"
  /** The metadata references an unsupported schema_version/codec_version. */
  | "version_mismatch"
  /** The blob referenced by the metadata is missing from the Blob backend. */
  | "blob_missing"
  /** Blob size differs from the metadata size (blob written, metadata update failed). */
  | "size_mismatch"
  /** A save/delete operation failed to write to the Blob backend or KV. */
  | "write_failed"
  /** A delete operation failed. */
  | "delete_failed"
  /** The document id itself is not usable. */
  | "invalid_document_id";

/** Diagnostic error carrying the storage context for a failed Gpen document operation. */
export class GpenStorageError extends Error {
  readonly code: GpenStorageErrorCode;
  readonly documentId: string;
  readonly cause: unknown;

  constructor(code: GpenStorageErrorCode, documentId: string, message: string, cause?: unknown) {
    super(message);
    this.name = "GpenStorageError";
    this.code = code;
    this.documentId = documentId;
    this.cause = cause;
  }
}

/** Gpen 二进制文档存储的依赖（KV / Blob / 可选 bus 与缓存）。 */
export interface GpenBinaryStoreDeps {
  readonly kv: KvStorage<GpenKvRoot>;
  readonly blob: BlobBackend;
  /** Optional bus used by sendCrossTab; pending binary saves are committed first. */
  readonly crossTabBus?: ITabBus;
  /** Cache FlatBuffer writes in memory and flush them on a trailing timer. */
  readonly cache?: boolean;
  /** Trailing-edge write delay in milliseconds. Defaults to 150. */
  readonly debounceMs?: number;
}

/** Gpen 文档的二进制存储接口（保存 / 读取 / 元数据 / 删除 / 提交）。 */
export interface GpenBinaryStore {
  /**
   * Encode and persist a Gpen document. Writes the binary payload
   * to the Blob backend first, then the versioned metadata to KV.
   * @returns the metadata that was persisted.
   */
  save(id: string, document: GpenT): Promise<GpenMetadata>;
  /**
   * Read metadata, verify versions and blob size, then structurally decode
   * the binary payload. Never returns a half-valid document: every failure
   * path throws a `GpenStorageError` with a distinct `code`.
   */
  load(id: string): Promise<GpenT>;
  /** Read the metadata entry without touching the blob. */
  getMetadata(id: string): Promise<GpenMetadata | undefined>;
  /** Remove the blob and the metadata entry (idempotent). */
  del(id: string): Promise<void>;
  /** Flush all pending cached binary writes immediately. */
  commit(): Promise<void>;
  /** Stop timers and discard uncommitted in-memory state. */
  dispose(): void;
  /** Commit before sending a cross-tab message. */
  sendCrossTab(type: string, payload: unknown, options?: TabBusSendOptions): Promise<void>;
}

function blobIdFor(id: string): string {
  return `${GPEN_BLOB_PREFIX}/${id}.bin`;
}

function storageError(
  code: GpenStorageErrorCode,
  documentId: string,
  message: string,
  cause?: unknown,
): GpenStorageError {
  return new GpenStorageError(code, documentId, message, cause);
}

function assertDocumentId(id: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw storageError("invalid_document_id", id, "document id must be a non-empty string");
  }
  if (id.includes("/") || id.includes("\\") || id === "." || id === "..") {
    throw storageError(
      "invalid_document_id",
      id,
      "document id must not contain path separators or be a relative path",
    );
  }
}

/** Validate a Blob reference as a safe relative Blob id (no traversal). */
function assertSafeBlobReference(blob: unknown, id: string): string {
  if (typeof blob !== "string" || blob.length === 0) {
    throw storageError("invalid_metadata", id, "blob reference must be a non-empty string");
  }
  try {
    // A tampered entry must not read outside the store, nor escape `load` as a
    // raw path error instead of a diagnostic.
    splitBlobId(blob);
  } catch (cause) {
    throw storageError(
      "invalid_metadata",
      id,
      `blob reference ${JSON.stringify(blob)} is not a safe relative Blob id`,
      cause,
    );
  }
  return blob;
}

/** Validate a raw KV value as a well-formed metadata entry for `id`. */
function parseMetadata(value: unknown, id: string): GpenMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw storageError("invalid_metadata", id, "metadata entry is not a JSON object");
  }
  const record = value as Record<string, unknown>;
  const documentId = record.document_id;
  const schemaVersion = record.schema_version;
  const codecVersion = record.codec_version;
  const size = record.size;
  const updatedAt = record.updated_at;
  const blob = record.blob;
  if (documentId !== id) {
    throw storageError(
      "invalid_metadata",
      id,
      `metadata document_id ${JSON.stringify(documentId)} does not match the requested id`,
    );
  }
  if (schemaVersion !== GPEN_SCHEMA_VERSION) {
    throw storageError(
      "version_mismatch",
      id,
      `unsupported schema_version ${JSON.stringify(schemaVersion)} (expected "${GPEN_SCHEMA_VERSION}")`,
    );
  }
  if (codecVersion !== GPEN_CODEC_VERSION) {
    throw storageError(
      "version_mismatch",
      id,
      `unsupported codec_version ${String(codecVersion)} (expected ${GPEN_CODEC_VERSION})`,
    );
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    throw storageError("invalid_metadata", id, "size must be a non-negative integer");
  }
  if (typeof updatedAt !== "string") {
    throw storageError("invalid_metadata", id, "updated_at must be a string");
  }
  return {
    document_id: id,
    schema_version: schemaVersion,
    codec_version: codecVersion,
    size,
    updated_at: updatedAt,
    blob: assertSafeBlobReference(blob, id),
  };
}

/** Cached write state for one document id. */
type PendingDocument = {
  document: GpenT;
  revision: number;
  dirty: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

/**
 * Serialized runtime behind `createGpenBinaryStore`. Kept as a class so the
 * debounce/persist state machine is split into individually small methods
 * instead of one long closure.
 */
class GpenBinaryRuntime {
  _deps: GpenBinaryStoreDeps;
  _cache: boolean;
  _debounceMs: number;
  _pending = new Map<string, PendingDocument>();
  _latestMetadata = new Map<string, GpenMetadata>();
  _disposed = false;
  _operationTail: Promise<void> = Promise.resolve();

  constructor(deps: GpenBinaryStoreDeps, cache: boolean, debounceMs: number) {
    this._deps = deps;
    this._cache = cache;
    this._debounceMs = debounceMs;
  }

  _assertOpen(): void {
    if (this._disposed) throw new Error("Gpen binary store is disposed");
  }

  _enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const next = this._operationTail.then(operation);
    this._operationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async _persistDocument(id: string, document: GpenT): Promise<GpenMetadata> {
    let bytes: Uint8Array;
    try {
      bytes = encodeGpen(document);
    } catch (error) {
      if (error instanceof GpenCodecError)
        throw storageError("encode_failed", id, "document failed to encode", error);
      throw error;
    }

    const blobId = blobIdFor(id);
    const metadata: GpenMetadata = {
      document_id: id,
      schema_version: GPEN_SCHEMA_VERSION,
      codec_version: GPEN_CODEC_VERSION,
      size: bytes.byteLength,
      updated_at: new Date().toISOString(),
      blob: blobId,
    };
    try {
      // Keep the binary out of KV and copy the generated view before Blob use.
      await this._deps.blob.set(
        blobId,
        new Blob([new Uint8Array(bytes)], { type: GPEN_BLOB_TYPE }),
      );
    } catch (error) {
      throw storageError("write_failed", id, `failed to write blob ${blobId}`, error);
    }
    try {
      await this._deps.kv.set.gpen[id](metadata);
      await this._deps.kv.submit();
    } catch (error) {
      throw storageError(
        "write_failed",
        id,
        `blob ${blobId} was written but the metadata update failed; the next load will report a size mismatch`,
        error,
      );
    }
    this._latestMetadata.set(id, metadata);
    return metadata;
  }

  _flushId(id: string): Promise<void> {
    const state = this._pending.get(id);
    if (!state || !state.dirty) return Promise.resolve();
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const revision = state.revision;
    const document = state.document;
    return this._enqueue(async () => {
      const metadata = await this._persistDocument(id, document);
      const current = this._pending.get(id);
      if (current && current.revision === revision) {
        current.dirty = false;
        this._latestMetadata.set(id, metadata);
      }
    });
  }

  async _flushAll(): Promise<void> {
    await Promise.all([...this._pending.keys()].map((id) => this._flushId(id)));
  }

  _schedule(id: string): void {
    const state = this._pending.get(id);
    if (!state || !state.dirty || this._disposed) return;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this._flushId(id).catch((e) => {
        console.debug("[gpen] ignored rejection: gpenBinary flush", e);
        return;
      });
    }, this._debounceMs);
  }

  async _loadPersisted(id: string): Promise<GpenT> {
    const raw = await this._deps.kv.get.gpen[id];
    if (raw === undefined)
      throw storageError(
        "metadata_missing",
        id,
        "no metadata entry; the document was never saved or its metadata was removed",
      );
    const metadata = parseMetadata(raw, id);
    const value = await this._deps.blob.get(metadata.blob);
    if (value === undefined)
      throw storageError(
        "blob_missing",
        id,
        `blob ${metadata.blob} referenced by the metadata is missing`,
      );
    if (value.size !== metadata.size)
      throw storageError(
        "size_mismatch",
        id,
        `blob size ${value.size} does not match metadata size ${metadata.size}; the last save may have failed after writing the blob`,
      );
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await value.arrayBuffer());
    } catch (error) {
      throw storageError("decode_failed", id, "failed to read the blob bytes", error);
    }
    try {
      return decodeGpen(bytes);
    } catch (error) {
      if (error instanceof GpenCodecError)
        throw storageError(
          "decode_failed",
          id,
          "stored bytes are not a decodable Gpen FlatBuffer",
          error,
        );
      throw error;
    }
  }

  async save(id: string, document: GpenT): Promise<GpenMetadata> {
    this._assertOpen();
    assertDocumentId(id);
    if (!this._cache) return this._enqueue(() => this._persistDocument(id, document));

    // A save-as/new document boundary must not leave another document dirty.
    for (const otherId of this._pending.keys()) if (otherId !== id) await this._flushId(otherId);
    const previous = this._pending.get(id);
    this._pending.set(id, {
      document,
      revision: (previous?.revision ?? 0) + 1,
      dirty: true,
    });
    this._schedule(id);
    // The returned metadata is a snapshot; the actual pack/write happens on flush.
    return (
      this._latestMetadata.get(id) ?? {
        document_id: id,
        schema_version: GPEN_SCHEMA_VERSION,
        codec_version: GPEN_CODEC_VERSION,
        size: 0,
        updated_at: new Date().toISOString(),
        blob: blobIdFor(id),
      }
    );
  }

  async load(id: string): Promise<GpenT> {
    this._assertOpen();
    assertDocumentId(id);
    if (this._cache) await this.commit();
    return this._loadPersisted(id);
  }

  async getMetadata(id: string): Promise<GpenMetadata | undefined> {
    this._assertOpen();
    assertDocumentId(id);
    if (this._cache) await this._flushId(id);
    const raw = await this._deps.kv.get.gpen[id];
    return raw === undefined ? undefined : parseMetadata(raw, id);
  }

  async del(id: string): Promise<void> {
    this._assertOpen();
    assertDocumentId(id);
    if (this._cache) await this._flushId(id);
    const raw = await this._deps.kv.get.gpen[id];
    let blobId: string | undefined;
    if (raw !== undefined) {
      try {
        blobId = parseMetadata(raw, id).blob;
        // oxlint-disable-next-line catch/must-return-or-throw -- 畸形元数据交由下方删除处理
      } catch {
        /* remove malformed metadata below */
      }
    }
    try {
      if (blobId !== undefined) await this._deps.blob.delete(blobId);
      await this._deps.kv.del.gpen[id];
      await this._deps.kv.submit();
      this._pending.delete(id);
      this._latestMetadata.delete(id);
    } catch (error) {
      throw storageError("delete_failed", id, "failed to delete the document", error);
    }
  }

  async commit(): Promise<void> {
    this._assertOpen();
    await this._flushAll();
    await this._operationTail;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const state of this._pending.values())
      if (state.timer !== undefined) clearTimeout(state.timer);
    this._pending.clear();
  }

  async sendCrossTab(type: string, payload: unknown, options?: TabBusSendOptions): Promise<void> {
    this._assertOpen();
    if (!this._deps.crossTabBus) throw new Error("crossTabBus was not configured for this store");
    await this.commit();
    await this._deps.crossTabBus.send(type, payload, options);
  }
}

/** 用依赖创建 Gpen 二进制文档存储。 */
export function createGpenBinaryStore(deps: GpenBinaryStoreDeps): GpenBinaryStore {
  const debounceMs = deps.debounceMs ?? 150;
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError("Gpen binary debounceMs must be a non-negative finite number");
  }
  const runtime = new GpenBinaryRuntime(deps, deps.cache ?? false, debounceMs);

  return {
    save: (id, document) => runtime.save(id, document),
    load: (id) => runtime.load(id),
    getMetadata: (id) => runtime.getMetadata(id),
    del: (id) => runtime.del(id),
    commit: () => runtime.commit(),
    dispose: () => runtime.dispose(),
    sendCrossTab: (type, payload, options) => runtime.sendCrossTab(type, payload, options),
  };
}
