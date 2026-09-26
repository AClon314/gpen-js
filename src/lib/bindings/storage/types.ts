import type { KvStorage } from "./kv.js";

/** JSON 标量。 */
export type JsonPrimitive = string | number | boolean | null;
/** 可 JSON 序列化的值（递归定义，含对象与数组）。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** 写 Blob 时可带的附加信息（原始来源 / 持久化 URL）。 */
export interface BlobSetOptions {
  /** Original external URL/path when a Blob represents an attachment. */
  source?: string;
  /** Explicit URL to persist in metadata hooks. */
  url?: string;
}

/** 一份完整 KV 的读写后端（整体 load / save）。 */
export interface KvBackend<T extends JsonValue = JsonValue> {
  readonly name: string;
  load(): Promise<T>;
  save(value: T): Promise<void>;
}

/** Blob 后端的 set / get / delete 接口。 */
export interface BlobBackend {
  readonly name: string;
  set(id: string, value: Blob, options?: BlobSetOptions): Promise<void>;
  get(id: string): Promise<Blob | undefined>;
  delete(id: string): Promise<void>;
}

/** 一组 KV + Blob 后端（runtime 适配器的公共形状）。 */
export interface Storage<T extends JsonValue = JsonValue, B extends BlobBackend = BlobBackend> {
  readonly kv: KvStorage<T>;
  readonly blob: B;
  close?(): void | Promise<void>;
}
