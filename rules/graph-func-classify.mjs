#!/usr/bin/env node
/**
 * `graph-func-classify` —— 把 `func-calls.json` 里的**未解析调用点**离线分类（S3b）。
 *
 * 背景：`func-calls.json` 共 N 个调用点，其中一部分没有 callee（未解析边界）。查询层
 * `graph-func-query.mjs` 把它们统一报成 `kind: "unresolved"`，无法区分「边界外（原生 /
 * 第三方 / import）」和「本仓库真漏」。本脚本用官方 TypeScript checker 在每个调用点的
 * **源码位置**解析 callee 符号，按其**声明所在文件**归类，产出一份离线基线：
 *
 *   rules/out/func-boundaries.json
 *
 * 类别（照 tmp/oh-my-jelly.md §0.4 / 附录 A）：
 *   A  native       JS/DOM 内建，声明在 node_modules/typescript/lib/*.d.ts
 *   B  external     第三方依赖，声明在其它 node_modules
 *   C1 注入/回调    仓库内，声明是 Parameter / PropertySignature / MethodSignature / BindingElement
 *   C2 真漏         仓库内其它声明（FunctionDeclaration 等）——这是最有价值的清单
 *   D  仓库外       仓库外（如 ../gpen-protocol/**）
 *   I  import/require  源码行是 import/export（模块加载边，不是函数调用）
 *   U  无法用 TS 归类  TS 不解析的文件（.svelte / 被 tsconfig 排除的 .js 等）
 *   9  无符号        super() / `x!()` / `(x as F)()` 等动态或宏（getSymbolAtLocation 拿不到）
 *
 * 关键坑（附录 A）：`a.b().c()` 这类链式调用的多个调用点**共享起始列**，只按起始位置
 * 匹配会把外层调用误判成内层。这里同时记录 TS 节点的**结束位置**，取离记录结束位置最近的
 * 候选消歧（阈值 >3 视为没匹配上）。
 *
 * 确定性 / 幂等：输出按 callId 升序；不依赖遍历顺序（候选排序后再选）；同一份输入连跑
 * 两次字节相同。
 *
 * 用法（bun / node 均可；依赖仓库自带的 node_modules/typescript）：
 *   bun rules/graph-func-classify.mjs
 *   node rules/graph-func-classify.mjs
 *   bun rules/graph-func-classify.mjs --quiet      # 不打印 stderr 汇总
 *
 * 只读 `func-calls.json` + `src/**` + `tsconfig.json`，只写 `func-boundaries.json`；
 * 不碰 func.json / func-calls.json / graph-func-query.mjs。
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// 用仓库自带的官方 TS（不是全局 ts-node / tsgo）——附录 A 明确要求 TS checker。
const ts = require("typescript");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CALLS_PATH = resolve(HERE, "out", "func-calls.json");
const OUT_PATH = resolve(HERE, "out", "func-boundaries.json");
const TSCONFIG_PATH = resolve(ROOT, "tsconfig.json");
const QUIET = process.argv.includes("--quiet");

/** 分类图例（与输出 legend 字段一一对应）。 */
const LEGEND = {
  A: "native(JS/DOM 内建)",
  B: "external(第三方依赖)",
  C1: "注入/回调(参数或接口)",
  C2: "本仓库函数(真漏)",
  D: "仓库外",
  I: "import/require",
  U: "无法用 TS 归类(.svelte 等)",
  9: "无符号(动态/宏/super)",
};

const C1_DECL_KINDS = new Set([
  "Parameter",
  "PropertySignature",
  "MethodSignature",
  "BindingElement",
]);
const IMPORT_LINE = /^\s*(import|export)\b/;

/** 调用点所属文件不在 `src/` 下、或 TS 不解析时也归 U（例如被排除的生成物）。 */
function toPosix(path) {
  return path.split("\\").join("/");
}

/** 解析 tsconfig（含 extends）并建 program。tsconfig 解析失败要显式报错，别静默降级。 */
function createTsProgram() {
  const cfg = ts.getParsedCommandLineOfConfigFile(
    TSCONFIG_PATH,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(
          `tsconfig 无法解析：${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
        );
      },
    },
  );
  if (!cfg) throw new Error(`tsconfig 无法解析：${TSCONFIG_PATH}`);
  const errors = (cfg.errors ?? []).filter((e) => e.category === ts.DiagnosticCategory.Error);
  const program = ts.createProgram(cfg.fileNames, { ...cfg.options, noEmit: true });
  return { program, configErrors: errors.length };
}

/**
 * 把 program 里所有**仓库内非声明**源文件的 CallExpression / NewExpression 按
 * `绝对路径|起始行:起始列` 建索引。值里带 TS 节点结束位置（消歧用）。
 */
function indexCallNodes(program) {
  const byStart = new Map();
  const srcPrefix = `${toPosix(ROOT)}/src/`;
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const filePath = toPosix(resolve(sourceFile.fileName));
    if (!filePath.startsWith(srcPrefix)) continue;
    const visit = (node) => {
      // 合成节点（pos < 0）没有源码位置，直接跳过但继续下钻。
      if (node.pos < 0) {
        ts.forEachChild(node, visit);
        return;
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
        const key = `${filePath}|${start.line + 1}:${start.character + 1}`;
        let bucket = byStart.get(key);
        if (!bucket) {
          bucket = [];
          byStart.set(key, bucket);
        }
        bucket.push({
          node,
          startLine: start.line + 1,
          startCol: start.character + 1,
          endLine: end.line + 1,
          endCol: end.character + 1,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  // 候选按结束位置排序，保证同一条目在遍历顺序变化时仍选同一个。
  for (const bucket of byStart.values()) {
    bucket.sort((a, b) => a.endLine - b.endLine || a.endCol - b.endCol);
  }
  return byStart;
}

/**
 * 在候选里选**结束位置最接近**记录的那个（附录 A 的链式调用消歧）。
 * 返回 null 表示没有可信匹配（距离 >3，视作没对上）。
 */
function matchCallNode(candidates, endLine, endCol) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates ?? []) {
    const distance =
      Math.abs(candidate.endLine - endLine) * 100 + Math.abs(candidate.endCol - endCol);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance > 3 ? null : best;
}

/** 从 callee 表达式取符号（Identifier / PropertyAccess.name / ElementAccess.argument），照附录 A。 */
function calleeSymbol(checker, node) {
  const expression = node.expression;
  if (!expression) return undefined;
  if (ts.isIdentifier(expression)) return checker.getSymbolAtLocation(expression);
  if (ts.isPropertyAccessExpression(expression))
    return checker.getSymbolAtLocation(expression.name);
  if (ts.isElementAccessExpression(expression))
    return checker.getSymbolAtLocation(expression.argumentExpression);
  return undefined;
}

/** 符号声明文件 → A/B/C1/C2/D；拿不到声明则 null（外层会记 9）。 */
function classifyByDeclaration(symbol) {
  const declarations = symbol.getDeclarations();
  const declaration = declarations?.[0];
  if (!declaration) return null;
  const declFile = toPosix(resolve(declaration.getSourceFile().fileName));
  const rel = toPosix(relative(ROOT, declFile));
  if (rel.includes("node_modules/typescript/lib/")) return "A";
  if (rel.includes("node_modules/")) return "B";
  if (rel.startsWith("src/")) {
    const kind = ts.SyntaxKind[declaration.kind];
    return C1_DECL_KINDS.has(kind) ? "C1" : "C2";
  }
  return "D";
}

/** 取 callee 符号并穿透 import 别名，照附录 A。 */
function resolveCalleeSymbol(checker, node) {
  const symbol = calleeSymbol(checker, node);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) return checker.getAliasedSymbol(symbol);
  return symbol;
}

/** 分类**单个**调用点（规则 1-4）。返回 `[callId, kind, symbolName|null]`。 */
function classifyCall(callId, location, context) {
  const [fileIndex, line, col, endLine, endCol] = location.split(":").map(Number);
  const filePath = resolve(ROOT, context.files[fileIndex]);

  // 规则 4：TS 不解析该文件（.svelte / 被 tsconfig 排除的生成物）→ 诚实标 U。
  if (!context.parsedFiles.has(filePath)) return [callId, "U", null];

  const hit = matchCallNode(context.byStart.get(`${filePath}|${line}:${col}`), endLine, endCol);

  // 规则 3：没匹配到调用节点、且源码行是 import/export → 模块加载边 I。
  if (!hit) {
    const kind = IMPORT_LINE.test(context.readLine(filePath, line)) ? "I" : "9";
    return [callId, kind, null];
  }

  // 规则 1/2：解析 callee 符号，按声明文件归类。
  const symbol = resolveCalleeSymbol(context.checker, hit.node);
  const kind = symbol ? classifyByDeclaration(symbol) : null;
  if (!kind) return [callId, "9", null];
  return [callId, kind, symbol.getName()];
}

function makeContext(program) {
  const lineCache = new Map();
  return {
    checker: program.getTypeChecker(),
    parsedFiles: new Set(program.getSourceFiles().map((sf) => toPosix(resolve(sf.fileName)))),
    byStart: indexCallNodes(program),
    readLine(filePath, line) {
      let lines = lineCache.get(filePath);
      if (!lines) {
        lines = readFileSync(filePath, "utf8").split("\n");
        lineCache.set(filePath, lines);
      }
      return lines[line - 1] ?? "";
    },
  };
}

function printSummary(kinds, configErrors) {
  const counts = {};
  for (const [, kind] of kinds) counts[kind] = (counts[kind] ?? 0) + 1;
  const order = ["A", "B", "C1", "C2", "D", "I", "U", "9"];
  const summary = order
    .filter((kind) => counts[kind])
    .map((kind) => `${kind}=${counts[kind]}`)
    .join(" ");
  process.stderr.write(
    `func-boundaries: ${kinds.length} 未解析 → ${summary}` +
      (configErrors ? `（tsconfig 有 ${configErrors} 条错误）` : "") +
      `\n写出 ${toPosix(relative(ROOT, OUT_PATH))}\n`,
  );
}

function main() {
  const callData = JSON.parse(readFileSync(CALLS_PATH, "utf8"));
  const files = callData.files ?? [];
  const resolvedIds = new Set((callData.call2fun ?? []).map(([callId]) => callId));
  const unresolved = Object.keys(callData.calls)
    .map(Number)
    .filter((callId) => !resolvedIds.has(callId))
    .sort((a, b) => a - b);

  const { program, configErrors } = createTsProgram();
  const context = { ...makeContext(program), files };
  const kinds = unresolved
    .map((callId) => classifyCall(callId, callData.calls[String(callId)], context))
    .sort((a, b) => a[0] - b[0]);

  const output = {
    graph: basename(callData.graph ?? "func.json"),
    calls: basename(CALLS_PATH),
    legend: LEGEND,
    kinds,
  };
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  if (!QUIET) printSummary(kinds, configErrors);
}

main();
