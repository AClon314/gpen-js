import ts from "typescript";
import { readFileSync } from "node:fs";

import { execSync } from "node:child_process";

const files = execSync(`find src -name '*.ts' -o -name '*.svelte'`, { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.includes("/paraglide/") && !f.endsWith(".d.ts"));

let totalExports = 0,
  withComment = 0,
  filesWithExportList = 0;
const noComment: string[] = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  if (f.endsWith(".svelte")) continue;
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) : undefined;
    const isExport = mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (st.kind === ts.SyntaxKind.ExportDeclaration) {
      filesWithExportList++;
      continue;
    }
    if (st.kind === ts.SyntaxKind.ExportAssignment) {
      totalExports++;
      continue;
    }
    if (!isExport) continue;
    const name = st.name?.getText(sf) ?? st.getText(sf).slice(0, 40);
    totalExports++;
    const ranges = ts.getLeadingCommentRanges(text, st.getFullStart());
    const has = ranges?.some((r) => text.slice(r.pos, r.end).startsWith("/**"));
    if (has) withComment++;
    else noComment.push(`${f}: ${st.kind} ${name}`);
  }
}
console.log({
  files: files.length,
  totalExports,
  withComment,
  missing: noComment.length,
  filesWithExportList,
});
console.log(noComment.slice(0, 60).join("\n"));
