/**
 * `CodeEditor` 的视图保持：外部改值时，把 caret 与滚动位置留在原地。
 *
 * 这条链路踩了两个坑，两个都有实测证据：
 *
 * 1. **整篇替换（`from: 0, to: len`）的映射是退化的**：CM 会把 viewport 映射到顶部、
 *    把 selection 夹到 0，于是每次外部更新都把用户正在看的位置弹回开头。事后再写
 *    `scrollTop` / `selection` 也不够 —— CM 下一轮 measure 会把映射结果重新应用一遍
 *    （实测：同步写回 400，16ms 后又被清成 0）。
 * 2. **「只改变了的那一段」也不够**：公共前缀 / 后缀裁剪出的是**单段**变更，而实时树里
 *    同时会有好几处数字变了（首个差异到最后一个差异之间全算这段），于是这段经常跨过
 *    caret 与视口顶，CM 仍然会把它们夹到变更边界。
 *
 * 所以 `CodeEditor` 在 `preserveViewOnExternalChange` 下的做法是两件一起做：先用
 * `minimalTextChange` 把变更压到最小（能局部的就局部），再把 selection 与滚动位置显式
 * 恢复（同步一次 + 下一帧一次，后者赶在 CM 那轮 measure 之后）。
 *
 * 单独成文件是为了能在 `bun test` 里直接跑（不依赖 DOM）。
 */
import { EditorSelection } from "@codemirror/state";

export interface TextChange {
  /** 替换起点（旧文档坐标）。 */
  from: number;
  /** 替换终点（旧文档坐标，不含）。 */
  to: number;
  /** 插进 `from..to` 的新文本。 */
  insert: string;
}

/**
 * 公共前缀 / 后缀裁剪：返回把 `before` 变成 `after` 的最小单段变更。
 *
 * 单段是刻意的：多段 diff（LCS / Myers）对「JSON 树里改了几个数字」没有额外收益，却要多
 * 几百行和一堆边界；前后缀裁剪在这些场景下已经把变更压到最小（改一处 = 一处变更）。
 */
export function minimalTextChange(before: string, after: string): TextChange {
  if (before === after) return { from: 0, to: 0, insert: "" };

  const maxPrefix = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < maxPrefix && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;

  // 后缀不能与前缀重叠（否则会把已判定相同的部分算两次）。
  const maxSuffix = Math.min(before.length, after.length) - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1;
  }

  return {
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  };
}

/**
 * 把替换前的 selection 夹到 `length` 之内；多 range（多光标）逐个夹，主 range 保持不变。
 *
 * 单段变更可能整块盖住 caret 所在的那段文本（见文件头第 2 点），CM 会把 caret 夹到边界；
 * 这里改成夹到**旧偏移**：内容变了行号本来就会漂，「尽量保持」到这个程度就够了。
 */
export function clampSelectionToLength(
  selection: EditorSelection,
  length: number,
): EditorSelection {
  const limit = Math.max(0, length);
  const ranges = selection.ranges.map((range) =>
    EditorSelection.range(Math.min(range.anchor, limit), Math.min(range.head, limit)),
  );
  return EditorSelection.create(ranges, selection.mainIndex);
}
