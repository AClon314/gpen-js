import type { JsonValue, StoragePathKey } from "./types.js";

type JsonRecord = { [key: string]: JsonValue };

const isContainer = (value: JsonValue | undefined): value is JsonValue[] | JsonRecord =>
  Array.isArray(value) || (typeof value === "object" && value !== null);

/** 把属性名转成路径键（纯数字字符串转成数组下标）。 */
export function asPathKey(property: string): StoragePathKey {
  return /^(0|[1-9]\d*)$/.test(property) ? Number(property) : property;
}

function readChild(
  container: JsonValue[] | JsonRecord,
  key: StoragePathKey,
): JsonValue | undefined {
  const name = String(key);
  // Only own properties are KV data. Reading through the prototype chain would
  // expose `Object.prototype` members (and let `__proto__` reach the prototype).
  if (!Object.hasOwn(container, name)) return undefined;
  return (container as unknown as Record<string, JsonValue | undefined>)[name];
}

function deleteChild(container: JsonValue[] | JsonRecord, key: StoragePathKey): void {
  if (Array.isArray(container) && typeof key === "number") {
    delete container[key];
    return;
  }

  delete (container as JsonRecord)[String(key)];
}

/** 读取 `path` 处的值（沿途遇到非容器即返回 undefined）。 */
export function getAtPath(root: JsonValue, path: StoragePathKey[]): JsonValue | undefined {
  let current: JsonValue | undefined = root;

  for (const key of path) {
    if (!isContainer(current)) return undefined;
    current = readChild(current, key);
  }

  return current;
}

function createContainer(nextKey: StoragePathKey): JsonValue[] | JsonRecord {
  return typeof nextKey === "number" ? [] : {};
}

function assignAtPath(
  container: JsonValue[] | JsonRecord,
  key: StoragePathKey,
  value: JsonValue,
): void {
  if (Array.isArray(container) && typeof key === "number") {
    container[key] = value;
    return;
  }

  // `container[key] = value` would run the inherited `__proto__` setter when a
  // key is literally `__proto__`, mutating the prototype instead of storing data.
  Object.defineProperty(container, String(key), {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/** 不可变地往 `path` 写值，返回新的根（沿途缺容器则补）。 */
export function setAtPath(root: JsonValue, path: StoragePathKey[], value: JsonValue): JsonValue {
  if (path.length === 0) return value;

  const result = isContainer(root) ? root : createContainer(path[0]);
  let current = result;

  for (let index = 0; index < path.length; index += 1) {
    const key = path[index];
    if (index === path.length - 1) {
      assignAtPath(current, key, value);
      break;
    }

    const nextKey = path[index + 1];
    const existing = readChild(current, key);
    const next = isContainer(existing) ? existing : createContainer(nextKey);
    assignAtPath(current, key, next);
    current = next;
  }

  return result;
}

/** 不可变地删掉 `path` 指向的键，返回新的根。 */
export function deleteAtPath(root: JsonValue, path: StoragePathKey[]): JsonValue {
  if (path.length === 0) return {};
  if (!isContainer(root)) return root;

  let current: JsonValue[] | JsonRecord = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const next = readChild(current, path[index]);
    if (!isContainer(next)) return root;
    current = next;
  }

  deleteChild(current, path[path.length - 1]);
  return root;
}

/** 列出 `path` 处的键（不是容器则返回空数组）。 */
export function listKeysAtPath(root: JsonValue, path: StoragePathKey[]): string[] {
  const value = getAtPath(root, path);
  return isContainer(value) ? Object.keys(value) : [];
}

/** 结构化克隆一份值（无 structuredClone 时退回 JSON）。 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every(isJsonValue);
}

/** 断言值是纯 JSON（否则抛 TypeError）。 */
export function assertJsonValue(value: unknown): asserts value is JsonValue {
  if (!isJsonValue(value)) throw new TypeError("KV values must be JSON values");
}
