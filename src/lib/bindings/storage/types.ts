import type { KvStorage } from "./kv.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface BlobSetOptions {
  /** Original external URL/path when a Blob represents an attachment. */
  source?: string;
  /** Explicit URL to persist in metadata hooks. */
  url?: string;
}

export interface KvBackend<T extends JsonValue = JsonValue> {
  readonly name: string;
  load(): Promise<T>;
  save(value: T): Promise<void>;
}

export interface BlobBackend {
  readonly name: string;
  set(id: string, value: Blob, options?: BlobSetOptions): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
}

export interface Storage<T extends JsonValue = JsonValue, B extends BlobBackend = BlobBackend> {
  readonly kv: KvStorage<T>;
  readonly blob: B;
  close?(): void | Promise<void>;
}
