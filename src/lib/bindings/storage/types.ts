/** JSON 标量。 */
export type JsonPrimitive = string | number | boolean | null;
/** 可 JSON 序列化的值（递归定义，含对象与数组）。 */
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** 路径键：对象字段名或数组下标。 */
export type StoragePathKey = string | number;

/** get 钩子的上下文：路径、根、当前值。 */
export interface KvGetHookContext<T extends JsonValue> {
  readonly self: KvStorage<T>;
  readonly path: readonly StoragePathKey[];
  readonly root: T;
  readonly hookName: string;
  readonly value: JsonValue | undefined;
}

/** set 钩子的上下文：路径、根、新值与旧值。 */
export interface KvSetHookContext<T extends JsonValue> {
  readonly self: KvStorage<T>;
  readonly path: readonly StoragePathKey[];
  readonly root: T;
  readonly hookName: string;
  readonly value: JsonValue;
  readonly previousValue: JsonValue | undefined;
}

/** delete 钩子的上下文：路径、根与被删的旧值。 */
export interface KvDeleteHookContext<T extends JsonValue> {
  readonly self: KvStorage<T>;
  readonly path: readonly StoragePathKey[];
  readonly root: T;
  readonly hookName: string;
  readonly previousValue: JsonValue | undefined;
}

/** get 钩子：可改写 / 兜底读到的值（返回 undefined 走原逻辑）。 */
export type KvGetHook<T extends JsonValue> = (
  context: KvGetHookContext<T>,
) => JsonValue | undefined | PromiseLike<JsonValue | undefined>;
/** set 钩子：写入时联动外部存储之类的副作用。 */
export type KvSetHook<T extends JsonValue> = (
  context: KvSetHookContext<T>,
) => unknown | PromiseLike<unknown>;
/** delete 钩子：删除时联动外部存储之类的副作用。 */
export type KvDeleteHook<T extends JsonValue> = (
  context: KvDeleteHookContext<T>,
) => unknown | PromiseLike<unknown>;

/** 可按名字注册的 get / set / delete 钩子集合。 */
export interface KvStorageHooks<T extends JsonValue> {
  getters?: Record<string, KvGetHook<T>>;
  setters?: Record<string, KvSetHook<T>>;
  deleters?: Record<string, KvDeleteHook<T>>;
}

/** Runtime hook registries. The maps are intentionally mutable so plugins can
 * be installed after the storage object has been created. */
export interface KvStorageProxy<T extends JsonValue> {
  getters: Record<string, KvGetHook<T>>;
  setters: Record<string, KvSetHook<T>>;
  deleters: Record<string, KvDeleteHook<T>>;
}

type PreviousDepth = [never, 0, 1, 2, 3, 4, 5, 6];
type ReservedReadKey = "then" | "keys" | "toJSON";
type ReservedThenKey = "then" | "toJSON";

/** 读路径的 PromiseLike 协议（then 后拿到值）。 */
export type ReadProtocol<T> = PromiseLike<T | undefined> & {
  keys(): Promise<string[]>;
};

/** 写路径的调用协议（调用后完成写入）。 */
export type SetProtocol<T> = (value: T) => Promise<void>;
/** 删除路径的 PromiseLike 协议。 */
export type DeleteProtocol = PromiseLike<void>;

/** 读路径在给定深度下的子节点映射。 */
export type ReadChildren<T, Depth extends number> = Depth extends 0
  ? Record<string, ReadProtocol<JsonValue>>
  : T extends readonly (infer Item)[]
    ? { [index: number]: ReadNode<Item, PreviousDepth[Depth]> }
    : T extends object
      ? {
          [Key in keyof T as Key extends ReservedReadKey ? never : Key]-?: ReadNode<
            T[Key],
            PreviousDepth[Depth]
          >;
        }
      : Record<string, ReadProtocol<JsonValue>>;

/** 写路径在给定深度下的子节点映射。 */
export type SetChildren<T, Depth extends number> = Depth extends 0
  ? Record<string, SetProtocol<JsonValue>>
  : T extends readonly (infer Item)[]
    ? { [index: number]: SetNode<Item, PreviousDepth[Depth]> }
    : T extends object
      ? {
          [Key in keyof T as Key extends ReservedThenKey ? never : Key]-?: SetNode<
            T[Key],
            PreviousDepth[Depth]
          >;
        }
      : Record<string, SetProtocol<JsonValue>>;

/** 删除路径在给定深度下的子节点映射。 */
export type DeleteChildren<T, Depth extends number> = Depth extends 0
  ? Record<string, DeleteProtocol>
  : T extends readonly (infer Item)[]
    ? { [index: number]: DeleteNode<Item, PreviousDepth[Depth]> }
    : T extends object
      ? {
          [Key in keyof T as Key extends ReservedThenKey ? never : Key]-?: DeleteNode<
            T[Key],
            PreviousDepth[Depth]
          >;
        }
      : Record<string, DeleteProtocol>;

/** 读节点：值协议 + 子节点。 */
export type ReadNode<T, Depth extends number = 6> = ReadProtocol<T> & ReadChildren<T, Depth>;
/** 写节点：值协议 + 子节点。 */
export type SetNode<T, Depth extends number = 6> = SetProtocol<T> & SetChildren<T, Depth>;
/** 删除节点：值协议 + 子节点。 */
export type DeleteNode<T, Depth extends number = 6> = DeleteProtocol & DeleteChildren<T, Depth>;

/** 顶层读命名空间。 */
export type GetNamespace<T, Depth extends number = 6> = ReadChildren<T, Depth>;
/** 顶层写命名空间。 */
export type SetNamespace<T, Depth extends number = 6> = SetChildren<T, Depth>;
/** 顶层删除命名空间。 */
export type DeleteNamespace<T, Depth extends number = 6> = DeleteChildren<T, Depth>;

/** 首次读取前的初始值：值、Promise，或基于旧值的迁移函数。 */
export type KvInitialValue<T extends JsonValue> =
  | T
  | PromiseLike<T>
  | ((oldValue: T) => T | PromiseLike<T>);

/** 创建 KV 时的选项（缓存开关、初始值、版本、钩子）。 */
export interface KvStorageOptions<T extends JsonValue> {
  /** Initial cache mode; can be changed through KvStorage.cache. */
  cache?: boolean;
  /** A value, promise, or migration/default callback evaluated once per store. */
  initValue?: KvInitialValue<T>;
  /** Application/schema version metadata. */
  version?: string;
  versionNum?: readonly number[];
  /** Optional hooks for synchronizing KV with another storage service. */
  hooks?: KvStorageHooks<T>;
}

/** 路径访问器（get / set / del / proxy）+ 提交接口。 */
export type KvStorage<T extends JsonValue, Depth extends number = 6> = {
  readonly name: string;
  cache: boolean;
  readonly get: GetNamespace<T, Depth>;
  readonly set: SetNamespace<T, Depth>;
  readonly del: DeleteNamespace<T, Depth>;
  readonly proxy: KvStorageProxy<T>;
  keys(): Promise<string[]>;
  submit(): Promise<void>;
  readonly version?: string;
  readonly versionNum?: readonly number[];
};

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
