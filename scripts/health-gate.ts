#!/usr/bin/env bun
/**
 * repowise 健康度门禁 —— `bun run health:gate`。
 *
 * 数据来源（与 tmp/refactor.README.md 的「度量口径」一致）：
 *   repowise health --format json --scope production --counts code_shape
 * `--counts code_shape` 去掉 git 历史那一半（change_entropy / churn 等
 * “改得越多分越低”的信号），重构门禁只对**代码形状**负责。
 *
 * FAIL 条件（任一命中即退出码 1）：
 *   - large_method      任意 severity —— 项目「函数 ≤ 60 NLOC」规则的执行者
 *   - brain_method      任意 severity
 *   - complex_method    severity ∈ {critical, high}（CCN ≥ 15）
 *   - nested_complexity severity ∈ {critical, high}
 *   - low_cohesion      severity ∈ {critical, high}
 *   - 可选：--baseline <json> 时，任何**新增**的 severity ≥ medium finding
 *
 * 其余 severity ∈ {medium, high, critical} 的 finding 仅作 WARN 列出，不影响退出码。
 *
 * 已知边界：
 *   - repowise 的 NLOC 是**非注释/非空行**行数，不等于物理行数；且 large_method
 *     带 `CCN ≥ 3` 下限，所以“长而平”的函数不会被标记（repowise 的刻意设计，本项目接受）。
 *   - `repowise health` 每次都会重跑 ingestion（秒级），不是纯读缓存。
 *   - 覆盖率未 ingest 时 `coverage_gradient` 静默（“缺失 ≠ 0 覆盖”）。
 *
 * 用法：
 *   bun run health:gate
 *   bun run health:gate -- --module src/lib/layers
 *   bun run health:gate -- --baseline tmp/health-baseline.json
 *   bun run health:gate -- --baseline-out tmp/health-baseline.json   # 落盘基线
 *   bun run health:gate -- --json                                    # 机器可读
 */
import { readFileSync, writeFileSync } from "node:fs";

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
export const ALWAYS_FAIL_BIOMARKERS: readonly string[] = ["large_method", "brain_method"];
/** 仅 critical/high 才 FAIL。 */
export const SEVERITY_GATED_BIOMARKERS: readonly string[] = [
  "complex_method",
  "nested_complexity",
  "low_cohesion",
];
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

function runRepowiseHealth(modulePrefix?: string): HealthReport {
  const args = ["health", "--format", "json", "--scope", "production", "--counts", "code_shape"];
  if (modulePrefix) args.push("--module", modulePrefix);
  const proc = Bun.spawnSync(["repowise", ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = new TextDecoder().decode(proc.stdout);
  if (proc.exitCode !== 0) {
    const stderr = new TextDecoder().decode(proc.stderr);
    throw new Error(`repowise health exited ${proc.exitCode}\n${stderr || stdout}`);
  }
  try {
    return JSON.parse(stdout) as HealthReport;
  } catch (error) {
    throw new Error(`repowise health returned unparsable JSON: ${(error as Error).message}`);
  }
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

function printHuman(decision: GateDecision, options: GateOptions, report: HealthReport): void {
  const failCounts = countByBiomarker(decision.failing);
  console.log(
    `repowise health gate — scope=production counts=code_shape module=${options.module ?? "(all)"}`,
  );
  if (report.kpis) {
    const { hotspot_health, average_health, production_file_count } = report.kpis;
    console.log(
      `health: hotspot ${hotspot_health ?? "?"} / average ${average_health ?? "?"} (files ${
        production_file_count ?? "?"
      })`,
    );
  }

  console.log(`\nFAIL (${decision.failing.length}) — 命中门禁策略：`);
  if (decision.failing.length === 0) console.log("  (none)");
  for (const finding of decision.failing) console.log(`  ${describe(finding)}`);

  console.log(`\nWARN (${decision.warnings.length}) — severity ≥ medium、不判失败：`);
  if (decision.warnings.length === 0) console.log("  (none)");
  for (const finding of decision.warnings) console.log(`  ${describe(finding)}`);

  if (decision.regressions.length > 0) {
    console.log(
      `\nREGRESSIONS (${decision.regressions.length}) — 相对基线新增的 severity ≥ medium：`,
    );
    for (const finding of decision.regressions) console.log(`  ${describe(finding)}`);
  }

  console.log("\nFAIL by biomarker:");
  if (failCounts.size === 0) console.log("  (none)");
  for (const [biomarker, bySeverity] of failCounts) {
    const total = [...bySeverity.values()].reduce((sum, value) => sum + value, 0);
    console.log(
      `  ${biomarker.padEnd(19)} ${String(total).padStart(3)}  (${severitySummary(bySeverity)})`,
    );
  }

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

  const report = runRepowiseHealth(options.module);

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
