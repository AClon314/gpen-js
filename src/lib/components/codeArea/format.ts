/**
 * 调试值 → 文本（`CodeArea` 的内容格式化）。
 *
 * `JSON.stringify` 在这里不够用：调试对象里塞满了 JSON 表达不了的东西——循环引用、
 * 函数、DOM 节点、`Map`/`Set`、`undefined`、`bigint`、会抛错的 getter。所以先把值
 * **归一化成 JSON 安全树**（不支持的换成尖括号标记、循环标 `<circular>`、超限折成
 * `… 省略 N 项`），再 `stringify`，最后按 `maxLength` 截断。
 *
 * 纯函数、不碰 Svelte（`bun test` 直接测）。DOM 相关分支只在浏览器里生效
 * （`typeof Node` 守卫，`bun test` 下走不到）。
 */

/** 默认上限：文本长度按字符算（CodeMirror 拿 10 万字符量级仍然流畅）。 */
export const DEBUG_FORMAT_DEFAULTS = {
  maxLength: 120_000,
  maxEntries: 200,
  maxDepth: 8,
} as const;

/** 调试文本格式化的上限（长度 / 展开条数 / 递归深度）。 */
export interface DebugFormatLimits {
  /** 输出文本的最大字符数，超出就截断并附一行说明。 */
  maxLength?: number;
  /** 单个数组 / 对象 / Map / Set 最多展开多少项，其余折成一行省略说明。 */
  maxEntries?: number;
  /** 递归深度上限，超出折成 `<depth N>`。 */
  maxDepth?: number;
}

/** 格式化结果：文本、是否截断、完整长度、省略条数。 */
export interface DebugFormatResult {
  /** 可以直接塞进 CodeEditor 的文本。 */
  text: string;
  /** 是否因为 `maxLength` 被截断。 */
  truncated: boolean;
  /** 截断前的完整长度（字符数）。 */
  fullLength: number;
  /** 被省略的条目数（`maxEntries` / `maxDepth` 触发）。 */
  omitted: number;
}

interface FormatContext {
  maxEntries: number;
  maxDepth: number;
  /** 当前递归路径上的对象（判定**循环**用；同一个对象出现两次但不成环是允许的）。 */
  seen: WeakSet<object>;
  omitted: number;
}

function limit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function functionLabel(value: (...args: never[]) => unknown): string {
  const name = value.name;
  return typeof name === "string" && name !== "" ? `<function ${name}>` : "<function>";
}

/** `<div#id.class>` 这样的短描述；非 DOM 节点返回 undefined。 */
function domNodeLabel(value: object): string | undefined {
  if (typeof Node === "undefined" || !(value instanceof Node)) return undefined;
  const element = value as { nodeName?: unknown; id?: unknown; className?: unknown };
  const name = typeof element.nodeName === "string" ? element.nodeName.toLowerCase() : "node";
  const id = typeof element.id === "string" && element.id !== "" ? `#${element.id}` : "";
  // SVG 元素的 `className` 是 SVGAnimatedString，不是字符串——只认字符串。
  const className =
    typeof element.className === "string" && element.className !== ""
      ? `.${element.className.trim().split(/\s+/).join(".")}`
      : "";
  return `<${name}${id}${className}>`;
}

/** 属性读取单独成函数：getter 抛错时要有 `return`，不能只赋值（仓库的 catch 规则）。 */
function readProperty(container: object, key: string): unknown {
  try {
    return (container as Record<string, unknown>)[key];
  } catch (error) {
    console.debug("[gpen] ignored rejection: codeArea format property read", key, error);
    return "<读取抛错>";
  }
}

function toSafeData(value: unknown, depth: number, context: FormatContext): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "undefined":
      return "<undefined>";
    case "bigint":
      return `<bigint ${value.toString()}n>`;
    case "symbol":
      return `<symbol ${value.description ?? ""}>`;
    case "function":
      return functionLabel(value as (...args: never[]) => unknown);
    default:
      break;
  }

  const object = value as object;
  const dom = domNodeLabel(object);
  if (dom !== undefined) return dom;
  if (object instanceof Date) return `<Date ${object.toISOString()}>`;
  if (object instanceof RegExp) return `<RegExp ${object.source}>`;
  if (object instanceof Error) return { name: object.name, message: object.message };
  if (typeof Promise !== "undefined" && object instanceof Promise) return "<Promise>";

  if (context.seen.has(object)) return "<circular>";
  if (depth >= context.maxDepth) {
    context.omitted += 1;
    return `<depth ${context.maxDepth}>`;
  }
  context.seen.add(object);

  const result = Array.isArray(object)
    ? toSafeArray(object, depth, context)
    : toSafeObject(object, depth, context);

  context.seen.delete(object);
  return result;
}

function toSafeArray(value: unknown[], depth: number, context: FormatContext): unknown[] {
  const result: unknown[] = [];
  for (const [index, item] of value.entries()) {
    if (index >= context.maxEntries) {
      context.omitted += value.length - index;
      result.push(`… 省略 ${value.length - index} 项`);
      break;
    }
    result.push(toSafeData(item, depth + 1, context));
  }
  return result;
}

function stringifySafe(safe: unknown): string {
  try {
    return JSON.stringify(safe, null, 2) ?? String(safe);
  } catch (error) {
    console.debug("[gpen] ignored rejection: codeArea format stringify", error);
    return String(safe);
  }
}

function toSafeObject(object: object, depth: number, context: FormatContext): unknown {
  if (object instanceof Map) {
    const entries = [...object.entries()];
    return { "<Map>": toSafeArray(entries, depth, context) };
  }
  if (object instanceof Set) {
    return { "<Set>": toSafeArray([...object.values()], depth, context) };
  }

  const keys = Object.keys(object);
  const result: Record<string, unknown> = {};
  for (const [index, key] of keys.entries()) {
    if (index >= context.maxEntries) {
      context.omitted += keys.length - index;
      result["…"] = `省略 ${keys.length - index} 项`;
      break;
    }
    result[key] = toSafeData(readProperty(object, key), depth + 1, context);
  }
  return result;
}

/**
 * 把任意值格式化成可读文本。
 *
 * 返回 `fullLength` 与 `omitted`，是因为 UI 要能诚实地告诉用户「你看到的不是全部」
 * —— 调试工具静默丢数据比报错更糟。
 */
export function formatDebugValue(
  value: unknown,
  limits: DebugFormatLimits = {},
): DebugFormatResult {
  const context: FormatContext = {
    maxEntries: limit(limits.maxEntries, DEBUG_FORMAT_DEFAULTS.maxEntries),
    maxDepth: limit(limits.maxDepth, DEBUG_FORMAT_DEFAULTS.maxDepth),
    seen: new WeakSet(),
    omitted: 0,
  };
  const safe = toSafeData(value, 0, context);
  const text = stringifySafe(safe);

  const maxLength = limit(limits.maxLength, DEBUG_FORMAT_DEFAULTS.maxLength);
  const fullLength = text.length;
  if (fullLength <= maxLength) {
    return { text, truncated: false, fullLength, omitted: context.omitted };
  }
  return {
    text: `${text.slice(0, maxLength)}\n… 已截断：完整 ${fullLength} 字符，只显示前 ${maxLength} 字符`,
    truncated: true,
    fullLength,
    omitted: context.omitted,
  };
}
