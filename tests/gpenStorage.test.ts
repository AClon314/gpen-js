import "fake-indexeddb/auto";

import { describe, expect, test } from "bun:test";
import {
  DrawingSlotT,
  DrawingT,
  FrameT,
  GpenT,
  IndexRangeT,
  LayerGroupT,
  LayerT,
  LayerTreeNodeT,
  PointT,
  StrokeFlagsT,
  StrokeT,
} from "gpen-protocol/flatbuffers";
import {
  createGpenBinaryStore,
  createKvStorage,
  createMemoryBlobBackend,
  createMemoryKvBackend,
  createMemoryStorage,
  GpenStorageError,
  type GpenKvRoot,
  type GpenMetadata,
} from "../src/lib/bindings/storage/index.ts";
import { decodeGpen, encodeGpen } from "../src/lib/bindings/flatbuffers/codec";
import { NONE_INDEX } from "../src/lib/bindings/flatbuffers/constants";

/**
 * Build a generated `*T` object from a partial literal. The generated object
 * API uses constructor parameter properties, so plain `Object.assign` over a
 * `new T()` keeps every default and avoids unreadable positional arguments.
 */
function make<T>(ctor: new () => T, init: Record<string, unknown>): T {
  const target = new ctor();
  for (const [key, value] of Object.entries(init)) {
    (target as Record<string, unknown>)[key] = value;
  }
  return target;
}

/** Exact float32 coercion: FlatBuffers f32 accessors round-trip with precision loss otherwise. */
const float32 = (value: number) => new Float32Array([value])[0];

const emptyDocument = make(GpenT, {
  drawings: [],
  nodes: [],
  layers: [],
  groups: [],
  materials: [],
  activeNodeIndex: NONE_INDEX,
  onionSkinningSettings: null,
  flags: null,
  childIndices: [],
});

function strokeDocument(): GpenT {
  return make(GpenT, {
    ...emptyDocument,
    drawings: [
      make(DrawingSlotT, {
        drawing: make(DrawingT, {
          type: 0,
          strokes: [
            make(StrokeT, {
              points: [
                make(PointT, {
                  x: 1,
                  y: 2,
                  z: 0,
                  radius: float32(0.5),
                  opacity: 1,
                  pressure: 1,
                  time: 0,
                  rotation: 0,
                  vertexColor: null,
                  flags: null,
                  tilt: null,
                  twist: 0,
                  pointerType: 2,
                  timestamp: 0,
                  miterAngle: 0,
                  handleLeft: null,
                  handleRight: null,
                  handleTypeLeft: 0,
                  handleTypeRight: 0,
                  nurbsWeight: 1,
                }),
              ],
              curveType: 0,
              materialIndex: 0,
              startCap: 0,
              endCap: 0,
              softness: 0,
              fillColor: null,
              fillId: 0,
              flags: make(StrokeFlagsT, {
                cyclic: false,
                selected: false,
                hidden: false,
                fillVisible: true,
              }),
              id: "stroke-1",
              initTime: 0,
              fillOpacity: 0,
              aspectRatio: 1,
              uScale: 1,
              uvRotation: 0,
              uvTranslation: null,
              uvScale: null,
              uTranslation: 0,
              anchor: null,
              resolution: 0,
              nurbsOrder: 0,
              nurbsKnotMode: 0,
              customKnots: [],
            }),
          ],
        }),
        reference: null,
      }),
    ],
    nodes: [
      make(LayerTreeNodeT, {
        name: "Root",
        type: 1,
        itemIndex: 0,
        parentIndex: NONE_INDEX,
        color: null,
        flags: null,
      }),
      make(LayerTreeNodeT, {
        name: "Ink",
        type: 0,
        itemIndex: 0,
        parentIndex: 0,
        color: null,
        flags: null,
      }),
    ],
    layers: [
      make(LayerT, {
        name: "Ink",
        type: 0,
        itemIndex: 0,
        parentIndex: 0,
        color: null,
        flags: null,
        frames: [
          make(FrameT, { frameNumber: 1, drawingIndex: 0, type: 0, flags: null, isEnd: false }),
        ],
        masks: [],
        blendMode: 0,
        opacity: 1,
        parent: null,
        transform: null,
        parentInverse: null,
        viewLayerName: "",
        activeMaskIndex: NONE_INDEX,
        passIndex: 0,
        tintColor: null,
        radiusOffset: 0,
      }),
    ],
    groups: [
      make(LayerGroupT, {
        name: "Root",
        type: 1,
        itemIndex: 0,
        parentIndex: NONE_INDEX,
        color: null,
        flags: null,
        childRange: make(IndexRangeT, { start: 0, len: 1 }),
        colorTag: 0,
      }),
    ],
    materials: [],
    activeNodeIndex: 1,
    childIndices: [1],
  });
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function loadError(promise: Promise<unknown>): Promise<GpenStorageError> {
  return promise.then(
    () => {
      throw new Error("expected a GpenStorageError, but the operation succeeded");
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(GpenStorageError);
      return error as GpenStorageError;
    },
  );
}

/** Assert a value is pure JSON (no typed arrays / binary types). */
function isPureJson(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPureJson);
  if (typeof value === "object") {
    if (value instanceof Uint8Array || value instanceof ArrayBuffer || value instanceof Blob) {
      return false;
    }
    return Object.values(value).every(isPureJson);
  }
  return false;
}

describe("Gpen binary storage (FBS-005)", () => {
  test("round-trips an empty document through Blob + KV metadata", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });

    const metadata = await store.save("doc-1", emptyDocument);
    expect(metadata.document_id).toBe("doc-1");
    expect(metadata.schema_version).toBe("v1");
    expect(metadata.codec_version).toBe(1);
    expect(metadata.size).toBe(encodeGpen(emptyDocument).byteLength);
    expect(metadata.blob).toBe("gpen/doc-1.bin");
    expect(Number.isFinite(Date.parse(metadata.updated_at))).toBe(true);

    const loaded = await store.load("doc-1");
    expect(loaded).toEqual(emptyDocument);
  });

  test("round-trips a document with a stroke, layer and group", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const document = strokeDocument();

    await store.save("doc-2", document);
    expect(await store.load("doc-2")).toEqual(document);
  });

  test("keeps KV purely JSON: metadata only, binary stays in the Blob backend", async () => {
    const backend = createMemoryKvBackend<GpenKvRoot>();
    const kv = createKvStorage(backend);
    const blob = createMemoryBlobBackend();
    const store = createGpenBinaryStore({ kv, blob });
    const document = strokeDocument();

    const metadata = await store.save("doc-3", document);
    const root = await backend.load();
    const entry = root.gpen["doc-3"];

    expect(entry).toEqual(metadata);
    expect(isPureJson(root)).toBe(true);
    expect(entry).not.toBeInstanceOf(Uint8Array);
    expect(entry).not.toBeInstanceOf(Blob);

    // The binary payload lives only in the Blob backend and decodes back.
    const value = await blob.get(metadata.blob);
    expect(value).toBeInstanceOf(Blob);
    expect(value?.type).toBe("application/octet-stream");
    expect(value?.size).toBe(metadata.size);
    expect(decodeGpen(new Uint8Array(await value!.arrayBuffer()))).toEqual(document);
    // No metadata entry exists for the binary path.
    expect(await kv.get.gpen["doc-3.bin"]).toBeUndefined();
  });

  test("reports missing metadata as a diagnostic error", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });

    const error = await loadError(store.load("never-saved"));
    expect(error.code).toBe("metadata_missing");
    expect(error.documentId).toBe("never-saved");
  });

  test("reports a missing blob as a diagnostic error", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const metadata = await store.save("doc-4", emptyDocument);

    await storage.blob.delete(metadata.blob);
    const error = await loadError(store.load("doc-4"));
    expect(error.code).toBe("blob_missing");
  });

  test("trusts bytes that remain structurally decodable after corruption", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const metadata = await store.save("doc-5", strokeDocument());

    // Flip bytes in the middle: same size (so the size check passes) but the
    // buffer is no longer a valid document.
    const bytes = new Uint8Array(await (await storage.blob.get(metadata.blob))!.arrayBuffer());
    const corrupt = bytes.slice();
    corrupt[Math.floor(corrupt.length / 2)] ^= 0xff;
    corrupt[Math.floor(corrupt.length / 2) + 1] ^= 0xff;
    await storage.blob.set(metadata.blob, new Blob([corrupt]));

    const loaded = await store.load("doc-5");
    expect(loaded).toBeInstanceOf(GpenT);
  });

  test("rejects an unsupported schema_version or codec_version", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const metadata = await store.save("doc-6", emptyDocument);

    await storage.kv.set.gpen["doc-6"]({ ...metadata, schema_version: "v2" });
    await storage.kv.submit();
    const schemaError = await loadError(store.load("doc-6"));
    expect(schemaError.code).toBe("version_mismatch");
    expect(schemaError.message).toContain("schema_version");

    await storage.kv.set.gpen["doc-6"]({ ...metadata, codec_version: 99 });
    await storage.kv.submit();
    const codecError = await loadError(store.load("doc-6"));
    expect(codecError.code).toBe("version_mismatch");
    expect(codecError.message).toContain("codec_version");
  });

  test("reports a size mismatch when the blob was written but metadata is stale", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const metadata = await store.save("doc-7", emptyDocument);

    // Simulate a save that wrote the new blob but failed to update the KV:
    // the stored metadata still describes the previous payload.
    const other = new Uint8Array(await (await storage.blob.get(metadata.blob))!.arrayBuffer());
    const padded = new Uint8Array(other.length + 3);
    padded.set(other);
    await storage.blob.set(metadata.blob, new Blob([padded]));

    const error = await loadError(store.load("doc-7"));
    expect(error.code).toBe("size_mismatch");
    expect(error.message).toContain(String(padded.length));
    expect(error.message).toContain(String(metadata.size));
  });

  test("delete removes both the blob and the metadata entry", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const metadata = await store.save("doc-8", emptyDocument);

    await store.del("doc-8");
    expect(await storage.blob.get(metadata.blob)).toBeUndefined();
    expect(await store.getMetadata("doc-8")).toBeUndefined();

    const error = await loadError(store.load("doc-8"));
    expect(error.code).toBe("metadata_missing");

    // Deleting again is idempotent.
    await store.del("doc-8");
  });

  test("rejects invalid document ids before touching storage", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });

    const error = await loadError(store.save("../escape", emptyDocument));
    expect(error.code).toBe("invalid_document_id");
    expect(await storage.kv.keys()).toEqual([]);
    const metadataError = await loadError(store.getMetadata("../escape"));
    expect(metadataError.code).toBe("invalid_document_id");
  });

  test("surfaces a write failure with context when the KV update fails", async () => {
    const backend = createMemoryKvBackend<GpenKvRoot>();
    let failSave = true;
    const kv = createKvStorage(backend, {
      hooks: {
        setters: {
          gpen() {
            if (failSave) throw new Error("kv unavailable");
          },
        },
      },
    });
    const blob = createMemoryBlobBackend();
    const store = createGpenBinaryStore({ kv, blob });

    const error = await loadError(store.save("doc-9", emptyDocument));
    expect(error.code).toBe("write_failed");
    // The blob was already written; a later load diagnoses the inconsistency
    // via the missing metadata entry.
    expect(await blob.get("gpen/doc-9.bin")).toBeInstanceOf(Blob);

    // Once KV recovers, saving again heals the document.
    failSave = false;
    const metadata = await store.save("doc-9", emptyDocument);
    expect(metadata.size).toBeGreaterThan(0);
    expect(await store.load("doc-9")).toEqual(emptyDocument);
  });

  test("exposes metadata without loading the blob", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    const store = createGpenBinaryStore({ kv: storage.kv, blob: storage.blob });
    const metadata = await store.save("doc-10", emptyDocument);

    const read = await store.getMetadata("doc-10");
    expect(read).toEqual(metadata);
    expect((await store.getMetadata("missing")) as GpenMetadata | undefined).toBeUndefined();
  });

  test("coalesces cached high-frequency saves into one trailing-edge binary write", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    let blobWrites = 0;
    const blob = {
      name: "counted-blob",
      async set(id: string, value: Blob) {
        blobWrites += 1;
        await storage.blob.set(id, value);
      },
      get: (id: string) => storage.blob.get(id),
      delete: (id: string) => storage.blob.delete(id),
    };
    const store = createGpenBinaryStore({ kv: storage.kv, blob, cache: true, debounceMs: 20 });

    await Promise.all([
      store.save("debounced", emptyDocument),
      store.save("debounced", emptyDocument),
      store.save("debounced", emptyDocument),
    ]);
    expect(blobWrites).toBe(0);
    await sleep(45);
    expect(blobWrites).toBe(1);
    expect(await store.load("debounced")).toEqual(emptyDocument);
    store.dispose();
  });

  test("commit flushes cached data immediately and dispose prevents a pending write", async () => {
    const storage = createMemoryStorage<GpenKvRoot>();
    let blobWrites = 0;
    const blob = {
      name: "counted-blob",
      async set(id: string, value: Blob) {
        blobWrites += 1;
        await storage.blob.set(id, value);
      },
      get: (id: string) => storage.blob.get(id),
      delete: (id: string) => storage.blob.delete(id),
    };
    const store = createGpenBinaryStore({ kv: storage.kv, blob, cache: true, debounceMs: 100 });

    await store.save("committed", emptyDocument);
    await store.commit();
    expect(blobWrites).toBe(1);

    await store.save("discarded", emptyDocument);
    store.dispose();
    await sleep(125);
    expect(blobWrites).toBe(1);
  });
});
