# 复杂 call-graph 的文本渲染：orchgraph vs glyphcss-diagrams

> 2026-10-21。样本：`rules/cbm/dev/fixtures/callgraph-ts-hard` 的函数级 CALLS
> （15 个节点 / 13 条边，含分支、扇出、DAG 与一条误归属边）。两个工具都只拿到
> 同一张图，不比较数据提取质量。

## 结论

| 维度 | orchgraph | glyphcss-diagrams |
|---|---|---|
| 定位 | 通用图布局/渲染库（ELK） | 面向聊天的 ASCII/box 图 |
| 复杂图 | **适合**；ELK 分层、正交路由、标签完整 | **不适合**；约 9 节点以上就开始压缩/裁词 |
| 简洁度 | 中；有标题、状态点、圆角框，留白多 | **高**；纯 box 字符，无额外 chrome |
| 紧凑度 | 低；15 节点即 64–72 行 | **高**；默认 72×37，放大后 94×34 |
| 标签 | 完整，可换行 | 默认 72 列会裁词（`useGe/neric`、`UserR/epo`） |
| 大图策略 | 画布 + viewport/pan；可接 TUI | 自动加高、裁词；失败时要求拆成 6–8 节点 |
| 输出 | terminal / SVG / HTML，同一 geometry | 单段文本，直接贴聊天 |
| 依赖/集成 | npm 库 + elkjs，适合 Bun/TUI | 自带 renderer，Node 22，零安装 |

**一句话**：glyphcss 赢在“短”和“能贴”，orchgraph 赢在“复杂图还能读”。

## 实测

同一张 15 节点图：

| 输出 | 实际尺寸 | 字节 | 观察 |
| --- | ---: | ---: | --- |
| glyphcss 默认（72×24 预算） | 64×37 | 2.4 KB | 自动加高；9 个节点被裁词；边交叉明显 |
| glyphcss `--width 120 --height 40` | 94×34 | 3.4 KB | 标签完整，仍有交叉与长回边 |
| orchgraph DOWN / spacing 2 | 84×64 | 3.2 KB | 标签完整，分层清楚，但纵向留白很大 |
| orchgraph RIGHT / spacing 4 | 90×72 | 4.3 KB | 更宽、更高；适合 viewport 而不是整段粘贴 |

glyphcss 默认输出里 `useGeneric` 被拆成 `useGe / neric`，`UserRepo` 被拆成
`UserR / epo`；它的诊断也明确写了：

```text
Stopped expansion gutter search at its deterministic work limit.
Cut words across lines ... because no layout with whole words fit.
Expanded the canvas from 72x24 to 72x37 to keep the diagram connected.
```

orchgraph 的输出保留了完整标签，但 ELK 分层会把无依赖的节点推到单独层，
产生整屏空白；这是“布局正确”换来的“画布不紧凑”。它提供
`clampViewport` / `terminalViewportLines`，所以 TUI 里只显示视口，不要求
整张画布塞进一屏。

## 对 code-graph 的取舍

1. **全局 call graph**：不要用 glyphcss。节点数一上来就会裁词/拆图，无法表达
   全项目关系；orchgraph 的 ELK + viewport 更合适，但仍需模块聚合/过滤，
   不能直接把 5000 节点倒进去。
2. **局部 call graph**：glyphcss 很适合做“分享/聊天摘要”，尤其是选中函数的
   1–2 跳邻域（≤9 节点）；orchgraph 适合 TUI 里的可平移局部图。
3. **主线 UI**：仍然是 Svelte 2D 图；这两个库都不应该替代交互式画布。
4. **建议组合**：
   - B4 TUI：采用 orchgraph 的布局思路，或直接包一层它的 terminal renderer；
   - “复制为文本/贴 issue”：用 glyphcss 渲染小的 `GraphData` 子图；
   - 全局：cbm Galaxy/自研 2D + 聚合，不做全量文本图。

## 复现

```bash
# glyphcss
node /tmp/callgraph-compare/glyphcss-diagrams/skills/glyphcss-diagrams/scripts/render.mjs \
  /tmp/callgraph-compare/sample/hard.mmd --width 120 --height 40

# orchgraph
cd /tmp/callgraph-compare/orchgraph
bun src/cli.ts /tmp/callgraph-compare/sample/hard-orch.json --direction DOWN --spacing 2
```

样本输入在 `/tmp/callgraph-compare/sample/`；这是评测产物，不入库。
