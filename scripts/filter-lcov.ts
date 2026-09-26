#!/usr/bin/env bun
/**
 * 过滤 lcov，仅保留本仓库内的 SF 段（就地或指定输出）。
 *
 * 背景（为什么必须过滤）：
 *   `bun test --coverage --coverage-reporter=lcov` 会为测试进程**加载过的每个
 *   文件**写一条 SF 记录，其中包含 `file:` 依赖 `../gpen-protocol` 里由
 *   FlatBuffers 生成的代码（本仓库实测 146 条中有 86 条来自仓库外）。
 *   `repowise coverage add` 无法把这些仓库外路径映射进代码树，未映射比例过半
 *   时会**以非 0 退出**（防止脚本把“覆盖率片段”误当成“整仓覆盖率”），
 *   从而中断 `test:coverage → repowise coverage add` 链路。
 *   这些文件不属于本仓库，本就不该计入本仓库覆盖率，因此直接丢弃。
 *
 * 用法：
 *   bun scripts/filter-lcov.ts [input] [output]
 * 默认 input/output 均为 `coverage/lcov.info`（即就地过滤）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

export interface FilterResult {
  /** 过滤后的 lcov 文本（仅含仓库内记录）。 */
  text: string;
  kept: number;
  dropped: number;
  /** 被丢弃的原始 SF 路径，便于日志/diagnosis。 */
  droppedPaths: string[];
}

/**
 * 保留解析后位于 `repoRoot` 内的记录，并把 SF 重写为仓库相对 POSIX 路径。
 *
 * 使用 `path.resolve` + `path.relative` 判边界（而不是字符串前缀），
 * 这样绝对路径、`./`、`../` 混入都能正确归类。
 */
export function filterLcov(text: string, repoRoot: string): FilterResult {
  const root = path.resolve(repoRoot);
  const records: string[] = [];
  const droppedPaths: string[] = [];
  for (const part of text.split("end_of_record")) {
    const match = /^SF:(.+)$/m.exec(part);
    if (!match) continue; // 末尾空块或没有 SF 的块
    const raw = match[1].trim();
    const rel = path.relative(root, path.resolve(root, raw));
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      droppedPaths.push(raw);
      continue;
    }
    const normalized = rel.split(path.sep).join("/");
    records.push(`${part.replace(/^SF:.+$/m, `SF:${normalized}`)}end_of_record`);
  }
  return {
    text: records.length > 0 ? `${records.join("\n")}\n` : "",
    kept: records.length,
    dropped: droppedPaths.length,
    droppedPaths,
  };
}

function main(): void {
  const [input = "coverage/lcov.info", output = input] = process.argv.slice(2);
  const repoRoot = path.resolve(import.meta.dir, "..");
  const result = filterLcov(readFileSync(input, "utf8"), repoRoot);
  writeFileSync(output, result.text);
  console.log(
    `filter-lcov: kept ${result.kept} record(s), dropped ${result.dropped} outside ${repoRoot}`,
  );
  if (result.dropped > 0) {
    const sample = result.droppedPaths.slice(0, 3).join(", ");
    console.log(`filter-lcov: dropped e.g. ${sample}${result.dropped > 3 ? ", …" : ""}`);
  }
}

if (import.meta.main) main();
