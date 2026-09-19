/**
 * Row filter for the outliner search box (case-insensitive substring match).
 * An empty or whitespace-only query matches nothing (not everything): the
 * caller renders the normal tree in that case.
 */
import type { TreeRow } from "./types.js";

export function searchRows(rows: readonly TreeRow[], query: string): TreeRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  return rows.filter((row) => row.textValue.toLowerCase().includes(needle));
}
