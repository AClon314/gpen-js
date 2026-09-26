/**
 * `order-exports` —— 信息隐藏规范的机械化 codemod（见 `tmp/refactor.step1-3.md`）。
 *
 * 目标顺序（同一组内保持原有相对顺序）：
 *
 *   1. `import` / `import type`（`ts.isImportDeclaration` / `ImportEqualsDeclaration`）
 *   2. `export ... from` / `export { ... }`（`ts.isExportDeclaration`）
 *   3. 其余实现语句（含 `export function` / `export const` 这类「声明即导出」，
 *      它们不搬家，避免破坏 `const` 的 TDZ 依赖顺序）
 *
 * 只做 AST 级重排：按顶层语句切块，再把块按上面的分组稳定排序；注释、空行随
 * 所属语句一起移动。文件头的注释不会脱离，因为首个语句必须是 `import`（否则跳过）。
 *
 * 用法：
 *
 * ```bash
 * bun scripts/order-exports.ts           # 就地重排（只写有变化的文件）
 * bun scripts/order-exports.ts --check   # 只校验：顺序不对 / 具名导出缺注释 → 退出码 1
 * ```
 *
 * `--check` 同时校验「每个具名导出的上方有一行 JSDoc 注释」（列表形式则是每个
 * 标识符上方）。因为 `package.json` 冻结在本轮重构之外，没有把它接进 `lint`，
 * 需要时手动跑（见回报）。
 */

import ts from "typescript";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SRC = join(ROOT, "src");

/** 收集 `src` 下的 `.ts`（含 `.svelte.ts`），排除 paraglide 生成物、`*.d.ts`。 */
function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === join(SRC, "lib", "paraglide")) continue;
      collectFiles(full, out);
      continue;
    }
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

type Rank = "import" | "export-decl" | "impl";

function rankOf(node: ts.Statement): Rank {
  if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) return "import";
  if (ts.isExportDeclaration(node)) return "export-decl";
  return "impl";
}

/** 顶层语句的「块」：从上一语句结束到本语句结束，这样注释/空行跟着语句走。 */
function chunksOf(
  sourceFile: ts.SourceFile,
  statements: ts.Statement[],
): { node: ts.Statement; text: string }[] {
  const text = sourceFile.getFullText();
  return statements.map((node, index) => {
    const from = index === 0 ? 0 : statements[index - 1].getEnd();
    return { node, text: text.slice(from, node.getEnd()) };
  });
}

/** 返回重排后的全文；无需改动时返回 `undefined`。 */
function reorder(sourceFile: ts.SourceFile): string | undefined {
  const statements = sourceFile.statements.filter(
    (node) => node.getEnd() > node.getStart(sourceFile),
  );
  if (statements.length === 0) return undefined;

  // 文件头注释挂在首个语句之前：首个语句不是 import 时不动，避免把文件头搬到中间。
  if (rankOf(statements[0]) !== "import") return undefined;

  const weights: Record<Rank, number> = { import: 0, "export-decl": 1, impl: 2 };
  const indices = statements.map((_, index) => index);
  const sorted = [...indices].sort(
    (a, b) => weights[rankOf(statements[a])] - weights[rankOf(statements[b])],
  );
  if (sorted.every((value, index) => value === index)) return undefined;

  const chunks = chunksOf(sourceFile, statements);
  const text = sourceFile.getFullText();
  const tail = text.slice(statements[statements.length - 1].getEnd());
  return sorted.map((index) => chunks[index].text).join("") + tail;
}

function hasJSDoc(node: ts.Node): boolean {
  const docs = (node as { jsDoc?: ts.NodeArray<ts.Node> }).jsDoc;
  return docs !== undefined && docs.length > 0;
}

/** 取节点所在行号（1-based）。 */
type LineOf = (node: ts.Node) => number;

/** 声明即导出的具名声明种类。 */
type NamedExportStatement =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration;

function isNamedExportStatement(statement: ts.Statement): statement is NamedExportStatement {
  return (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  );
}

/** `export { a, b }` 列表里缺注释的标识符。 */
function missingDocsInExportList(statement: ts.ExportDeclaration, lineOf: LineOf): string[] {
  if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) return [];
  return statement.exportClause.elements
    .filter((element) => !hasJSDoc(element))
    .map((element) => `${lineOf(element)}: specifier ${element.name.text}`);
}

/** 声明即导出、且缺注释的语句。 */
function missingDocsInDeclaration(
  statement: ts.Statement,
  sourceFile: ts.SourceFile,
  lineOf: LineOf,
): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map(
      (declaration) => `${lineOf(declaration)}: variable ${declaration.name.getText(sourceFile)}`,
    );
  }
  if (!isNamedExportStatement(statement)) return [];
  return [
    `${lineOf(statement)}: ${ts.SyntaxKind[statement.kind]} ${statement.name?.text ?? "<anonymous>"}`,
  ];
}

/** 列出缺注释的具名导出：`<行号>: <kind> <name>`。 */
function missingDocs(sourceFile: ts.SourceFile): string[] {
  const missing: string[] = [];
  const lineOf: LineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      missing.push(...missingDocsInExportList(statement, lineOf));
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (hasJSDoc(statement)) continue;
    missing.push(...missingDocsInDeclaration(statement, sourceFile, lineOf));
  }
  return missing;
}

function main(): void {
  const check = process.argv.includes("--check");
  const files = collectFiles(SRC);
  let changed = 0;
  let bad = 0;

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true);
    const problems = missingDocs(sourceFile).map((item) => `  missing doc — ${item}`);

    const ordered = reorder(sourceFile);
    if (ordered !== undefined) {
      if (check) {
        problems.unshift("  statements are out of order (imports → export decls → implementation)");
      } else {
        writeFileSync(file, ordered);
        changed += 1;
      }
    }

    if (problems.length > 0) {
      bad += 1;
      console.error(`${relative(ROOT, file)}`);
      for (const problem of problems) console.error(problem);
    }
  }

  if (check) {
    if (bad > 0) {
      console.error(`\norder-exports: ${bad} file(s) violate the rule`);
      process.exitCode = 1;
    } else {
      console.log(`order-exports: ok (${files.length} files)`);
    }
    return;
  }

  console.log(`order-exports: reordered ${changed} file(s), ${bad} file(s) still missing docs`);
}

main();
