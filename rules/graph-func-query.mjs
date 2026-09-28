/**
 * `graph-func-query` —— 函数级调用图的**选择器解析 + 邻接表 + 遍历查询 + 输出（人类/JSON）
 * + 未解析边界（带类别）+ CLI**（S2a / S2b / S2c / S3c）。
 *
 * 纯逻辑：
 *
 *  1. `loadFuncGraph()`：把 `rules/out/func.json` 归一化成「节点数组 + 正/反向邻接」；
 *  2. `resolveSelector()`：把「函数名 / `file:line` / glob」解析成节点 id 列表；
 *  3. `traverse()`：沿 **call 边** 做 BFS（`callers` / `callees` / `both`，带 `depth`）；
 *  4. `renderTree()`：人类视图（缩进树 + ⚠ 未解析边界 + 汇总 + 可信度警告）；
 *  5. `buildCallIndex()` / `collectBoundaries()` / `buildResultJson()`：`--json` 契约与
 *     未解析边界（读 `rules/out/func-calls.json`，**只在需要边界时才加载**）。
 *  6. `loadBoundaryData()`：读 S3b 的 `rules/out/func-boundaries.json`（callId → 类别），
 *     给边界补 `kind` / `kindLabel` / `symbol`；文件缺失时**优雅降级**成 `kind: "unresolved"`。
 *
 * CLI（`callers` / `callees` / `impact`，`bun rules/graph-func-query.mjs <cmd> <selector> [--depth N] [--json]`）
 * 由文件末尾的 `import.meta.main` 守卫，**导入本模块不会执行 CLI**。
 *
 * 设计要点：
 *
 *  - **零依赖**，只用 node 内置模块；不重跑 jelly，只读基线 json。
 *  - `func.json` 的 `fun2fun` 把**调用边和 import 边混在一起**。这里用 `requireEdges`
 *    拆开：`callees` / `callers` 只放调用边，require 边单独放在 `requireTargets` /
 *    `requireSources`（`kind: "require"` 语义）。
 *  - `moduleNodes` 是「整个模块」的容器节点（范围覆盖整文件），默认不参与选择，
 *    需要时传 `{ includeModules: true }`。
 *  - 选择器歧义 / 无匹配一律抛 `SelectorError`（带 `candidates`），不静默取第一个。
 *  - **未解析边界**（§4.4）：`func-calls.json` 里出现在 `calls` 但不在 `call2fun` 的调用点。
 *    调用点按**位置包含**归给「最内层」函数（词法嵌套 = 调用发生在哪个函数体内）；
 *    不在任何函数范围内（模块顶层）则归给该文件的模块节点。只报告**结果集合内**节点
 *    拥有的边界，避免把全仓库的噪音倒出来。
 *  - **边界类别**（S3c）：每个边界带上离线分类（`func-boundaries.json`），人类视图按类别
 *    汇总；`C2`（本仓库真漏，唯一「本该连上却没连上」的类别）用 `‼` 强标记。
 *    分类文件缺失/残缺时，缺的那部分退回 `kind: "unresolved"`（不报错、不中断）。
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** 默认基线路径：`rules/out/func.json`。 */
export const FUNC_GRAPH_PATH = join(MODULE_DIR, "out", "func.json");

/** 调用点基线路径：`rules/out/func-calls.json`（只在算未解析边界时读）。 */
export const FUNC_CALLS_PATH = join(MODULE_DIR, "out", "func-calls.json");

/** 未解析调用点分类基线（S3b 产物，S3c 消费）；缺失时优雅降级。 */
export const FUNC_BOUNDARIES_PATH = join(MODULE_DIR, "out", "func-boundaries.json");

/** 仓库根 = `rules/` 的上一级；读源码行（边界 `text`）时用。 */
const REPO_ROOT = resolve(MODULE_DIR, "..");

/** 选择器解析失败时抛出；`code` ∈ `invalid` / `not-found` / `ambiguous`。 */
export class SelectorError extends Error {
  constructor(code, selector, candidates, message) {
    super(message);
    this.name = "SelectorError";
    this.code = code;
    this.selector = selector;
    this.candidates = candidates;
  }
}

/** 解析位置串 `"<fileIndex>:<startLine>:<startCol>:<endLine>:<endCol>"`（行/列 1-based）。 */
export function parseLocation(location) {
  const [fileIndex, startLine, startCol, endLine, endCol] = location.split(":").map(Number);
  return { fileIndex, startLine, startCol, endLine, endCol };
}

/** 是否含 glob 元字符（只认 `*` / `?`；`[...]` 不作字符类，按字面量处理）。 */
export function hasGlobMagic(query) {
  return /[*?]/.test(query);
}

/**
 * 把 glob 编译成正则：`*` 不跨 `/`，`**` 跨目录（后接 `/` 时折叠为零或多级），
 * `?` 匹配单个非 `/` 字符；其余字符（含 `[` / `]`）一律转义为字面量。
 */
export function globToRegExp(glob) {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      source += ".*";
      index += 1;
      if (glob[index + 1] === "/") index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

/** 单次 glob 匹配（跨文件批量匹配时请先 `globToRegExp` 复用）。 */
export function globMatches(glob, path) {
  return globToRegExp(glob).test(path);
}

/** 从磁盘读 `func.json` 建图；默认读 `rules/out/func.json`。 */
export function loadFuncGraph(jsonPath = FUNC_GRAPH_PATH) {
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  return buildGraph(data);
}

/** 从已解析的 `func.json` 对象建图（纯函数，便于合成数据单测）。 */
export function buildGraph(data) {
  const moduleIds = new Set(data.moduleNodes ?? []);
  const entries = new Set(data.entries ?? []);
  const moduleIdByFile = mapModuleIds(data, moduleIds);
  const nodes = data.functionNames.map((name, id) =>
    makeNode(data, id, name, moduleIds, entries, moduleIdByFile),
  );
  const { callEdges, requireEdges } = splitEdges(data);
  const { forward, reverse } = buildAdjacency(nodes.length, callEdges);
  const requireAdj = buildAdjacency(nodes.length, requireEdges);
  return {
    json: data,
    files: [...data.files],
    entries,
    nodes,
    moduleNodeIds: [...(data.moduleNodes ?? [])],
    moduleIdByFile,
    callEdges,
    requireEdges,
    callees: forward,
    callers: reverse,
    requireTargets: requireAdj.forward,
    requireSources: requireAdj.reverse,
    nameIndex: buildNameIndex(nodes),
  };
}

/** 每个文件对应的「整个模块」节点 id。 */
function mapModuleIds(data, moduleIds) {
  const byFile = new Map();
  for (const id of moduleIds) {
    const loc = parseLocation(data.functions[String(id)]);
    byFile.set(loc.fileIndex, id);
  }
  return byFile;
}

function makeNode(data, id, name, moduleIds, entries, moduleIdByFile) {
  const location = data.functions[String(id)];
  if (!location) throw new Error(`func.json 缺 functions["${id}"]`);
  const loc = parseLocation(location);
  const modulePath = data.files[loc.fileIndex];
  return {
    id,
    file: modulePath,
    fileIndex: loc.fileIndex,
    line: loc.startLine,
    col: loc.startCol,
    endLine: loc.endLine,
    endCol: loc.endCol,
    name,
    moduleId: moduleIdByFile.get(loc.fileIndex) ?? null,
    modulePath,
    isModule: moduleIds.has(id),
    isEntry: entries.has(modulePath),
  };
}

/** 用 `requireEdges` 从 `fun2fun` 里拆出调用边与 require 边。 */
function splitEdges(data) {
  const requireKeys = new Set((data.requireEdges ?? []).map(([from, to]) => edgeKey(from, to)));
  const callEdges = [];
  const requireEdges = [];
  for (const [from, to] of data.fun2fun) {
    if (requireKeys.has(edgeKey(from, to))) requireEdges.push([from, to]);
    else callEdges.push([from, to]);
  }
  return { callEdges, requireEdges };
}

function edgeKey(from, to) {
  return `${from}:${to}`;
}

function buildAdjacency(nodeCount, edges) {
  const forward = Array.from({ length: nodeCount }, () => []);
  const reverse = Array.from({ length: nodeCount }, () => []);
  for (const [from, to] of edges) {
    forward[from].push(to);
    reverse[to].push(from);
  }
  return { forward, reverse };
}

function buildNameIndex(nodes) {
  const index = new Map();
  for (const node of nodes) {
    const bucket = index.get(node.name) ?? [];
    bucket.push(node.id);
    index.set(node.name, bucket);
  }
  return index;
}

/** 取节点；id 越界返回 `undefined`。 */
export function getNode(graph, id) {
  return graph.nodes[id];
}

/** 节点的稳定描述（错误候选、json 输出共用）。 */
export function describeNode(graph, id) {
  const node = graph.nodes[id];
  return { id, name: node.name, file: node.file, line: node.line, isModule: node.isModule };
}

/** `name  file:line` 单行引用，供人类视图与错误信息用。 */
export function formatNodeRef(graph, id) {
  const node = graph.nodes[id];
  return `${node.name}  ${node.file}:${node.line}`;
}

/** 直接被调用者（call 边）。 */
export function calleesOf(graph, id) {
  return graph.callees[id] ?? [];
}

/** 直接调用者（call 边）。 */
export function callersOf(graph, id) {
  return graph.callers[id] ?? [];
}

/** 模块节点 `import` 来的函数（require 边，不含调用边）。 */
export function requireTargetsOf(graph, id) {
  return graph.requireTargets[id] ?? [];
}

/** 哪些模块节点 `import` 了该节点（require 边，不含调用边）。 */
export function requireSourcesOf(graph, id) {
  return graph.requireSources[id] ?? [];
}

/**
 * 解析选择器 → 节点 id 列表（升序）。
 *
 * 支持三种：
 *  - 函数名：精确匹配 `name`（如 `normalizeUnitKey`）；
 *  - `file:line`：`src/lib/inputs/units.ts:90`，行号落在函数范围内即命中；
 *  - glob：`src/lib/bindings/storage/**`，匹配 `file`（返回**全部**命中，不算歧义）。
 *
 * 函数名 / `file:line` 命中多个 → 抛 `ambiguous`；命中 0 个 → 抛 `not-found`。
 *
 * @param {object} graph       `loadFuncGraph()` 的返回值
 * @param {string} selector    选择器
 * @param {{ includeModules?: boolean }} [options] 默认排除 `moduleNodes`
 * @returns {number[]}
 */
export function resolveSelector(graph, selector, options = {}) {
  const query = normalizeQuery(selector);
  const allowModules = options.includeModules === true;
  const { kind, ids, moduleOnly } = matchSelector(graph, query, allowModules);
  if (ids.length === 0) throw notFoundError(query, moduleOnly);
  if (kind !== "glob" && ids.length > 1) throw ambiguousError(graph, query, ids);
  return [...ids].sort((left, right) => left - right);
}

function normalizeQuery(selector) {
  const query = typeof selector === "string" ? selector.trim() : "";
  if (query === "") {
    throw new SelectorError("invalid", query, [], "选择器为空");
  }
  return query;
}

function matchSelector(graph, query, allowModules) {
  const keep = (node) => allowModules || !node.isModule;
  if (hasGlobMagic(query)) {
    const pattern = globToRegExp(query);
    const ids = graph.nodes.filter((node) => keep(node) && pattern.test(node.file)).map(nodeId);
    return { kind: "glob", ids };
  }
  const fileLine = parseFileLine(query);
  if (fileLine) {
    const ids = graph.nodes
      .filter(
        (node) => keep(node) && node.file === fileLine.file && containsLine(node, fileLine.line),
      )
      .map(nodeId);
    return { kind: "file-line", ids };
  }
  const all = graph.nameIndex.get(query) ?? [];
  const ids = all.filter((id) => keep(graph.nodes[id]));
  return { kind: "name", ids, moduleOnly: all.length > 0 && ids.length === 0 };
}

function parseFileLine(query) {
  const match = /^(.*):(\d+)$/.exec(query);
  if (!match || match[1] === "") return null;
  return { file: match[1].replace(/^\.\//, ""), line: Number(match[2]) };
}

function containsLine(node, line) {
  return node.line <= line && line <= node.endLine;
}

function nodeId(node) {
  return node.id;
}

function notFoundError(query, moduleOnly) {
  const hint = moduleOnly ? "；它只命中模块节点，传 { includeModules: true } 可选中" : "";
  return new SelectorError("not-found", query, [], `选择器 "${query}" 没有命中任何函数${hint}`);
}

function ambiguousError(graph, query, ids) {
  const candidates = ids.map((id) => describeNode(graph, id));
  const listed = candidates.map(
    (item) => `${item.name} (${item.file}:${item.line}, id=${item.id})`,
  );
  return new SelectorError(
    "ambiguous",
    query,
    candidates,
    `选择器 "${query}" 有歧义，命中 ${ids.length} 个：${listed.join(" | ")}`,
  );
}

// ---------------------------------------------------------------------------
// S2b —— 遍历查询（traverse）
// ---------------------------------------------------------------------------

/** 允许的遍历方向。`impact` 命令 = `both`。 */
const DIRECTIONS = new Set(["callers", "callees", "both"]);

/**
 * 沿 **call 边** 从 `start` 做 BFS。
 *
 * 只走调用边，**require/import 边不参与影响面**（那是模块加载，不是「谁会受影响」）。
 *
 * @param {object} graph                       `loadFuncGraph()` 的返回值
 * @param {object} options
 * @param {number|number[]} options.start      起始节点 id（支持多个，如 glob 命中多个函数）
 * @param {'callers'|'callees'|'both'} [options.direction='callees']
 * @param {number} [options.depth=2]           最多向外走多少层（`0` = 只有起点）
 * @returns {{
 *   nodes: {{id: number, distance: number}}[],
 *   edges: {{from: number, to: number}}[],
 *   maxDepthReached: number,
 *   direction: string, depth: number, rootIds: number[],
 * }}
 *
 * `nodes` 按 `distance` 再按 `id` 升序；`edges` 是**遍历树边**，方向为「近 → 远」
 * （`from` 比 `to` 更靠近起点），便于直接还原树形。`callees` 方向下 `from` 是调用者；
 * `callers` 方向下 `from` 是被调用者。每个已到达节点只有一条入树边（BFS 首次发现），
 * 因此结果一定是树、不会因环而无限展开。
 */
export function traverse(graph, options = {}) {
  const direction = normalizeDirection(options.direction ?? "callees");
  const depth = normalizeDepth(options.depth ?? 2);
  const rootIds = normalizeStarts(graph, options.start);
  const { nodes, edges, maxDepthReached } = breadthFirst(graph, { rootIds, direction, depth });
  return { nodes, edges, maxDepthReached, direction, depth, rootIds };
}

/** BFS 主体（抽出来降低 `traverse` 的圈复杂度）。 */
function breadthFirst(graph, { rootIds, direction, depth }) {
  const distanceById = new Map(rootIds.map((id) => [id, 0]));
  const queue = [...rootIds];
  const edges = [];
  const edgeKeys = new Set();
  let maxDepthReached = 0;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const nextDistance = distanceById.get(current) + 1;
    if (nextDistance > depth) continue;
    for (const next of neighborsOf(graph, current, direction)) {
      if (distanceById.has(next)) continue;
      distanceById.set(next, nextDistance);
      queue.push(next);
      if (nextDistance > maxDepthReached) maxDepthReached = nextDistance;
      pushEdge(edges, edgeKeys, current, next);
    }
  }
  const nodes = [...distanceById.entries()]
    .map(([id, distance]) => ({ id, distance }))
    .sort((left, right) => left.distance - right.distance || left.id - right.id);
  edges.sort((left, right) => left.from - right.from || left.to - right.to);
  return { nodes, edges, maxDepthReached };
}

function pushEdge(edges, edgeKeys, from, to) {
  const key = `${from}:${to}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({ from, to });
}

function normalizeDirection(direction) {
  if (!DIRECTIONS.has(direction)) {
    throw new Error(`direction 必须是 callers/callees/both，收到 ${JSON.stringify(direction)}`);
  }
  return direction;
}

function normalizeDepth(depth) {
  const value = Number(depth);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`depth 必须是非负整数，收到 ${JSON.stringify(depth)}`);
  }
  return value;
}

function normalizeStarts(graph, start) {
  const raw = Array.isArray(start) ? start : [start];
  const ids = new Set();
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 0 || id >= graph.nodes.length) {
      throw new Error(`traverse 收到越界节点 id：${JSON.stringify(value)}`);
    }
    ids.add(id);
  }
  if (ids.size === 0) throw new Error("traverse 需要至少一个 start 节点 id");
  return [...ids].sort((left, right) => left - right);
}

/** 某节点在给定方向上的邻居（只含 call 边），升序去重，保证 BFS 稳定。 */
function neighborsOf(graph, id, direction) {
  if (direction === "callers") return sortedUnique(graph.callers[id] ?? []);
  if (direction === "callees") return sortedUnique(graph.callees[id] ?? []);
  return sortedUnique([...(graph.callers[id] ?? []), ...(graph.callees[id] ?? [])]);
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

/** `parent` 是否直接调用 `child`（用于人类视图里的调用方向箭头）。 */
function isCallEdge(graph, parent, child) {
  return (graph.callees[parent] ?? []).includes(child);
}

// ---------------------------------------------------------------------------
// S2b —— 人类视图（renderTree）
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CHILDREN = 20;

/** 人类视图里最多列出的未解析边界条数（其余折叠成一行）。 */
const DEFAULT_MAX_BOUNDARIES = 10;

/** 无分类信息时的显示标签（降级路径）。 */
const DEFAULT_KIND_LABELS = { unresolved: "未解析" };

/** C2 = 本仓库真漏，是唯一「本该连上却没连上」的类别，用更强的 `‼` 标记。 */
const REAL_MISS_KIND = "C2";

const DIRECTION_LABELS = {
  callers: "callers 反向可达",
  callees: "callees 正向可达",
  both: "impact 双向可达",
};

/**
 * 把 `traverse()` 的结果渲染成缩进树。
 *
 * 每行形如 `<name>  <file>:<line>`；非根节点再附一条「从哪来」的调用关系：
 * `← parent` 表示 parent 调用了本节点，`→ parent` 表示本节点调用了 parent。
 * 最后一行是汇总（未解析边界留给 S2c）。
 *
 * @param {object} graph
 * @param {ReturnType<typeof traverse>} result
 * @param {{ rootId?: number|number[], maxChildren?: number, boundaries?: object[], maxBoundaries?: number }} [options]
 * @returns {string}
 */
export function renderTree(graph, result, options = {}) {
  const rootIds = renderRoots(graph, result, options.rootId);
  const childrenOf = buildChildrenMap(result);
  const maxChildren = Number.isInteger(options.maxChildren)
    ? Math.max(0, options.maxChildren)
    : DEFAULT_MAX_CHILDREN;
  const boundaries = Array.isArray(options.boundaries) ? options.boundaries : [];
  const lines = [];
  lines.push(renderTargetLine(graph, rootIds));
  const directionLabel = DIRECTION_LABELS[result.direction] ?? result.direction;
  lines.push(`影响面（${directionLabel}，深度 ${result.depth}）：`);
  for (let index = 0; index < rootIds.length; index += 1) {
    pushSubtree({
      graph,
      childrenOf,
      id: rootIds[index],
      parentId: null,
      prefix: "",
      isLast: index === rootIds.length - 1,
      lines,
      maxChildren,
      direction: result.direction,
    });
  }
  const summary = summarizeResult(graph, result, boundaries);
  lines.push(...boundaryLines(boundaries, options.maxBoundaries));
  lines.push(summaryLine(summary));
  const warning = confidenceWarning(summary);
  if (warning) lines.push(warning);
  return lines.join("\n");
}

/** 人类视图的 ⚠/‼ 边界行 + 一行按类别汇总（§4.4 / S3c）；超过 `maxBoundaries` 条则折叠。 */
function boundaryLines(boundaries, maxBoundaries) {
  if (boundaries.length === 0) return [];
  const cap = Number.isInteger(maxBoundaries) ? Math.max(0, maxBoundaries) : DEFAULT_MAX_BOUNDARIES;
  const ordered = [...boundaries].sort(realMissFirst);
  const shown = ordered.slice(0, cap);
  const lines = [boundaryKindSummary(boundaries), ...shown.map(boundaryLine)];
  if (boundaries.length > shown.length) {
    lines.push(
      `  … 其余 ${boundaries.length - shown.length} 条边界省略（共 ${boundaries.length} 条）`,
    );
  }
  return lines;
}

/** 渲染顺序：C2（真漏）提前到最前，保证强标记不会被折叠吃掉；稳定排序保留原顺序。 */
function realMissFirst(left, right) {
  return (left.kind === REAL_MISS_KIND ? 0 : 1) - (right.kind === REAL_MISS_KIND ? 0 : 1);
}

/** 单条边界：未分类保持旧格式（兼容基线），已分类带 `[类别 标签]`，C2 用 `‼`。 */
function boundaryLine(boundary) {
  const location = `${boundary.file}:${boundary.line}`;
  if (boundary.kind === "unresolved") {
    return `⚠ 边界：${location} 的 ${boundary.text} 未解析`;
  }
  const label = boundary.kindLabel ?? DEFAULT_KIND_LABELS[boundary.kind] ?? boundary.kind;
  const marker = boundary.kind === REAL_MISS_KIND ? "‼" : "⚠";
  return `${marker} [${boundary.kind} ${label}] ${location} 的 ${boundary.text} 未解析`;
}

/** `边界按类别：C1×3, A×9, …`；C2 永远排最前，其余按计数降序、同数按类别名升序。 */
function boundaryKindSummary(boundaries) {
  const entries = Object.entries(countByKind(boundaries)).sort(compareKindCounts);
  return `边界按类别：${entries.map(([kind, count]) => `${kind}×${count}`).join(", ")}`;
}

/** 按 `kind` 计数（边界 / summary 共用）。 */
function countByKind(boundaries) {
  const counts = {};
  for (const boundary of boundaries) {
    counts[boundary.kind] = (counts[boundary.kind] ?? 0) + 1;
  }
  return counts;
}

function compareKindCounts([leftKind, leftCount], [rightKind, rightCount]) {
  if (leftKind === REAL_MISS_KIND || rightKind === REAL_MISS_KIND) {
    if (leftKind !== rightKind) return leftKind === REAL_MISS_KIND ? -1 : 1;
  }
  if (leftCount !== rightCount) return rightCount - leftCount;
  return leftKind.localeCompare(rightKind);
}

/** §4.4：边界数 ≥ 可达函数数时，影响面可能不可信。 */
function confidenceWarning(summary) {
  if (summary.boundaries === 0 || summary.boundaries < summary.functions) return null;
  return `影响面可能不可信：可达函数 ${summary.functions} 个，但边界调用点有 ${summary.boundaries} 个`;
}

function renderRoots(graph, result, rootId) {
  const source = rootId ?? result.rootIds;
  const raw = Array.isArray(source) ? source : [source];
  const ids = raw
    .map(Number)
    .filter((id) => Number.isInteger(id) && id >= 0 && id < graph.nodes.length);
  if (ids.length === 0) throw new Error("renderTree 需要至少一个有效 rootId");
  return ids;
}

function renderTargetLine(graph, rootIds) {
  if (rootIds.length === 1) return `目标  ${formatNodeRef(graph, rootIds[0])}`;
  const preview = rootIds
    .slice(0, 3)
    .map((id) => graph.nodes[id].name)
    .join(", ");
  const suffix = rootIds.length > 3 ? " …" : "";
  return `目标  ${rootIds.length} 个函数（${preview}${suffix}）`;
}

function buildChildrenMap(result) {
  const children = new Map();
  for (const edge of result.edges) {
    const list = children.get(edge.from) ?? [];
    list.push(edge.to);
    children.set(edge.from, list);
  }
  for (const list of children.values()) list.sort((left, right) => left - right);
  return children;
}

function pushSubtree(context) {
  const { graph, childrenOf, id, parentId, prefix, isLast, lines, maxChildren, direction } =
    context;
  lines.push(`${prefix}${isLast ? "└─ " : "├─ "}${nodeLine(graph, id, parentId, direction)}`);
  const children = childrenOf.get(id) ?? [];
  const visible = children.slice(0, maxChildren);
  const truncated = children.length > visible.length;
  const childPrefix = prefix + (isLast ? "   " : "│  ");
  for (let index = 0; index < visible.length; index += 1) {
    pushSubtree({
      ...context,
      id: visible[index],
      parentId: id,
      prefix: childPrefix,
      isLast: !truncated && index === visible.length - 1,
    });
  }
  if (truncated) {
    lines.push(
      `${childPrefix}└─ … 其余 ${children.length - visible.length} 个省略（共 ${children.length} 个）`,
    );
  }
}

function nodeLine(graph, id, parentId, direction) {
  const node = graph.nodes[id];
  const base = `${node.name}  ${node.file}:${node.line}`;
  if (parentId === null) return base;
  const parent = graph.nodes[parentId];
  const arrow = arrowFor(graph, parentId, id, direction);
  return `${base}  ${arrow} ${parent.name}  ${parent.file}:${parent.line}`;
}

/**
 * 非根节点与树父节点的调用关系：
 * `←` = 父节点调用了本节点（本节点是 callee）；`→` = 本节点调用了父节点（本节点是 caller）。
 * `both` 方向下没有统一的遍历语义，按实际 call 边判定（互相调用时取 `←`）。
 */
function arrowFor(graph, parentId, childId, direction) {
  if (direction === "callees") return "←";
  if (direction === "callers") return "→";
  return isCallEdge(graph, parentId, childId) ? "←" : "→";
}

function summaryLine(summary) {
  return `汇总：受影响函数 ${summary.functions} 个 / 涉及 ${summary.modules} 个模块 / ${summary.directories} 个目录；未解析边界 ${summary.boundaries} 处`;
}

// ---------------------------------------------------------------------------
// S2c —— 未解析边界（func-calls.json 位置归属）
// ---------------------------------------------------------------------------

/** 调用点来源（在需要边界时才读）。 */
export function loadCallData(jsonPath = FUNC_CALLS_PATH) {
  return JSON.parse(readFileSync(jsonPath, "utf8"));
}

/**
 * 分类基线缺失/不可用时的空数据：legend 为空、无任何 callId。
 * 消费方据此把每个边界退化成 `kind: "unresolved"`（S3c 降级路径）。
 */
export function emptyBoundaryData() {
  return { legend: {}, kinds: new Map() };
}

/**
 * 读 S3b 的 `rules/out/func-boundaries.json`（`{ legend, kinds: [[callId, kind, symbol|null]] }`）。
 *
 * **优雅降级是硬要求**（S3c）：文件不存在 / JSON 解析失败 / 结构不符时，只向 `stderr`
 * 提示一条，返回 `emptyBoundaryData()`，调用方继续按 `kind: "unresolved"` 输出，不报错、
 * 不中断。`symbol` 为 `null` 时不写入边界对象。
 *
 * @returns {{ legend: Record<string, string>, kinds: Map<number, {kind: string, symbol: string|null}> }}
 */
export function loadBoundaryData(jsonPath = FUNC_BOUNDARIES_PATH) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (error) {
    return degradeBoundaryData(jsonPath, error);
  }
  const legend = normalizeBoundaryLegend(parsed.legend);
  const kinds = normalizeBoundaryKinds(parsed.kinds);
  if (!legend || !kinds) return degradeBoundaryData(jsonPath, missingShapeError());
  return { legend, kinds };
}

/** 降级：一条 stderr 提示 + 空分类（不抛）。 */
function degradeBoundaryData(jsonPath, error) {
  process.stderr.write(
    `[graph-func-query] 无法加载分类基线 ${jsonPath}（${error?.message ?? error}），` +
      `未解析边界将统一为 kind="unresolved"\n`,
  );
  return emptyBoundaryData();
}

function missingShapeError() {
  return new Error("结构不符：需要 { legend: object, kinds: [[callId, kind, symbol?]] }");
}

/** `legend` 归一化：非对象 / 数组 → `null`（触发降级）；只保留字符串标签。 */
function normalizeBoundaryLegend(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const legend = {};
  for (const [kind, label] of Object.entries(value)) {
    if (typeof label === "string") legend[kind] = label;
  }
  return legend;
}

/** `kinds` 归一化：非数组 → `null`（触发降级）；跳过畸形条目（部分覆盖也照常工作）。 */
function normalizeBoundaryKinds(value) {
  if (!Array.isArray(value)) return null;
  const kinds = new Map();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const id = Number(entry[0]);
    if (!Number.isInteger(id) || typeof entry[1] !== "string") continue;
    kinds.set(id, { kind: entry[1], symbol: typeof entry[2] === "string" ? entry[2] : null });
  }
  return kinds;
}

/**
 * 把 `func-calls.json` 归一化成按 id 索引的调用点，并算出：
 *
 *  - 每个调用点的**所属函数**（位置包含 → 最内层；模块顶层 → 模块节点）；
 *  - 已解析调用点 → 被调函数的映射（`call2fun`），按 `caller>callee` 归并（取最小 callId）；
 *  - 未解析调用点 id 列表（`calls` 的 key 减去 `call2fun` 里出现过的 key）。
 *
 * 纯函数（只依赖传入的 graph / callData），便于合成数据单测。
 *
 * @returns {{
 *   points: Map<number, {id:number,file:string,line:number,col:number,endLine:number,endCol:number,fileIndex:number,ownerId:number|null,calleeId:number|null}>,
 *   resolvedByPair: Map<string, number>,
 *   unresolvedIds: number[],
 * }}
 */
export function buildCallIndex(graph, callData) {
  const points = buildCallPoints(graph, callData);
  const resolvedByPair = buildResolvedByPair(points, callData.call2fun ?? []);
  const unresolvedIds = [...points.values()]
    .filter((point) => point.calleeId === null)
    .map((point) => point.id)
    .sort((left, right) => left - right);
  return { points, resolvedByPair, unresolvedIds };
}

/** 逐个调用点建索引，并按位置算出所属节点。 */
function buildCallPoints(graph, callData) {
  const nodesByFile = indexNodesByFile(graph);
  const moduleIdByPath = moduleIdByPathMap(graph);
  const points = new Map();
  for (const [key, location] of Object.entries(callData.calls ?? {})) {
    const id = Number(key);
    const loc = parseLocation(location);
    const file = callData.files?.[loc.fileIndex] ?? graph.files[loc.fileIndex] ?? null;
    points.set(id, {
      id,
      file,
      line: loc.startLine,
      col: loc.startCol,
      endLine: loc.endLine,
      endCol: loc.endCol,
      fileIndex: loc.fileIndex,
      ownerId: ownerOfPosition(graph, nodesByFile, moduleIdByPath, file, loc.startLine),
      calleeId: null,
    });
  }
  return points;
}

function moduleIdByPathMap(graph) {
  const byPath = new Map();
  for (const node of graph.nodes) {
    if (node.isModule) byPath.set(node.file, node.id);
  }
  return byPath;
}

/** 把 `call2fun` 反向归并成 `caller>callee` → 最小 callId。 */
function buildResolvedByPair(points, call2fun) {
  const resolvedByPair = new Map();
  for (const [rawCallId, calleeId] of call2fun) {
    const callId = Number(rawCallId);
    const point = points.get(callId);
    if (!point) continue;
    point.calleeId = calleeId;
    if (point.ownerId === null) continue;
    const pairKey = edgePairKey(point.ownerId, calleeId);
    const existing = resolvedByPair.get(pairKey);
    if (existing === undefined || callId < existing) resolvedByPair.set(pairKey, callId);
  }
  return resolvedByPair;
}

function edgePairKey(callerId, calleeId) {
  return `${callerId}>${calleeId}`;
}

function indexNodesByFile(graph) {
  const byFile = new Map();
  for (const node of graph.nodes) {
    const list = byFile.get(node.file) ?? [];
    list.push(node);
    byFile.set(node.file, list);
  }
  return byFile;
}

/** 调用点归属：最内层包含它的函数；都不包含（模块顶层）→ 该文件的模块节点。 */
function ownerOfPosition(graph, nodesByFile, moduleIdByPath, file, line) {
  const candidates = (nodesByFile.get(file) ?? []).filter(
    (node) => !node.isModule && node.line <= line && line <= node.endLine,
  );
  if (candidates.length > 0) {
    candidates.sort(innermostFirst);
    return candidates[0].id;
  }
  return moduleIdByPath.get(file) ?? null;
}

/** 越靠内层越前：结束行早 > 开始行晚 > 开始列晚 > id 小。 */
function innermostFirst(left, right) {
  if (left.endLine !== right.endLine) return left.endLine - right.endLine;
  if (left.line !== right.line) return right.line - left.line;
  if (left.col !== right.col) return right.col - left.col;
  return left.id - right.id;
}

/**
 * 结果集合内的未解析边界（§4.4 / S3c）。
 *
 * 只报告 `result.nodes` 里节点的调用点；`text` 从源码读该行并 `trim()`。
 * 传了 `options.boundaryData`（`loadBoundaryData()` 的产物）时，命中分类的 callId 变成
 * `{ kind, kindLabel, file, line, text, symbol? }`；未命中（分类文件缺失 / 部分覆盖）退回
 * `{ kind: "unresolved", file, line, text }`。
 *
 * @param {object} options
 * @param {(file: string, line: number) => string} [options.readLine] 自定义读行（单测用）
 * @param {string} [options.sourceRoot]                           源码根目录，默认仓库根
 * @param {{legend: Record<string,string>, kinds: Map<number,{kind:string,symbol:string|null}>}} [options.boundaryData]
 *        S3b 分类基线；缺省 = 全部 `unresolved`
 */
export function collectBoundaries(graph, result, callIndex, options = {}) {
  const readLine = options.readLine ?? makeReadLine(options.sourceRoot);
  const boundaryData = options.boundaryData ?? null;
  const resultIds = new Set(result.nodes.map((item) => item.id));
  const boundaries = [];
  for (const id of callIndex.unresolvedIds) {
    const point = callIndex.points.get(id);
    if (!point || point.ownerId === null || !resultIds.has(point.ownerId)) continue;
    boundaries.push(makeBoundary(point, readLine, boundaryData));
  }
  boundaries.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return boundaries;
}

/** 单个边界对象：有分类就带 `kindLabel` /（有值时）`symbol`，否则退回 `unresolved`。 */
function makeBoundary(point, readLine, boundaryData) {
  const text = readLine(point.file, point.line);
  const classification = boundaryData?.kinds?.get(point.id);
  if (!classification) return { kind: "unresolved", file: point.file, line: point.line, text };
  const boundary = {
    kind: classification.kind,
    kindLabel: boundaryData.legend?.[classification.kind] ?? classification.kind,
    file: point.file,
    line: point.line,
    text,
  };
  if (classification.symbol) boundary.symbol = classification.symbol;
  return boundary;
}

const SOURCE_CACHE = new Map();

/** 读源码行并 `trim()`；文件缺失返回空串（不中断查询）。 */
function makeReadLine(sourceRoot) {
  const root = sourceRoot ?? REPO_ROOT;
  return (file, line) => {
    if (!file) return "";
    const abs = join(root, file);
    const lines = loadSourceLines(abs);
    return (lines[line - 1] ?? "").trim();
  };
}

/** 读文件并按行切分；读取失败（文件缺失/不可读）降级为空数组。 */
function loadSourceLines(abs) {
  const cached = SOURCE_CACHE.get(abs);
  if (cached) return cached;
  const lines = readSourceLines(abs);
  SOURCE_CACHE.set(abs, lines);
  return lines;
}

/** 读取失败（文件缺失/不可读）降级为空数组，不中断查询。 */
function readSourceLines(abs) {
  try {
    return readFileSync(abs, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// S2c —— JSON 输出契约（§4.3）
// ---------------------------------------------------------------------------

/**
 * 汇总（§4.3 `summary`）：`functions` 只数函数节点（模块节点不计）。
 * `modules` = 去重文件数，`directories` = 去重目录数。
 *
 * 边界带真实类别（S3c）时额外加 `boundariesByKind`；全为 `unresolved`（分类基线缺失 /
 * 全部未命中）时不加，以保持降级输出与旧契约一致。
 */
export function summarizeResult(graph, result, boundaries = []) {
  const files = new Set();
  const directories = new Set();
  let functions = 0;
  for (const item of result.nodes) {
    const node = graph.nodes[item.id];
    if (!node.isModule) functions += 1;
    files.add(node.file);
    directories.add(dirname(node.file));
  }
  const summary = {
    functions,
    modules: files.size,
    directories: directories.size,
    boundaries: boundaries.length,
    maxDepthReached: result.maxDepthReached,
  };
  if (boundaries.some((boundary) => boundary.kind !== "unresolved")) {
    summary.boundariesByKind = countByKind(boundaries);
  }
  return summary;
}

/**
 * 把遍历结果序列化成 §4.3 的 JSON 契约。
 *
 * - `target`：单个起点是对象，多个起点（glob）是数组；
 * - `edges[].viaCall`：该遍历树边对应的调用点 id（`calls` 的 key），查不到则**省略该字段**；
 * - `boundaries`：见 `collectBoundaries()`，字段照契约。
 *
 * @param {object} options
 * @param {number[]} [options.targetIds] 目标 id（默认 `result.rootIds`；glob 时会多于一个）
 * @param {object[]} [options.boundaries]
 * @param {object}   [options.callIndex]  有则补 `viaCall`
 */
export function buildResultJson(graph, result, options = {}) {
  const targetIds = options.targetIds ?? result.rootIds;
  const boundaries = options.boundaries ?? [];
  return {
    target: buildTarget(graph, targetIds),
    direction: result.direction,
    depth: result.depth,
    nodes: result.nodes.map((item) => {
      const node = graph.nodes[item.id];
      return {
        id: item.id,
        file: node.file,
        line: node.line,
        name: node.name,
        distance: item.distance,
      };
    }),
    edges: result.edges.map((edge) => buildEdge(graph, edge, options.callIndex)),
    boundaries,
    summary: summarizeResult(graph, result, boundaries),
  };
}

function buildTarget(graph, targetIds) {
  const targets = targetIds.map((id) => {
    const node = graph.nodes[id];
    return { id, file: node.file, line: node.line, name: node.name };
  });
  return targets.length === 1 ? targets[0] : targets;
}

function buildEdge(graph, edge, callIndex) {
  if (!callIndex) return { from: edge.from, to: edge.to };
  const viaCall = viaCallFor(graph, callIndex, edge);
  if (viaCall === undefined) return { from: edge.from, to: edge.to };
  return { from: edge.from, to: edge.to, viaCall };
}

/** 遍历树边 → 调用点：先判方向（谁调谁），再查 `caller>callee`。 */
function viaCallFor(graph, callIndex, edge) {
  const { from, to } = edge;
  let caller;
  let callee;
  if (isCallEdge(graph, from, to)) {
    caller = from;
    callee = to;
  } else if (isCallEdge(graph, to, from)) {
    caller = to;
    callee = from;
  } else {
    return undefined;
  }
  return callIndex.resolvedByPair.get(edgePairKey(caller, callee));
}

// ---------------------------------------------------------------------------
// S2c —— CLI（`callers` / `callees` / `impact`）
// ---------------------------------------------------------------------------

/** CLI 子命令 → 遍历方向。`path` 属于后续任务，本文件不实现。 */
const CLI_COMMANDS = { callers: "callers", callees: "callees", impact: "both" };

const CLI_USAGE = [
  "用法：bun rules/graph-func-query.mjs <callers|callees|impact> <选择器> [--depth N] [--json]",
  "  选择器：函数名  |  <file>:<line>  |  glob（如 src/lib/bindings/storage/**）",
  "  --depth N   BFS 层数，默认 2（0 表示只看目标自身）",
  "  --json      输出 §4.3 契约的 JSON（含未解析边界）",
].join("\n");

function parseCliArgs(args) {
  const selectors = [];
  let depth = 2;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--depth") {
      index += 1;
      if (index >= args.length) throw new Error("--depth 缺少值");
      depth = Number(args[index]);
    } else if (arg.startsWith("--depth=")) {
      depth = Number(arg.slice("--depth=".length));
    } else if (arg === "--json") {
      json = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`未知选项 ${arg}`);
    } else {
      selectors.push(arg);
    }
  }
  if (selectors.length === 0) throw new Error("缺少选择器");
  return { selectors, depth, json };
}

function printSelectorError(error) {
  process.stderr.write(`选择器错误（${error.code}）：${error.message}\n`);
  for (const candidate of error.candidates ?? []) {
    const location = `${candidate.file}:${candidate.line}`;
    process.stderr.write(`  - ${candidate.name}  (${location}, id=${candidate.id})\n`);
  }
}

function runCli(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${CLI_USAGE}\n`);
    return 0;
  }
  const direction = CLI_COMMANDS[command];
  if (!direction) {
    process.stderr.write(`未知子命令 "${command}"（期望 callers/callees/impact）\n${CLI_USAGE}\n`);
    return 2;
  }
  const parsed = parseCliArgsSafe(rest);
  if (!parsed) return 2;
  const graph = loadFuncGraph();
  const roots = resolveRootsSafe(graph, parsed.selectors);
  if (!roots) return 1;
  const result = traverse(graph, { start: roots, direction, depth: parsed.depth });
  const callIndex = buildCallIndex(graph, loadCallData());
  const boundaries = collectBoundaries(graph, result, callIndex, {
    boundaryData: loadBoundaryData(),
  });
  if (parsed.json) {
    const payload = buildResultJson(graph, result, { targetIds: roots, boundaries, callIndex });
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderTree(graph, result, { rootId: roots, boundaries })}\n`);
  }
  return 0;
}

function parseCliArgsSafe(args) {
  try {
    return parseCliArgs(args);
  } catch (error) {
    process.stderr.write(`${error.message}\n${CLI_USAGE}\n`);
    return null;
  }
}

/** 解析全部选择器；命中 `SelectorError` 时报错并列候选，返回 `null`。 */
function resolveRootsSafe(graph, selectors) {
  const roots = [];
  for (const selector of selectors) {
    try {
      roots.push(...resolveSelector(graph, selector));
    } catch (error) {
      if (error instanceof SelectorError) {
        printSelectorError(error);
        return null;
      }
      throw error;
    }
  }
  return roots;
}

/** 直接被执行（而非被 import）时才跑 CLI。 */
function isDirectInvocation() {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  const entry = process.argv[1];
  return Boolean(entry) && resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation()) {
  process.exit(runCli(process.argv.slice(2)));
}
