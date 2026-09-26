import { describe, expect, test } from "bun:test";

import {
  baselineKeysFrom,
  buildBaseline,
  countByBiomarker,
  decideGate,
  findingKey,
  isFailingFinding,
  type HealthFinding,
  type HealthReport,
  parseArgs,
} from "../scripts/health-gate.ts";

/** 构造一条 finding，只覆盖断言关心的字段。 */
function finding(
  partial: Partial<HealthFinding> & Pick<HealthFinding, "biomarker_type">,
): HealthFinding {
  return {
    severity: "medium",
    file_path: "src/lib/example.ts",
    function_name: "doThing",
    ...partial,
  };
}

/** 内联假 JSON —— 本测试不真跑 repowise，只断言判定逻辑。 */
const FAKE_REPORT: HealthReport = JSON.parse(
  JSON.stringify({
    scope: "production",
    counts: "code_shape",
    metrics: [{ file_path: "src/lib/example.ts", score: 6 }],
    findings: [
      {
        biomarker_type: "large_method",
        severity: "low",
        file_path: "src/a.ts",
        function_name: "a",
      },
      {
        biomarker_type: "large_method",
        severity: "critical",
        file_path: "src/b.ts",
        function_name: "b",
      },
      {
        biomarker_type: "brain_method",
        severity: "high",
        file_path: "src/c.ts",
        function_name: "c",
      },
      {
        biomarker_type: "complex_method",
        severity: "medium",
        file_path: "src/d.ts",
        function_name: "d",
      },
      {
        biomarker_type: "complex_method",
        severity: "high",
        file_path: "src/e.ts",
        function_name: "e",
      },
      {
        biomarker_type: "complex_method",
        severity: "critical",
        file_path: "src/f.ts",
        function_name: "f",
      },
      {
        biomarker_type: "nested_complexity",
        severity: "medium",
        file_path: "src/g.ts",
        function_name: "g",
      },
      {
        biomarker_type: "nested_complexity",
        severity: "high",
        file_path: "src/h.ts",
        function_name: "h",
      },
      {
        biomarker_type: "low_cohesion",
        severity: "critical",
        file_path: "src/i.ts",
        function_name: "i",
      },
      {
        biomarker_type: "dry_violation",
        severity: "high",
        file_path: "src/j.ts",
        function_name: null,
      },
      {
        biomarker_type: "primitive_obsession",
        severity: "low",
        file_path: "src/k.ts",
        function_name: "k",
      },
    ],
  }),
) as HealthReport;

describe("isFailingFinding", () => {
  test("large_method / brain_method 任意 severity 都判失败", () => {
    expect(isFailingFinding(finding({ biomarker_type: "large_method", severity: "low" }))).toBe(
      true,
    );
    expect(isFailingFinding(finding({ biomarker_type: "brain_method", severity: "low" }))).toBe(
      true,
    );
  });

  test("complex_method / nested_complexity / low_cohesion 只在高严重度判失败", () => {
    for (const biomarker_type of ["complex_method", "nested_complexity", "low_cohesion"]) {
      expect(isFailingFinding(finding({ biomarker_type, severity: "critical" }))).toBe(true);
      expect(isFailingFinding(finding({ biomarker_type, severity: "high" }))).toBe(true);
      expect(isFailingFinding(finding({ biomarker_type, severity: "medium" }))).toBe(false);
      expect(isFailingFinding(finding({ biomarker_type, severity: "low" }))).toBe(false);
    }
  });

  test("策略外的 biomarker 即便 critical 也不判失败（交给 WARN）", () => {
    expect(
      isFailingFinding(finding({ biomarker_type: "dry_violation", severity: "critical" })),
    ).toBe(false);
    expect(isFailingFinding(finding({ biomarker_type: "bumpy_road", severity: "high" }))).toBe(
      false,
    );
  });
});

describe("decideGate", () => {
  test("无 baseline：FAIL 只收门禁命中项，WARN 收其余 medium+ 且互不重叠", () => {
    const decision = decideGate(FAKE_REPORT);
    expect(decision.failed).toBe(true);
    expect(decision.regressions).toEqual([]);
    expect(decision.failing.map((f) => `${f.biomarker_type}:${f.severity}`)).toEqual([
      "large_method:low",
      "large_method:critical",
      "brain_method:high",
      "complex_method:high",
      "complex_method:critical",
      "nested_complexity:high",
      "low_cohesion:critical",
    ]);
    // complex_method:medium、nested_complexity:medium、dry_violation:high 进 WARN；
    // primitive_obsession:low 两者都不进。
    expect(decision.warnings.map((f) => `${f.biomarker_type}:${f.severity}`)).toEqual([
      "complex_method:medium",
      "nested_complexity:medium",
      "dry_violation:high",
    ]);
    const failingKeys = new Set(decision.failing.map(findingKey));
    expect(decision.warnings.some((f) => failingKeys.has(findingKey(f)))).toBe(false);
  });

  test("空 findings 判 PASS", () => {
    const decision = decideGate({ scope: "production", counts: "code_shape", findings: [] });
    expect(decision.failed).toBe(false);
    expect(decision.failing).toEqual([]);
    expect(decision.warnings).toEqual([]);
  });

  test("with baseline：基线内 finding 不算回归", () => {
    const baseline = new Set(FAKE_REPORT.findings!.map(findingKey));
    const decision = decideGate(FAKE_REPORT, baseline);
    expect(decision.regressions).toEqual([]);
    // 失败仍由 FAIL 策略决定，baseline 不会豁免。
    expect(decision.failed).toBe(true);
  });

  test("with baseline：新增的 medium+ finding 判失败", () => {
    const baseline = new Set([
      findingKey(
        finding({
          biomarker_type: "large_method",
          severity: "low",
          file_path: "src/a.ts",
          function_name: "a",
        }),
      ),
    ]);
    const decision = decideGate(FAKE_REPORT, baseline);
    // 除 src/a.ts 外全部是新增，且其中含 severity ≥ medium 的项。
    expect(decision.regressions.length).toBeGreaterThan(0);
    expect(
      decision.regressions.every((f) => ["medium", "high", "critical"].includes(f.severity)),
    ).toBe(true);
    expect(decision.failed).toBe(true);
  });

  test("with baseline：只有低的、新增的 low finding 时不判失败", () => {
    const report: HealthReport = {
      findings: [finding({ biomarker_type: "primitive_obsession", severity: "low" })],
    };
    const decision = decideGate(report, new Set());
    expect(decision.regressions).toEqual([]);
    expect(decision.failed).toBe(false);
  });
});

describe("baselineKeysFrom / buildBaseline", () => {
  test("buildBaseline 输出的 keys 能被 baselineKeysFrom 原样读回", () => {
    const baseline = buildBaseline(FAKE_REPORT, "src/lib");
    expect(baseline.module).toBe("src/lib");
    expect(baseline.keys).toHaveLength(FAKE_REPORT.findings!.length);
    expect(baselineKeysFrom(JSON.stringify(baseline))).toEqual(new Set(baseline.keys));
  });

  test("支持 findings 形态与裸字符串数组形态", () => {
    expect(baselineKeysFrom(JSON.stringify({ findings: FAKE_REPORT.findings }))).toEqual(
      new Set(FAKE_REPORT.findings!.map(findingKey)),
    );
    expect(baselineKeysFrom(JSON.stringify(["k1", "k2"]))).toEqual(new Set(["k1", "k2"]));
    expect(baselineKeysFrom(JSON.stringify({ version: 1 }))).toEqual(new Set());
  });
});

describe("countByBiomarker", () => {
  test("按 biomarker × severity 计数", () => {
    const counts = countByBiomarker(decideGate(FAKE_REPORT).failing);
    expect(Object.fromEntries(counts.get("large_method")!)).toEqual({ low: 1, critical: 1 });
    expect(Object.fromEntries(counts.get("brain_method")!)).toEqual({ high: 1 });
  });
});

describe("parseArgs", () => {
  test("解析 --module 与 --baseline（含 = 形式与 bun run 的 -- 分隔符）", () => {
    expect(parseArgs(["--", "--module", "src/lib/layers"])).toMatchObject({
      module: "src/lib/layers",
    });
    expect(parseArgs(["--module=src/lib", "--baseline=tmp/b.json"])).toMatchObject({
      module: "src/lib",
      baseline: "tmp/b.json",
    });
  });

  test("缺值 / 未知 flag 抛错", () => {
    expect(() => parseArgs(["--module"])).toThrow();
    expect(() => parseArgs(["--nope"])).toThrow();
  });
});
