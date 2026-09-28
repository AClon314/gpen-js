import { describe, expect, test } from "bun:test";

import {
  SelectorError,
  buildCallIndex,
  buildGraph,
  buildResultJson,
  calleesOf,
  callersOf,
  collectBoundaries,
  describeNode,
  globMatches,
  globToRegExp,
  loadCallData,
  loadFuncGraph,
  renderTree,
  requireSourcesOf,
  requireTargetsOf,
  resolveSelector,
  summarizeResult,
  traverse,
} from "../rules/graph-func-query.mjs";

const graph = loadFuncGraph();

/** 跑一个应当抛错的选择器，返回抛出的错误。 */
function selectorError(run: () => unknown): SelectorError {
  try {
    run();
  } catch (error) {
    return error as SelectorError;
  }
  throw new Error("预期抛错，但没有");
}

/** 在图中找一个重名函数名（用作歧义样本）。 */
function duplicateName(): string {
  const seen = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.isModule) continue;
    const count = (seen.get(node.name) ?? 0) + 1;
    if (count > 1 && node.name !== "<anon>") return node.name;
    seen.set(node.name, count);
  }
  throw new Error("基线里找不到重名函数");
}

describe("loadFuncGraph —— 基线归一化", () => {
  test("节点/边规模与 func.json 基线一致", () => {
    expect(graph.nodes.length).toBe(1884);
    expect(graph.moduleNodeIds.length).toBe(162);
    expect(graph.files.length).toBe(162);
    expect(graph.json.fun2fun.length).toBe(2562);
    expect(graph.callEdges.length).toBe(2248);
    expect(graph.requireEdges.length).toBe(314);
    expect(graph.callEdges.length + graph.requireEdges.length).toBe(graph.json.fun2fun.length);
  });

  test("每个节点带齐位置/模块/入口信息，moduleId 指向本文件的模块节点", () => {
    const node = graph.nodes.find((item) => item.name === "normalizeUnitKey")!;
    expect(node).toMatchObject({
      id: 1288,
      file: "src/lib/inputs/units.ts",
      line: 90,
      col: 8,
      endLine: 92,
      endCol: 2,
      isModule: false,
      modulePath: "src/lib/inputs/units.ts",
    });
    const moduleNode = graph.nodes[node.moduleId!];
    expect(moduleNode.isModule).toBe(true);
    expect(moduleNode.file).toBe(node.file);
    expect(graph.nodes[1827]).toMatchObject({ name: "src/lib/inputs/units.ts", isModule: true });
  });

  test("调用边与 require 边互不重叠", () => {
    const requireKeys = new Set(graph.requireEdges.map(([from, to]) => `${from}:${to}`));
    for (const [from, to] of graph.callEdges) {
      expect(requireKeys.has(`${from}:${to}`)).toBe(false);
    }
  });

  test("正/反邻接互为镜像（call 边）", () => {
    for (const [from, to] of graph.callEdges) {
      expect(graph.callees[from]).toContain(to);
      expect(graph.callers[to]).toContain(from);
    }
    const forwardEdges = graph.callees.flatMap((targets, from) => targets.map((to) => [from, to]));
    expect(forwardEdges.length).toBe(graph.callEdges.length);
    const reverseEdges = graph.callers.flatMap((sources, to) => sources.map((from) => [from, to]));
    expect(reverseEdges.length).toBe(graph.callEdges.length);
  });

  test("require 边只进 require 邻接，不进 call 邻接", () => {
    const [moduleId, targetId] = graph.requireEdges[0];
    expect(graph.moduleNodeIds).toContain(moduleId);
    expect(calleesOf(graph, moduleId)).not.toContain(targetId);
    expect(requireTargetsOf(graph, moduleId)).toContain(targetId);
    expect(requireSourcesOf(graph, targetId)).toContain(moduleId);
  });
});

describe("resolveSelector —— 函数名", () => {
  test("精确命中唯一函数名", () => {
    expect(resolveSelector(graph, "normalizeUnitKey")).toEqual([1288]);
  });

  test("重名抛歧义并列候选", () => {
    const name = duplicateName();
    const error = selectorError(() => resolveSelector(graph, name));
    expect(error).toBeInstanceOf(SelectorError);
    expect(error.code).toBe("ambiguous");
    expect(error.candidates.length).toBeGreaterThan(1);
    expect(error.candidates.every((item) => item.name === name)).toBe(true);
    expect(error.message).toContain("有歧义");
  });

  test("`commit` 这个重名有 4 个候选（基线事实）", () => {
    const error = selectorError(() => resolveSelector(graph, "commit"));
    expect(error.code).toBe("ambiguous");
    expect(error.candidates.map((item) => item.id).sort((a, b) => a - b)).toEqual([
      19, 128, 711, 932,
    ]);
  });

  test("无匹配抛 not-found", () => {
    const error = selectorError(() => resolveSelector(graph, "definitelyNotAFunction_xyz"));
    expect(error.code).toBe("not-found");
    expect(error.candidates).toEqual([]);
  });
});

describe("resolveSelector —— file:line", () => {
  test("行号落在函数范围内即命中（含范围内非首行）", () => {
    expect(resolveSelector(graph, "src/lib/inputs/units.ts:90")).toEqual([1288]);
    expect(resolveSelector(graph, "src/lib/inputs/units.ts:91")).toEqual([1288]);
    expect(resolveSelector(graph, "src/lib/inputs/units.ts:81")).toEqual([1287]);
    expect(resolveSelector(graph, "src/lib/inputs/units.ts:83")).toEqual([1287]);
  });

  test("嵌套函数共用行号时抛歧义并列候选", () => {
    const error = selectorError(() =>
      resolveSelector(graph, "src/lib/bindings/storage/objects/blob.ts:201"),
    );
    expect(error.code).toBe("ambiguous");
    expect(error.candidates.map((item) => item.name)).toEqual([
      "createDeletePath",
      "get",
      "<anon>",
      "<anon>",
    ]);
  });

  test("范围外行号抛 not-found", () => {
    const error = selectorError(() => resolveSelector(graph, "src/lib/inputs/units.ts:99999"));
    expect(error.code).toBe("not-found");
  });
});

describe("resolveSelector —— glob", () => {
  test("glob 返回所有命中函数，且默认不含模块节点", () => {
    const ids = resolveSelector(graph, "src/lib/bindings/storage/**");
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const node = graph.nodes[id];
      expect(node.isModule).toBe(false);
      expect(node.file.startsWith("src/lib/bindings/storage/")).toBe(true);
    }
  });

  test("glob 无匹配抛 not-found", () => {
    const error = selectorError(() => resolveSelector(graph, "src/lib/no-such-dir/**"));
    expect(error.code).toBe("not-found");
  });

  test("glob 语义：`*` 不跨目录，`**` 跨目录", () => {
    expect(globMatches("src/*/index.ts", "src/lib/index.ts")).toBe(true);
    expect(globMatches("src/*/index.ts", "src/lib/bindings/index.ts")).toBe(false);
    expect(globMatches("src/**/index.ts", "src/lib/bindings/index.ts")).toBe(true);
    expect(globMatches("src/lib/**", "src/lib/index.ts")).toBe(true);
    expect(globMatches("src/lib/**", "src/lib/index.ts")).toBe(true);
    expect(globMatches("src/lib/**", "src/index.ts")).toBe(false);
    expect(globToRegExp("src/lib/**").test("src/lib/bindings/storage/index.ts")).toBe(true);
    expect(globMatches("a[0].ts", "a[0].ts")).toBe(true);
    expect(globMatches("src/lib/?.ts", "src/lib/a.ts")).toBe(true);
  });
});

describe("resolveSelector —— 模块节点开关", () => {
  test("模块节点默认不被选中", () => {
    const error = selectorError(() => resolveSelector(graph, "src/lib/inputs/units.ts"));
    expect(error.code).toBe("not-found");
    expect(error.message).toContain("includeModules");
  });

  test("includeModules 后可选中模块节点", () => {
    expect(resolveSelector(graph, "src/lib/inputs/units.ts", { includeModules: true })).toEqual([
      1827,
    ]);
  });

  test("file:line 在模块默认排除时不会被整文件容器污染", () => {
    expect(resolveSelector(graph, "src/lib/inputs/units.ts:90")).toEqual([1288]);
    const error = selectorError(() =>
      resolveSelector(graph, "src/lib/inputs/units.ts:90", { includeModules: true }),
    );
    expect(error.code).toBe("ambiguous");
    expect(error.candidates.map((item) => item.isModule)).toEqual([false, true]);
  });
});

describe("邻接查询 —— 已知调用关系", () => {
  test("normalizeUnitKey(units.ts:90) 调用 normalizeText(units.ts:81)", () => {
    const target = resolveSelector(graph, "src/lib/inputs/units.ts:90");
    expect(target).toEqual([1288]);
    const calleeIds = calleesOf(graph, 1288);
    expect(calleeIds).toEqual([1287]);
    expect(graph.nodes[1287]).toMatchObject({
      name: "normalizeText",
      file: "src/lib/inputs/units.ts",
      line: 81,
    });
    expect(callersOf(graph, 1287)).toContain(1288);
    expect(describeNode(graph, 1287)).toEqual({
      id: 1287,
      name: "normalizeText",
      file: "src/lib/inputs/units.ts",
      line: 81,
      isModule: false,
    });
  });
});

describe("buildGraph —— 合成小图（不依赖基线）", () => {
  const synthetic = buildGraph({
    entries: ["a.ts"],
    ignoreDependencies: false,
    files: ["a.ts", "b/c.ts"],
    functions: {
      "0": "0:1:1:5:1",
      "1": "1:1:1:9:1",
      "2": "1:3:1:4:1",
      "3": "1:6:1:8:1",
    },
    functionNames: ["a.ts", "b/c.ts", "cb", "other"],
    moduleNodes: [0, 1],
    fun2fun: [
      [1, 2],
      [1, 3],
    ],
    requireEdges: [[1, 3]],
    ignore: [],
  });

  test("拆边、邻接与选择器在合成图上成立", () => {
    expect(synthetic.moduleNodeIds).toEqual([0, 1]);
    expect(synthetic.callEdges).toEqual([[1, 2]]);
    expect(synthetic.requireEdges).toEqual([[1, 3]]);
    expect(resolveSelector(synthetic, "cb")).toEqual([2]);
    expect(resolveSelector(synthetic, "b/c.ts:3")).toEqual([2]);
    expect(resolveSelector(synthetic, "b/**")).toEqual([2, 3]);
    expect(requireTargetsOf(synthetic, 1)).toEqual([3]);
    expect(calleesOf(synthetic, 1)).toEqual([2]);
    expect(selectorError(() => resolveSelector(synthetic, "b/c.ts")).code).toBe("not-found");
    expect(resolveSelector(synthetic, "b/c.ts", { includeModules: true })).toEqual([1]);
    expect(synthetic.nodes[0].isEntry).toBe(true);
    expect(synthetic.nodes[1].isEntry).toBe(false);
  });
});

/**
 * 遍历/渲染用的合成小图（不依赖基线）：
 *
 * ```
 * main(3) -> helper(4) -> deep(5)
 * helper(4) --require--> main(3)   （require 边，不应被 traverse 走）
 * recur(6) <-> other(7)            （互相调用，且有自环 6->6）
 * ```
 */
const flow = buildGraph({
  entries: ["a.ts"],
  ignoreDependencies: false,
  files: ["a.ts", "b.ts", "c.ts"],
  functions: {
    "0": "0:1:1:3:1",
    "1": "1:1:1:3:1",
    "2": "2:1:1:3:1",
    "3": "0:5:1:8:1",
    "4": "1:5:1:8:1",
    "5": "2:5:1:8:1",
    "6": "0:10:1:12:1",
    "7": "0:14:1:16:1",
  },
  functionNames: ["a.ts", "b.ts", "c.ts", "main", "helper", "deep", "recur", "other"],
  moduleNodes: [0, 1, 2],
  fun2fun: [
    [3, 4],
    [4, 5],
    [6, 6],
    [6, 7],
    [7, 6],
    [4, 3],
  ],
  requireEdges: [[4, 3]],
  ignore: [],
});

describe("traverse —— 沿 call 边 BFS", () => {
  test("callees：depth 截断与边方向", () => {
    const one = traverse(flow, { start: 3, direction: "callees", depth: 1 });
    expect(one.nodes).toEqual([
      { id: 3, distance: 0 },
      { id: 4, distance: 1 },
    ]);
    expect(one.edges).toEqual([{ from: 3, to: 4 }]);
    expect(one.maxDepthReached).toBe(1);

    const two = traverse(flow, { start: 3, direction: "callees", depth: 2 });
    expect(two.nodes).toEqual([
      { id: 3, distance: 0 },
      { id: 4, distance: 1 },
      { id: 5, distance: 2 },
    ]);
    expect(two.maxDepthReached).toBe(2);
  });

  test("depth 0 只有起点", () => {
    const result = traverse(flow, { start: 3, direction: "callees", depth: 0 });
    expect(result.nodes).toEqual([{ id: 3, distance: 0 }]);
    expect(result.edges).toEqual([]);
    expect(result.maxDepthReached).toBe(0);
  });

  test("callers：反向可达（require 边不算）", () => {
    const up = traverse(flow, { start: 5, direction: "callers", depth: 2 });
    expect(up.nodes).toEqual([
      { id: 5, distance: 0 },
      { id: 4, distance: 1 },
      { id: 3, distance: 2 },
    ]);
  });

  test("require 边不参与遍历", () => {
    // helper(4) --require--> main(3)，但 callers[3] 应为空。
    expect(flow.callers[3]).toEqual([]);
    expect(requireSourcesOf(flow, 3)).toEqual([4]);
    const down = traverse(flow, { start: 4, direction: "callees", depth: 1 });
    expect(down.nodes).toEqual([
      { id: 4, distance: 0 },
      { id: 5, distance: 1 },
    ]);
  });

  test("both：同时向两个方向展开，按 distance 再按 id 排序", () => {
    const result = traverse(flow, { start: 4, direction: "both", depth: 1 });
    expect(result.nodes).toEqual([
      { id: 4, distance: 0 },
      { id: 3, distance: 1 },
      { id: 5, distance: 1 },
    ]);
  });

  test("环不会死循环（自环 + 互相调用）", () => {
    const forward = traverse(flow, { start: 6, direction: "callees", depth: 50 });
    expect(forward.nodes).toEqual([
      { id: 6, distance: 0 },
      { id: 7, distance: 1 },
    ]);
    expect(forward.maxDepthReached).toBe(1);
    const backward = traverse(flow, { start: 7, direction: "callers", depth: 50 });
    expect(backward.nodes).toEqual([
      { id: 7, distance: 0 },
      { id: 6, distance: 1 },
    ]);
  });

  test("多起点与非法参数", () => {
    const multi = traverse(flow, { start: [5, 3], direction: "callees", depth: 0 });
    expect(multi.rootIds).toEqual([3, 5]);
    expect(multi.nodes).toEqual([
      { id: 3, distance: 0 },
      { id: 5, distance: 0 },
    ]);
    expect(() => traverse(flow, { start: 3, depth: -1 })).toThrow();
    expect(() => traverse(flow, { start: 999 })).toThrow();
    expect(() => traverse(flow, { start: 3, direction: "sideways" })).toThrow();
  });
});

describe("renderTree —— 人类视图", () => {
  const tree = renderTree(flow, traverse(flow, { start: 3, direction: "callees", depth: 2 }), {
    rootId: 3,
  });

  test("目标行 + 缩进调用链 + 调用方向箭头", () => {
    expect(tree).toContain("目标  main  a.ts:5");
    expect(tree).toContain("影响面（callees 正向可达，深度 2）：");
    expect(tree).toContain("└─ main  a.ts:5");
    expect(tree).toContain("└─ helper  b.ts:5  ← main  a.ts:5");
    expect(tree).toContain("└─ deep  c.ts:5  ← helper  b.ts:5");
  });

  test("汇总行统计函数/模块/目录", () => {
    expect(tree).toContain("汇总：受影响函数 3 个 / 涉及 3 个模块 / 1 个目录");
  });

  test("callers 方向用反向箭头，扇出超出 maxChildren 时截断", () => {
    const up = renderTree(flow, traverse(flow, { start: 6, direction: "callers", depth: 1 }), {
      rootId: 6,
    });
    expect(up).toContain("└─ other  a.ts:14  → recur  a.ts:10");
    const capped = renderTree(flow, traverse(flow, { start: 3, direction: "callees", depth: 1 }), {
      rootId: 3,
      maxChildren: 0,
    });
    expect(capped).toContain("其余 1 个省略（共 1 个）");
  });

  test("未解析边界行 + 汇总计数 + 「不可信」警告（§4.4）", () => {
    const boundaries = [
      { kind: "unresolved", file: "x.ts", line: 1, text: "f()" },
      { kind: "unresolved", file: "x.ts", line: 2, text: "g()" },
    ];
    const tree = renderTree(flow, traverse(flow, { start: 3, direction: "callees", depth: 1 }), {
      rootId: 3,
      boundaries,
      maxBoundaries: 1,
    });
    expect(tree).toContain("⚠ 边界：x.ts:1 的 f() 未解析");
    expect(tree).toContain("其余 1 条边界省略（共 2 条）");
    expect(tree).toContain("；未解析边界 2 处");
    expect(tree).toContain("影响面可能不可信：可达函数 2 个，但边界调用点有 2 个");
  });
});

// ---------------------------------------------------------------------------
// S2c —— 未解析边界：合成数据
// ---------------------------------------------------------------------------

/**
 * 归属用合成图：`outer(2)` 内嵌 `inner(3)`；`a.ts` 与 `b/c.ts` 各有一个模块节点。
 *
 * ```
 * a.ts   [1..20] 模块 0
 *   outer [2..10]
 *     inner [4..6]
 * b/c.ts [1..20] 模块 1
 *   other [2..8]
 * ```
 */
const boundaryGraph = buildGraph({
  entries: ["a.ts"],
  ignoreDependencies: false,
  files: ["a.ts", "b/c.ts"],
  functions: {
    "0": "0:1:1:20:1",
    "1": "1:1:1:20:1",
    "2": "0:2:1:10:1",
    "3": "0:4:1:6:1",
    "4": "1:2:1:8:1",
  },
  functionNames: ["a.ts", "b/c.ts", "outer", "inner", "other"],
  moduleNodes: [0, 1],
  fun2fun: [[2, 4]],
  requireEdges: [],
  ignore: [],
});

const boundaryCallData = {
  graph: "func.json",
  files: ["a.ts", "b/c.ts"],
  calls: {
    "100": "0:3:1:3:10", // outer 体内，已解析 → other
    "101": "0:5:1:5:10", // inner（嵌套）体内，已解析 → other
    "102": "0:1:1:1:10", // 模块顶层（不属于 outer）→ 模块节点 0
    "103": "0:9:1:9:10", // outer 体内，未解析
    "104": "1:3:1:3:10", // other 体内，未解析
  },
  call2fun: [
    [100, 4],
    [101, 4],
  ],
};

describe("buildCallIndex —— 位置归属（合成）", () => {
  const index = buildCallIndex(boundaryGraph, boundaryCallData);

  test("未解析 = calls 减 call2fun；缺位置归属时不算已解析", () => {
    expect(index.unresolvedIds).toEqual([102, 103, 104]);
    expect(index.points.size).toBe(5);
  });

  test("嵌套取最内层；模块顶层归给模块节点", () => {
    expect(index.points.get(100).ownerId).toBe(2);
    expect(index.points.get(101).ownerId).toBe(3);
    expect(index.points.get(102).ownerId).toBe(0);
    expect(index.points.get(103).ownerId).toBe(2);
    expect(index.points.get(104).ownerId).toBe(4);
  });

  test("已解析调用点按 caller>callee 归并，取最小 callId", () => {
    expect(index.resolvedByPair.get("2>4")).toBe(100);
    expect(index.resolvedByPair.get("3>4")).toBe(101);
  });
});

describe("collectBoundaries / buildResultJson —— 合成", () => {
  const index = buildCallIndex(boundaryGraph, boundaryCallData);
  const result = traverse(boundaryGraph, { start: 2, direction: "callees", depth: 2 });
  const readLine = (file: string, line: number) => `${file}:${line}`;

  test("只报结果集合内节点的边界；模块顶层的 102 被排除", () => {
    const boundaries = collectBoundaries(boundaryGraph, result, index, { readLine });
    expect(boundaries).toEqual([
      { kind: "unresolved", file: "a.ts", line: 9, text: "a.ts:9" },
      { kind: "unresolved", file: "b/c.ts", line: 3, text: "b/c.ts:3" },
    ]);
  });

  test("summary 只数函数节点；boundaries 计数进 summary", () => {
    const boundaries = collectBoundaries(boundaryGraph, result, index, { readLine });
    expect(summarizeResult(boundaryGraph, result, boundaries)).toEqual({
      functions: 2,
      modules: 2,
      directories: 2,
      boundaries: 2,
      maxDepthReached: 1,
    });
  });

  test("JSON 契约：target / direction / depth / nodes / edges / boundaries / summary", () => {
    const boundaries = collectBoundaries(boundaryGraph, result, index, { readLine });
    const payload = buildResultJson(boundaryGraph, result, {
      targetIds: [2],
      boundaries,
      callIndex: index,
    });
    expect(payload.target).toEqual({ id: 2, file: "a.ts", line: 2, name: "outer" });
    expect(payload.direction).toBe("callees");
    expect(payload.depth).toBe(2);
    expect(payload.nodes).toEqual([
      { id: 2, file: "a.ts", line: 2, name: "outer", distance: 0 },
      { id: 4, file: "b/c.ts", line: 2, name: "other", distance: 1 },
    ]);
    expect(payload.edges).toEqual([{ from: 2, to: 4, viaCall: 100 }]);
    expect(Object.keys(payload.boundaries[0]).sort()).toEqual(["file", "kind", "line", "text"]);
  });

  test("多起点（glob）时 target 是数组", () => {
    const payload = buildResultJson(boundaryGraph, result, { targetIds: [2, 4] });
    expect(payload.target).toEqual([
      { id: 2, file: "a.ts", line: 2, name: "outer" },
      { id: 4, file: "b/c.ts", line: 2, name: "other" },
    ]);
  });

  test("查不到调用点的边省略 viaCall", () => {
    const payload = buildResultJson(boundaryGraph, result, { callIndex: index });
    expect(payload.edges[0].viaCall).toBe(100);
    const payloadNoIndex = buildResultJson(boundaryGraph, result, {});
    expect(payloadNoIndex.edges[0]).toEqual({ from: 2, to: 4 });
    expect("viaCall" in payloadNoIndex.edges[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// S2c —— 未解析边界：基线
// ---------------------------------------------------------------------------

describe("未解析边界 —— 基线", () => {
  const callIndex = buildCallIndex(graph, loadCallData());

  test("基线：4841 个调用点，2185 个未解析", () => {
    expect(callIndex.points.size).toBe(4841);
    expect(callIndex.unresolvedIds.length).toBe(2185);
    expect(callIndex.resolvedByPair.size).toBeGreaterThan(0);
  });

  test("已知真漏 onEvict?.(state)（history.ts:148）归给最内层 evict(18)", () => {
    const point = callIndex.points.get(1924);
    expect(point).toMatchObject({
      file: "src/lib/history.ts",
      line: 148,
      ownerId: 18,
      calleeId: null,
    });
    expect(graph.nodes[18]).toMatchObject({ name: "evict", line: 147, endLine: 149 });
  });

  test("impact createEditHistory 的边界与 JSON 契约", () => {
    const roots = resolveSelector(graph, "createEditHistory");
    const result = traverse(graph, { start: roots, direction: "both", depth: 3 });
    const boundaries = collectBoundaries(graph, result, callIndex);
    expect(boundaries.length).toBe(15);
    expect(boundaries.every((item) => item.kind === "unresolved")).toBe(true);
    expect(boundaries.every((item) => item.text === item.text.trim())).toBe(true);
    const payload = buildResultJson(graph, result, { targetIds: roots, boundaries, callIndex });
    expect(payload.summary).toEqual({
      functions: 10,
      modules: 3,
      directories: 3,
      boundaries: 15,
      maxDepthReached: 3,
    });
    expect(payload.edges.length).toBeGreaterThan(0);
    expect(payload.edges.every((edge) => Number.isInteger(edge.viaCall))).toBe(true);
    // §4.4：边界数 ≥ 可达函数数 → 人类视图给出「不可信」警告
    expect(boundaries.length).toBeGreaterThanOrEqual(payload.summary.functions);
    expect(renderTree(graph, result, { rootId: roots, boundaries })).toContain("影响面可能不可信");
  });
});
