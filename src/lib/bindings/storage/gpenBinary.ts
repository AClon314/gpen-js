/**
 * FBS-005: FlatBuffers Gpen documents on top of the existing Blob/KV storage.
 *
 * Binary Gpen payloads (unframed v1 FlatBuffers, see
 * `gpen-protocol/docs/flatbuffers.md`) are stored in the Blob backend under
 * `gpen/<document-id>.bin`. The KV only holds versioned JSON metadata
 * (`kv.gpen.<id>`); Uint8Array/ArrayBuffer values are never written to KV.
 *
 * The two backends do not form a transaction: `save` writes the blob first
 * and then the metadata. If the metadata update fails, the next `load`
 * reports the inconsistency through the `size_mismatch`
 * diagnostic (blob size vs. stored metadata size) instead of silently
 * serving a half-written document.
 */
import type { GpenT } from "../flatbuffers/codec";
import { decodeGpen, encodeGpen, GpenCodecError } from "../flatbuffers/codec";
import type { KvStorage } from "./kv.js";
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
  if (typeof blob !== "string" || blob.length === 0) {
    throw storageError("invalid_metadata", id, "blob reference must be a non-empty string");
  }
  return {
    document_id: id,
    schema_version: schemaVersion,
    codec_version: codecVersion,
    size,
    updated_at: updatedAt,
    blob,
  };
}

export function createGpenBinaryStore(deps: GpenBinaryStoreDeps): GpenBinaryStore {
  const cache = deps.cache ?? false;
  const debounceMs = deps.debounceMs ?? 150;
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new RangeError("Gpen binary debounceMs must be a non-negative finite number");
  }

  type Pending = {
    document: GpenT;
    revision: number;
    dirty: boolean;
    timer?: ReturnType<typeof setTimeout>;
  };
  const pending = new Map<string, Pending>();
  const latestMetadata = new Map<string, GpenMetadata>();
  let disposed = false;
  let operationTail = Promise.resolve();

  const assertOpen = () => {
    if (disposed) throw new Error("Gpen binary store is disposed");
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = operationTail.then(operation);
    operationTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const persistDocument = async (id: string, document: GpenT): Promise<GpenMetadata> => {
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
      await deps.blob.set(blobId, new Blob([new Uint8Array(bytes)], { type: GPEN_BLOB_TYPE }));
    } catch (error) {
      throw storageError("write_failed", id, `failed to write blob ${blobId}`, error);
    }
    try {
      await deps.kv.set.gpen[id](metadata);
      await deps.kv.submit();
    } catch (error) {
      throw storageError(
        "write_failed",
        id,
        `blob ${blobId} was written but the metadata update failed; the next load will report a size mismatch`,
        error,
      );
    }
    latestMetadata.set(id, metadata);
    return metadata;
  };

  const flushId = (id: string): Promise<void> => {
    const state = pending.get(id);
    if (!state || !state.dirty) return Promise.resolve();
    if (state.timer !== undefined) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }
    const revision = state.revision;
    const document = state.document;
    return enqueue(async () => {
      const metadata = await persistDocument(id, document);
      const current = pending.get(id);
      if (current && current.revision === revision) {
        current.dirty = false;
        latestMetadata.set(id, metadata);
      }
    });
  };

  const flushAll = async (): Promise<void> => {
    await Promise.all([...pending.keys()].map((id) => flushId(id)));
  };

  const schedule = (id: string): void => {
    const state = pending.get(id);
    if (!state || !state.dirty || disposed) return;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void flushId(id).catch(() => undefined);
    }, debounceMs);
  };

  const loadPersisted = async (id: string): Promise<GpenT> => {
    const raw = await deps.kv.get.gpen[id];
    if (raw === undefined)
      throw storageError(
        "metadata_missing",
        id,
        "no metadata entry; the document was never saved or its metadata was removed",
      );
    const metadata = parseMetadata(raw, id);
    const value = await deps.blob.get(metadata.blob);
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
  };

  const save = async (id: string, document: GpenT): Promise<GpenMetadata> => {
    assertOpen();
    assertDocumentId(id);
    if (!cache) return enqueue(() => persistDocument(id, document));

    // A save-as/new document boundary must not leave another document dirty.
    for (const otherId of pending.keys()) if (otherId !== id) await flushId(otherId);
    const previous = pending.get(id);
    const state: Pending = {
      document,
      revision: (previous?.revision ?? 0) + 1,
      dirty: true,
    };
    pending.set(id, state);
    schedule(id);
    // The returned metadata is a snapshot; the actual pack/write happens on flush.
    return (
      latestMetadata.get(id) ?? {
        document_id: id,
        schema_version: GPEN_SCHEMA_VERSION,
        codec_version: GPEN_CODEC_VERSION,
        size: 0,
        updated_at: new Date().toISOString(),
        blob: blobIdFor(id),
      }
    );
  };

  const commit = async (): Promise<void> => {
    assertOpen();
    await flushAll();
    await operationTail;
  };

  const store: GpenBinaryStore = {
    save,
    async load(id) {
      assertOpen();
      assertDocumentId(id);
      if (cache) await commit();
      return loadPersisted(id);
    },
    async getMetadata(id) {
      assertOpen();
      assertDocumentId(id);
      if (cache) await flushId(id);
      const raw = await deps.kv.get.gpen[id];
      return raw === undefined ? undefined : parseMetadata(raw, id);
    },
    async del(id) {
      assertOpen();
      assertDocumentId(id);
      if (cache) await flushId(id);
      const raw = await deps.kv.get.gpen[id];
      let blobId: string | undefined;
      if (raw !== undefined) {
        try {
          blobId = parseMetadata(raw, id).blob;
        } catch {
          /* remove malformed metadata below */
        }
      }
      try {
        if (blobId !== undefined) await deps.blob.delete(blobId);
        await deps.kv.del.gpen[id];
        await deps.kv.submit();
        pending.delete(id);
        latestMetadata.delete(id);
      } catch (error) {
        throw storageError("delete_failed", id, "failed to delete the document", error);
      }
    },
    commit,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const state of pending.values())
        if (state.timer !== undefined) clearTimeout(state.timer);
      pending.clear();
    },
    async sendCrossTab(type, payload, options) {
      assertOpen();
      if (!deps.crossTabBus) throw new Error("crossTabBus was not configured for this store");
      await commit();
      await deps.crossTabBus.send(type, payload, options);
    },
  };
  return store;
}
