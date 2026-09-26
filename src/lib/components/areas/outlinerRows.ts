/**
 * Outliner 组件专属的纯决策层（无 Svelte / 无 DOM）。
 *
 * 树的行为层（展平 / 焦点移动 / 选择 / 拖放）在 `#lib/layers/tree`，组件只负责
 * DOM 事件与渲染。这里补的是「组件特有、但不需要 DOM」的三块：按键 → 意图、
 * 展开折叠的结构动作、以及「拖进自己子树」的词法判定。拆出来之后组件的
 * `handleKeyDown` / `applyMove` 只剩分派，这些规则也能在 `bun test` 里断言。
 */
import { rowByKey, type TreeKey, type TreeMove, type TreeRow } from "#lib/layers/tree/index.js";

/** 按下的修饰键（`KeyboardEvent` 的结构子集，便于单测构造）。 */
export interface KeyModifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** Outliner 上的按键意图；`undefined` 表示这个键不归树处理。 */
export type OutlinerKeyAction =
  | { kind: "move"; move: TreeMove }
  | { kind: "activate" }
  | { kind: "rename" }
  | { kind: "typeahead"; character: string };

/** 方向键 / Home / End → 焦点移动方向。 */
const MOVE_BY_KEY: Record<string, TreeMove> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
};

/** typeahead 缓冲的有效期：相邻输入超过这个间隔就重新开一段前缀。 */
export const TYPEAHEAD_TIMEOUT_MS = 700;

/** 是否按着 ctrl / meta / alt 中的任意一个。 */
function hasModifier(modifiers: KeyModifiers): boolean {
  return modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey;
}

/** 是否是不带修饰键的单字符（typeahead 的输入）。 */
export function isPlainCharacter(key: string, modifiers: KeyModifiers): boolean {
  if (key.length !== 1) return false;
  return !hasModifier(modifiers);
}

/** 把按键翻译成树上的动作（焦点移动 / 激活 / 重命名 / typeahead）。 */
export function outlinerKeyAction(
  key: string,
  modifiers: KeyModifiers,
): OutlinerKeyAction | undefined {
  const move = MOVE_BY_KEY[key];
  if (move !== undefined) return { kind: "move", move };
  if (key === "Enter") return { kind: "activate" };
  if (key === "F2") return { kind: "rename" };
  if (isPlainCharacter(key, modifiers)) return { kind: "typeahead", character: key };
  return undefined;
}

/** 展开集合的切换：已展开则折叠，否则展开（返回新集合，不改传入的）。 */
export function expandedAfterToggle(expanded: ReadonlySet<TreeKey>, key: TreeKey): Set<TreeKey> {
  const next = new Set(expanded);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** 左 / 右键停在当前行时触发的结构动作。 */
export type StructuralToggle = "collapse" | "expand";

/**
 * 左 / 右键停在当前行时是否要折叠 / 展开。
 *
 * `tree/keyboard.ts` 用「返回当前 key」同时表示结构动作和边界 no-op（第一行按 ↑
 * 等），只有调用方知道展开状态，所以这个判定放在组件这侧。
 */
export function structuralToggle(
  move: TreeMove,
  row: TreeRow | undefined,
  expanded: ReadonlySet<TreeKey>,
): StructuralToggle | undefined {
  if (row === undefined || !row.hasChildren) return undefined;
  if (move === "left") return expanded.has(row.key) ? "collapse" : undefined;
  if (move === "right") return expanded.has(row.key) ? undefined : "expand";
  return undefined;
}

/** 拖放合法性：`candidate` 是否在 `ancestor` 的子树内（含自身）。 */
export function isWithinSubtree(
  rows: readonly TreeRow[],
  ancestor: TreeKey,
  candidate: TreeKey,
): boolean {
  let cursor: TreeKey | undefined = candidate;
  while (cursor !== undefined) {
    if (cursor === ancestor) return true;
    cursor = rowByKey(rows, cursor)?.parentKey ?? undefined;
  }
  return false;
}

/** 把字符追加到 typeahead 缓冲；距上次输入过久则从该字符重新开始。 */
export function appendTypeahead(
  buffer: string,
  character: string,
  bufferAt: number,
  now: number,
): string {
  return now - bufferAt > TYPEAHEAD_TIMEOUT_MS ? character : buffer + character;
}
