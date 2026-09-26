/**
 * CodeArea 面板的打开 / 清理策略（与组件解耦，方便单测）。
 *
 * 两条规则（成因见 `src/lib/components/codeArea/README.md`）：
 *
 * 1. **位置**：作为 `viewport` 组的**新 tab**（`direction: 'within'`），不新建组——不动网格布局。
 *    幂等：同源再开一次只 `setActive()`。
 * 2. **不跨会话保留**：数据源是活的 JS 对象，`toJSON()` 又没有 per-panel 开关，所以还原之后
 *    把它们摘掉，让紧接着的布局变更把干净版本写回存储。
 */
import type { DockviewApi } from "dockview";

import {
  codeAreaPanelId,
  codeAreaSourceIdOf,
  getCodeAreaSource,
  isCodeAreaPanelId,
} from "./source.js";

export {
  /** `codearea:gpen-kv` → `gpen-kv`；不是 CodeArea 面板时返回 undefined。 */
  codeAreaSourceIdOf,
};

/** 打开 / 聚焦一个 CodeArea 面板；`sourceId` 已注册时 tab 标题取数据源标题。 */
export function openCodeAreaPanel(instance: DockviewApi, sourceId: string): void {
  const panelId = codeAreaPanelId(sourceId);
  const existing = instance.getPanel(panelId);
  if (existing) {
    existing.api.setActive();
    return;
  }
  instance.addPanel({
    id: panelId,
    component: "codearea",
    title: getCodeAreaSource(sourceId)?.title ?? sourceId,
    position: { referencePanel: "viewport", direction: "within" },
  });
}

/** 摘掉从存储里还原出来的 CodeArea 面板（见文件头第 2 条）。 */
export function dropRestoredCodeAreaPanels(instance: DockviewApi): void {
  // `filter` 先拷一份：`removePanel` 会改 dockview 自己那份 panels 数组。
  const stale = instance.panels.filter((panel) => isCodeAreaPanelId(panel.id));
  for (const panel of stale) instance.removePanel(panel);
}
