/**
 * `CodeArea` 的数据源注册表。
 *
 * CodeArea 是「一块可编辑的文本 + 一份数据的双向同步」的通用外壳，**不认识任何具体数据**
 * ——它只认 `CodeAreaSource`。数据源可以是内存里的 `$state`（调试用）、协议文档字段、
 * 甚至 IndexedDB 里的 KV 快照，area 侧一视同仁。
 *
 * 两条约定（见 `docs/code-area.md`）：
 *
 * 1. `read()` 是**同步**的，并在组件的 `$derived` 里调用：只要它内部读的是 `$state`，
 *    Svelte 自己就会订阅 → 实时刷新，不需要轮询、也不需要订阅机制。
 * 2. 一次性 / 异步的数据（KV、blob 列表）放可选的 `load()`：打开面板与点「刷新」时各跑
 *    一次，浅合并进同一棵 JSON 树。
 *
 * 注册表本身**不是响应式的**（与 `contextMenu.svelte.ts` 的注册表同款）：面板是
 * 命令式打开的，源的增删不需要驱动渲染。
 */

/** 面板 id 前缀：`codearea:<sourceId>`（同源只开一个 tab）。 */
export const CODE_AREA_PANEL_PREFIX = "codearea:";

export interface CodeAreaSource {
  /** 稳定 id：既用于面板 id，也用于「同源再开一次 = 聚焦」判定。 */
  id: string;
  /** tab 标题。 */
  title: string;
  /** 同步取当前值；放进 `$derived` 里就成为实时视图。 */
  read(): unknown;
  /** 可选的异步补充（KV 快照之类），浅合并到 `read()` 的结果上。 */
  load?(): Promise<Record<string, unknown>>;
  /** 有 `write` 就是可编辑；提交时把编辑器全文交给它。 */
  write?(text: string): void;
}

const registry = new Map<string, CodeAreaSource>();

/** 注册数据源；返回注销函数（面板组件持有它，卸载时清理）。 */
export function registerCodeAreaSource(source: CodeAreaSource): () => void {
  registry.set(source.id, source);
  return () => {
    if (registry.get(source.id) === source) registry.delete(source.id);
  };
}

export function getCodeAreaSource(id: string): CodeAreaSource | undefined {
  return registry.get(id);
}

/** 已注册的数据源（按注册顺序），给「打开哪个」这类菜单用。 */
export function listCodeAreaSources(): CodeAreaSource[] {
  return [...registry.values()];
}

export function codeAreaPanelId(sourceId: string): string {
  return `${CODE_AREA_PANEL_PREFIX}${sourceId}`;
}

export function isCodeAreaPanelId(panelId: string): boolean {
  return panelId.startsWith(CODE_AREA_PANEL_PREFIX);
}

/** `codearea:gpen-kv` → `gpen-kv`；不是 CodeArea 面板时返回 undefined。 */
export function codeAreaSourceIdOf(panelId: string): string | undefined {
  if (!isCodeAreaPanelId(panelId)) return undefined;
  const id = panelId.slice(CODE_AREA_PANEL_PREFIX.length);
  return id === "" ? undefined : id;
}

/**
 * 读一次源并兜住异常：数据源来自调试代码，`read()` 抛错不该把整个面板（以及 dockview
 * 的布局）带崩。返回值仍然是 `read()` 的原始结果，所以 `$state` 订阅不受影响。
 */
export function readCodeAreaSource(source: CodeAreaSource | undefined): unknown {
  if (!source) return { error: "数据源不存在（可能来自旧布局，见 docs/code-area.md）" };
  try {
    return source.read();
  } catch (error) {
    console.debug("[gpen] ignored rejection: CodeArea source read", source.id, error);
    return { error: `读取失败：${String(error)}` };
  }
}

/**
 * 把 `load()` 的异步结果浅浅合并到 `read()` 的树上（同步部分是实时的，异步部分只在
 * 打开 / 刷新时更新）。`base` 不是对象时异步结果单独成树，不静默丢数据。
 */
export function mergeCodeAreaSnapshot(
  base: unknown,
  extra: Record<string, unknown> | undefined,
): unknown {
  if (extra === undefined) return base;
  if (Array.isArray(base)) return { values: base, ...extra };
  if (typeof base !== "object" || base === null) return { value: base, ...extra };
  return { ...(base as Record<string, unknown>), ...extra };
}
