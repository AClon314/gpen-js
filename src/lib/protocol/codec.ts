import * as flatbuffers from "flatbuffers";
import { Gpen, GpenT, ToolbarState, ToolbarStateT } from "gpen-protocol/flatbuffers";

/**
 * FlatBuffers codec boundary (FBS-004).
 *
 * The business layer, storage adapters and layer adapter use the generated
 * object API (`GpenT` / `ToolbarStateT`, camelCase) directly; this module
 * only performs binary encode/decode and trusts the generated object API for
 * the decoded fields. There is no hand-written domain model or validation
 * mapping layer.
 *
 * `GpenT` / `ToolbarStateT` are re-exported here so consumers can import the
 * protocol types together with the codec instead of reaching into
 * `gpen-protocol/flatbuffers` from many places.
 */

export type GpenBytes = Uint8Array;

export { Gpen, GpenT, ToolbarState, ToolbarStateT };

export class GpenCodecError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GpenCodecError";
    this.cause = cause;
  }
}

/**
 * Decode an unframed v1 FlatBuffer into the generated object API.
 *
 * The input view is never retained after this function returns. It may have a
 * non-zero byteOffset; no assumption is made that the view spans its backing
 * ArrayBuffer.
 */
export function decodeGpen(bytes: GpenBytes): GpenT {
  const input = normalizeBytes(bytes);
  try {
    const byteBuffer = new flatbuffers.ByteBuffer(input);
    return Gpen.getRootAsGpen(byteBuffer).unpack();
  } catch (error) {
    if (error instanceof GpenCodecError) throw error;
    throw new GpenCodecError("failed to decode Gpen FlatBuffer", error);
  }
}

/**
 * Encode a `GpenT` document as an unframed v1 FlatBuffer.
 *
 * The returned Uint8Array owns a copy of the builder view, so callers may
 * transfer it through crossTabBus or release the builder immediately.
 */
export function encodeGpen(document: GpenT): GpenBytes {
  try {
    const builder = new flatbuffers.Builder(1024);
    const root = document.pack(builder);
    Gpen.finishGpenBuffer(builder, root);
    return new Uint8Array(builder.asUint8Array());
  } catch (error) {
    if (error instanceof GpenCodecError) throw error;
    throw new GpenCodecError("failed to encode Gpen FlatBuffer", error);
  }
}

export function decodeToolbarState(bytes: GpenBytes): ToolbarStateT {
  const input = normalizeBytes(bytes);
  try {
    const byteBuffer = new flatbuffers.ByteBuffer(input);
    return ToolbarState.getRootAsToolbarState(byteBuffer).unpack();
  } catch (error) {
    if (error instanceof GpenCodecError) throw error;
    throw new GpenCodecError("failed to decode ToolbarState FlatBuffer", error);
  }
}

export function encodeToolbarState(state: ToolbarStateT): GpenBytes {
  try {
    const builder = new flatbuffers.Builder(512);
    const root = state.pack(builder);
    builder.finish(root);
    return new Uint8Array(builder.asUint8Array());
  } catch (error) {
    if (error instanceof GpenCodecError) throw error;
    throw new GpenCodecError("failed to encode ToolbarState FlatBuffer", error);
  }
}

function normalizeBytes(bytes: GpenBytes): Uint8Array {
  if (!(bytes instanceof Uint8Array))
    throw new GpenCodecError("FlatBuffer input must be a Uint8Array");
  if (bytes.byteLength === 0) throw new GpenCodecError("FlatBuffer input is empty");
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
