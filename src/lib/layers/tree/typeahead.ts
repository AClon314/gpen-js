/**
 * Typeahead: jump to the next visible row whose `textValue` starts with the
 * typed prefix (case-insensitive), wrapping around past the end of the list.
 */
import { rowIndex } from "./rows.js";
import type { TreeKey, TreeRow } from "./types.js";

/**
 * @param from key the search starts *after* (usually the focused row); when it
 *   is not visible the search starts at the top of the list.
 * @returns the first matching key, or `undefined` when nothing matches.
 */
export function typeaheadKey(
  rows: readonly TreeRow[],
  from: TreeKey | undefined,
  query: string,
): TreeKey | undefined {
  const needle = query.toLowerCase();
  if (rows.length === 0 || needle === "") return undefined;

  const start = from === undefined ? 0 : rowIndex(rows, from) + 1;
  for (let offset = 0; offset < rows.length; offset += 1) {
    const row = rows[(start + offset + rows.length) % rows.length];
    if (row.textValue.toLowerCase().startsWith(needle)) return row.key;
  }
  return undefined;
}
