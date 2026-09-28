#!/usr/bin/env bun
/**
 * 代码形状健康度门禁 —— `bun run health:gate`。
 *
 * 数据源：`oxlint -c .oxlintrc.json -f json --deny complexity --deny max-depth
 * --deny max-lines-per-function <production files>`（原为 `repowise health`，已切换）。
 * 只对**代码形状**负责：`complexity` / `max-depth` / `max-lines-per-function`。
 *
 * FAIL 条件（任一命中即退出码 1）：
 *   - large_method      任意 severity —— NLOC ≥ 60 **且 CCN ≥ 3**（CCN 下限必须有）
 *   - complex_method    severity ∈ {critical, high}（CCN ≥ 15）
 *   - nested_complexity severity ∈ {critical, high}（max-depth ≥ 5）
 *   - 可选：--baseline <json> 时，任何**新增**的 severity ≥ medium finding
 *
 * 其余 severity ∈ {medium, high, critical} 的 finding 仅作 WARN 列出，不影响退出码。
 *
 * severity 由数值反推（不是让规则本身分档，因为 ESLint 规则一个阈值只能一个 severity）：
 *   - CCN：  ≥ 15 → high（FAIL）；9–14 → medium（WARN）
 *   - depth：≥ 5  → high（FAIL）；4 → medium（WARN）
 *
 * 已放弃的维度（原 repowise 有、本门禁不再产出）：
 *   - `brain_method`：认知复杂度。本轮校准显示 `eslint-plugin-sonarjs` 的
 *     cognitive-complexity 与 repowise 的 cognitive 仅 4/12 精确匹配（双向偏差 7–8），
 *     无法复刻，故移除；当前该维度命中为 0。
 *   - `low_cohesion`：无任何 lint 等价物可表达（需类内字段/方法共用来往分析）；
 *     当前命中为 0。
 *
 * 口径与范围：`git ls-files` 过滤出 production 文件（`src/**`、`scripts/**`、`rules/**`
 * 加根级 `vite*.config.ts` / `*.config.mjs` 等；排除 `tests/**`、`.husky/**`、
 * `rules/jelly/**`），与旧 repowise `--scope production` 对齐。
 *
 * 用法：
 *   bun run health:gate
 *   bun run health:gate -- --module src/lib/layers
 *   bun run health:gate -- --baseline tmp/health-baseline.json
 *   bun run health:gate -- --baseline-out tmp/health-baseline.json   # 落盘基线
 *   bun run health:gate -- --json                                    # 机器可读
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// 类型 & 策略（纯函数，便于 tests/health-gate.test.ts 断言）
// ---------------------------------------------------------------------------

export interface HealthFinding {
  biomarker_type: string;
  severity: string;
  file_path: string;
  function_name?: string | null;
  health_impact?: number;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface HealthReport {
  scope?: string;
  counts?: string;
  kpis?: Record<string, number | string | null>;
  metrics?: Array<Record<string, unknown>>;
  findings?: HealthFinding[];
}

/** 任意 severity 即 FAIL。 */
export const ALWAYS_FAIL_BIOMARKERS: readonly string[] = ["large_method"];
/** 仅 critical/high 才 FAIL。 */
export const SEVERITY_GATED_BIOMARKERS: readonly string[] = ["complex_method", "nested_complexity"];
export const FAIL_SEVERITIES: ReadonlySet<string> = new Set(["critical", "high"]);
export const WARN_SEVERITIES: ReadonlySet<string> = new Set(["medium", "high", "critical"]);

/** 单个 finding 是否触发 FAIL。 */
export function isFailingFinding(finding: HealthFinding): boolean {
  if (ALWAYS_FAIL_BIOMARKERS.includes(finding.biomarker_type)) return true;
  if (SEVERITY_GATED_BIOMARKERS.includes(finding.biomarker_type)) {
    return FAIL_SEVERITIES.has(finding.severity);
  }
  return false;
}

/** 稳定身份：同一 biomarker + 文件 + 函数算同一条 finding（跨次运行可比对）。 */
export function findingKey(finding: HealthFinding): string {
  return [finding.biomarker_type, finding.file_path, finding.function_name ?? ""].join("\u0000");
}

export interface HealthBaseline {
  version?: number;
  generated_at?: string;
  scope?: string;
  counts?: string;
  module?: string | null;
  keys?: string[];
  findings?: HealthFinding[];
}

/** 从基线 JSON 文本提取身份 key 集合；支持 `keys` 或 `findings` 两种形态。 */
export function baselineKeysFrom(text: string): Set<string> {
  const parsed = JSON.parse(text) as HealthBaseline | string[];
  if (Array.isArray(parsed)) return new Set(parsed);
  if (Array.isArray(parsed.keys)) return new Set(parsed.keys);
  if (Array.isArray(parsed.findings)) return new Set(parsed.findings.map(findingKey));
  return new Set();
}

export interface GateDecision {
  failing: HealthFinding[];
  warnings: HealthFinding[];
  /** 仅当提供 baseline 时非空：基线中不存在、且 severity ≥ medium 的 finding。 */
  regressions: HealthFinding[];
  failed: boolean;
}

/**
 * 门禁判定。`baselineKeys` 为 undefined 时不做增量比对（全量口径）。
 */
export function decideGate(report: HealthReport, baselineKeys?: Set<string>): GateDecision {
  const findings = report.findings ?? [];
  const failing = findings.filter(isFailingFinding);
  const warnings = findings.filter(
    (finding) => !isFailingFinding(finding) && WARN_SEVERITIES.has(finding.severity),
  );
  const regressions =
    baselineKeys === undefined
      ? []
      : findings.filter(
          (finding) =>
            WARN_SEVERITIES.has(finding.severity) && !baselineKeys.has(findingKey(finding)),
        );
  return { failing, warnings, regressions, failed: failing.length > 0 || regressions.length > 0 };
}

/** 按 biomarker 统计 finding 数（含 severity 分布）。 */
export function countByBiomarker(findings: HealthFinding[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const finding of findings) {
    const bySeverity = out.get(finding.biomarker_type) ?? new Map<string, number>();
    bySeverity.set(finding.severity, (bySeverity.get(finding.severity) ?? 0) + 1);
    out.set(finding.biomarker_type, bySeverity);
  }
  return out;
}

/** 把一次 health 结果序列化成可被 --baseline 复用的基线。 */
export function buildBaseline(report: HealthReport, module?: string): HealthBaseline {
  const findings = report.findings ?? [];
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    scope: report.scope ?? "production",
    counts: report.counts ?? "code_shape",
    module: module ?? null,
    keys: findings.map(findingKey),
    findings,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface GateOptions {
  module?: string;
  baseline?: string;
  baselineOut?: string;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): GateOptions {
  const options: GateOptions = { json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    const [flag, inline] = token.split("=", 2) as [string, string?];
    const next = (): string => {
      if (inline !== undefined) return inline;
      index += 1;
      const value = argv[index];
      if (value === undefined) throw new Error(`${flag} requires a value`);
      return value;
    };
    switch (flag) {
      case "--module":
        options.module = next();
        break;
      case "--baseline":
        options.baseline = next();
        break;
      case "--baseline-out":
        options.baselineOut = next();
        break;
      case "--json":
        options.json = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${token}`);
    }
  }
  return options;
}

// ---------------------------------------------------------------------------
// oxlint 数据源
// ---------------------------------------------------------------------------

/** oxlint `-f json` 的单条 diagnostic（只声明用到的字段）。 */
export interface OxlintDiagnostic {
  code: string;
  message: string;
  filename: string;
  labels?: Array<{ span?: { line?: number } }>;
}

/** production 范围：这些根目录下的文件 + 根级配置白名单。与旧 repowise scope=production 对齐。 */
const PRODUCTION_ROOTS = ["src/", "scripts/", "rules/"];
const PRODUCTION_FILES = new Set([
  "vite.config.ts",
  "vite.embed.config.ts",
  "eslint.config.mjs",
  "commitlint.config.mjs",
  "playwright.config.ts",
]);
const LINTED_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".svelte"];

function messageNumber(message: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(message);
  return match ? Number(match[1]) : undefined;
}

/** 诊断 message 里的函数名（`` `name` ``）；匿名时为 null。 */
function messageName(message: string): string | null {
  const match = /`([^`]*)`/.exec(message);
  return match ? match[1] : null;
}

interface FunctionSpan {
  line: number;
  name: string | null;
  ccn?: number;
  nloc?: number;
}

interface FileBuckets {
  starts: FunctionSpan[];
  depths: Array<{ line: number; depth: number }>;
}

/** 按文件归集每函数 start（ccn / nloc）与 max-depth 诊断。 */
function collectBuckets(diagnostics: OxlintDiagnostic[]): Map<string, FileBuckets> {
  const byFile = new Map<string, FileBuckets>();
  const bucketFor = (file: string): FileBuckets => {
    let current = byFile.get(file);
    if (!current) {
      current = { starts: [], depths: [] };
      byFile.set(file, current);
    }
    return current;
  };
  for (const diagnostic of diagnostics) {
    const line = diagnostic.labels?.[0]?.span?.line ?? 0;
    const bucket = bucketFor(diagnostic.filename);
    if (diagnostic.code.includes("complexity")) {
      const ccn = messageNumber(diagnostic.message, /complexity of (\d+)/);
      if (ccn !== undefined) {
        bucket.starts.push({ line, name: messageName(diagnostic.message), ccn });
      }
    } else if (diagnostic.code.includes("max-lines-per-function")) {
      const nloc = messageNumber(diagnostic.message, /too many lines \((\d+)\)/);
      if (nloc !== undefined) {
        bucket.starts.push({ line, name: messageName(diagnostic.message), nloc });
      }
    } else if (diagnostic.code.includes("max-depth")) {
      const depth = messageNumber(diagnostic.message, /nested too deeply \((\d+)\)/);
      if (depth !== undefined) bucket.depths.push({ line, depth });
    }
  }
  return byFile;
}

/** 同一个 start-line 的 complexity / max-lines 合并成一个函数（按 start-line 排序）。 */
function mergeFunctionSpans(starts: FunctionSpan[]): FunctionSpan[] {
  const merged = new Map<number, FunctionSpan>();
  for (const start of starts) {
    merged.set(start.line, Object.assign(merged.get(start.line) ?? { line: start.line }, start));
  }
  return [...merged.values()].sort((a, b) => a.line - b.line);
}

/** 区间 [start, end) 内的最大 max-depth（归因到所属函数）。 */
function maxNestingInRange(
  depths: Array<{ line: number; depth: number }>,
  start: number,
  end: number,
): number {
  let max = 0;
  for (const diagnostic of depths) {
    if (diagnostic.line >= start && diagnostic.line < end) max = Math.max(max, diagnostic.depth);
  }
  return max;
}

/** 一个函数的全部 finding（尺寸 / 复杂度 / 嵌套）。 */
function findingsForSpan(file: string, fn: FunctionSpan, depth: number): HealthFinding[] {
  const findings: HealthFinding[] = [];
  if ((fn.nloc ?? 0) >= 60 && (fn.ccn ?? 0) >= 3) {
    findings.push({
      biomarker_type: "large_method",
      severity: "high",
      file_path: file,
      function_name: fn.name,
      details: { nloc: fn.nloc, ccn: fn.ccn },
    });
  }
  if (fn.ccn !== undefined && fn.ccn >= 9) {
    findings.push({
      biomarker_type: "complex_method",
      severity: fn.ccn >= 15 ? "high" : "medium",
      file_path: file,
      function_name: fn.name,
      details: { ccn: fn.ccn },
    });
  }
  if (depth >= 4) {
    findings.push({
      biomarker_type: "nested_complexity",
      severity: depth >= 5 ? "high" : "medium",
      file_path: file,
      function_name: fn.name,
      details: { max_nesting: depth },
    });
  }
  return findings;
}

/**
 * 把 oxlint diagnostics 归一成 `HealthFinding`（形状与旧 repowise 一致，判定层不动）：
 *  - complexity → complex_method（CCN ≥ 15 high / 9–14 medium）
 *  - max-depth  → nested_complexity（depth ≥ 5 high / 4 medium）；诊断挂在内层 block 上，
 *    按「同一文件里 start-line 最近的、且在其之前开始的函数」归因到所属函数
 *  - max-lines-per-function → large_method，**必须显式要求 CCN ≥ 3**（否则长而平的函数会被误报）
 */
export function oxlintDiagnosticsToFindings(diagnostics: OxlintDiagnostic[]): HealthFinding[] {
  const byFile = collectBuckets(diagnostics);
  const findings: HealthFinding[] = [];
  for (const [file, buckets] of byFile) {
    const functions = mergeFunctionSpans(buckets.starts);
    for (let index = 0; index < functions.length; index += 1) {
      const fn = functions[index];
      const nextLine = functions[index + 1]?.line ?? Number.POSITIVE_INFINITY;
      const depth = maxNestingInRange(buckets.depths, fn.line, nextLine);
      findings.push(...findingsForSpan(file, fn, depth));
    }
  }
  return findings;
}

/**
 * production 文件清单（`git ls-files` + 扩展名过滤）。
 *
 * 必须同时取 `--others --exclude-standard`：只用 `--cached` 会漏掉**未跟踪的新文件**，
 * 于是本地新写的函数可以直接绕过门禁（CI 里文件都已入库，问题只在本地暴露）。
 */
export function productionFiles(modulePrefix?: string): string[] {
  const proc = Bun.spawnSync(
    ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (proc.exitCode !== 0) {
    throw new Error(`git ls-files exited ${proc.exitCode}`);
  }
  const all = new TextDecoder().decode(proc.stdout).split("\0").filter(Boolean);
  return all.filter((file) => {
    const inRoot = PRODUCTION_ROOTS.some((root) => file.startsWith(root));
    if (!inRoot && !PRODUCTION_FILES.has(file)) return false;
    if (file.startsWith("rules/jelly/")) return false;
    if (!LINTED_EXTENSIONS.some((extension) => file.endsWith(extension))) return false;
    if (!existsSync(file)) return false; // 已删除但仍在索引里的文件
    if (modulePrefix && !file.startsWith(modulePrefix)) return false;
    return true;
  });
}

/** 定位 oxlint 可执行文件：优先仓库本地 bin，其次 PATH 上的 oxlint。 */
function oxlintCommand(): string {
  const local = resolve(import.meta.dirname, "../node_modules/.bin/oxlint");
  return existsSync(local) ? local : "oxlint";
}

/** 跑 oxlint 并归一成 HealthReport（findings 用 oxlintDiagnosticsToFindings）。 */
function runOxlintGate(modulePrefix?: string): HealthReport {
  const files = productionFiles(modulePrefix);
  if (files.length === 0) {
    throw new Error("health-gate: no production files matched");
  }
  const proc = Bun.spawnSync(
    [
      oxlintCommand(),
      "--no-ignore",
      "-c",
      ".oxlintrc.json",
      "-f",
      "json",
      "--deny",
      "complexity",
      "--deny",
      "max-depth",
      "--deny",
      "max-lines-per-function",
      ...files,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const stdout = new TextDecoder().decode(proc.stdout);
  let parsed: { diagnostics?: OxlintDiagnostic[] };
  try {
    parsed = JSON.parse(stdout) as { diagnostics?: OxlintDiagnostic[] };
  } catch (error) {
    const stderr = new TextDecoder().decode(proc.stderr);
    throw new Error(
      `oxlint returned unparsable JSON (exit ${proc.exitCode}): ${(error as Error).message}\n${stderr || stdout}`,
    );
  }
  return {
    scope: "production",
    counts: "code_shape",
    findings: oxlintDiagnosticsToFindings(parsed.diagnostics ?? []),
  };
}

function severitySummary(bySeverity: Map<string, number>): string {
  const order = ["critical", "high", "medium", "low"];
  return order
    .filter((severity) => bySeverity.has(severity))
    .map((severity) => `${bySeverity.get(severity)} ${severity}`)
    .join(", ");
}

function describe(finding: HealthFinding): string {
  const target = finding.function_name
    ? `${finding.file_path}::${finding.function_name}`
    : finding.file_path;
  return `[${finding.severity}] ${finding.biomarker_type.padEnd(19)} ${target}${
    finding.reason ? ` — ${finding.reason}` : ""
  }`;
}

function printKpis(report: HealthReport): void {
  if (!report.kpis) return;
  const { hotspot_health, average_health, production_file_count } = report.kpis;
  console.log(
    `health: hotspot ${hotspot_health ?? "?"} / average ${average_health ?? "?"} (files ${
      production_file_count ?? "?"
    })`,
  );
}

/** 打一个 finding 小节（空时打 `(none)`）。 */
function printFindingSection(label: string, note: string, findings: HealthFinding[]): void {
  console.log(`\n${label} (${findings.length})${note}`);
  if (findings.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const finding of findings) console.log(`  ${describe(finding)}`);
}

/** 打 FAIL 的 biomarker × severity 计数表。 */
function printFailByBiomarker(counts: Map<string, Map<string, number>>): void {
  console.log("\nFAIL by biomarker:");
  if (counts.size === 0) {
    console.log("  (none)");
    return;
  }
  for (const [biomarker, bySeverity] of counts) {
    const total = [...bySeverity.values()].reduce((sum, value) => sum + value, 0);
    console.log(
      `  ${biomarker.padEnd(19)} ${String(total).padStart(3)}  (${severitySummary(bySeverity)})`,
    );
  }
}

function printHuman(decision: GateDecision, options: GateOptions, report: HealthReport): void {
  console.log(
    `oxlint health gate — scope=production counts=code_shape module=${options.module ?? "(all)"}`,
  );
  printKpis(report);

  printFindingSection("FAIL", " — 命中门禁策略：", decision.failing);
  printFindingSection("WARN", " — severity ≥ medium、不判失败：", decision.warnings);
  if (decision.regressions.length > 0) {
    printFindingSection(
      "REGRESSIONS",
      " — 相对基线新增的 severity ≥ medium：",
      decision.regressions,
    );
  }

  printFailByBiomarker(countByBiomarker(decision.failing));

  console.log(
    `\nhealth:gate ${decision.failed ? "FAILED" : "PASSED"}${
      options.baseline ? ` (baseline: ${options.baseline})` : ""
    }`,
  );
}

const USAGE =
  "usage: health:gate [--module <prefix>] [--baseline <json>] [--baseline-out <json>] [--json]";

/** 执行门禁并返回退出码，便于把错误分支写成显式 return（满足 catch 必须 return/throw 的项目规则）。 */
function run(): number {
  let options: GateOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`health-gate: ${(error as Error).message}`);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const report = runOxlintGate(options.module);

  if (options.baselineOut) {
    writeFileSync(
      options.baselineOut,
      `${JSON.stringify(buildBaseline(report, options.module), null, 2)}\n`,
    );
    console.log(`health-gate: baseline written to ${options.baselineOut}`);
  }

  let baselineKeys: Set<string> | undefined;
  if (options.baseline) {
    try {
      baselineKeys = baselineKeysFrom(readFileSync(options.baseline, "utf8"));
    } catch (error) {
      console.error(
        `health-gate: cannot read baseline ${options.baseline}: ${(error as Error).message}`,
      );
      return 2;
    }
  }

  const decision = decideGate(report, baselineKeys);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          scope: report.scope,
          counts: report.counts,
          module: options.module ?? null,
          failed: decision.failed,
          failing: decision.failing,
          warnings: decision.warnings,
          regressions: decision.regressions,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(decision, options, report);
  }

  return decision.failed ? 1 : 0;
}

if (import.meta.main) process.exit(run());
