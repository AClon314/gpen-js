/**
 * Row filter for the outliner search box (case-insensitive substring match).
 * An empty or whitespace-only query matches nothing (not everything): the
 * caller renders the normal tree in that case.
 */
import type { TreeRow } from "./types.js";

/** 在行文本里做大小写不敏感的子串过滤（空查询返回空）。 */
export function searchRows(rows: readonly TreeRow[], query: string): TreeRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return rows.filter((row) => row.textValue.toLowerCase().includes(needle));
}
