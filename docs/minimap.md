# 视图导航小地图（MiniMap）

状态：已实现（2026-09-19）。组件在 `src/lib/components/MiniMap.svelte`，投影数学在
`src/lib/viewportMap.ts`（纯函数，单测见 `tests/viewportMap.test.ts`）。

## 它是什么

视口（`areas/Viewport.svelte`）是 overlay 上的一个"洞"，里面不再放坐标轴 gizmo 和
`VIEWPORT` 角标，而是在**右上角**放一块导航小地图：

- 小地图把"一段文档范围"缩成一块小图，图里那格亮框 = 当前可见区域；
- 拖它 / 点它 / 用方向键都能平移视图；
- 现在映射的是**宿主网页的滚动范围**（拖动 = `window.scrollTo`，overlay 跟着
  `visualViewport` 走，所以工作区不动、洞里的内容在动）；将来画布自己管理平移时，
  把 `extent` / `viewport` 换成画布的那份即可，组件不知道是谁在滚。

## 组件契约

```ts
<MiniMap
  extent={{ width, height }}        // 被映射的总范围（CSS px，文档坐标）
  viewport={{ x, y, width, height }} // 当前可见区域（同一坐标系）
  label="视图"
  onNavigate={(origin) => …}         // 请求把视图左上角摆到 origin
/>
```

组件**不持有**视图状态、也不自己滚动：调用方喂 `extent` / `viewport`，用 `onNavigate`
把结果落回自己的坐标系。所有值都是文档坐标的 CSS px；`onNavigate` 的返回值已经
夹进文档范围（浏览器自己也会夹 `scrollTo`，这里夹一次是为了可测）。

## 投影规则（`viewportMap.ts`）

1. **覆盖范围 span** = 视图尺寸 × `MINIMAP_SPAN_FACTOR`（4），再夹到文档范围内。
   倍数越大看得越远、亮框越小。
2. **span 原点对齐到一个 span 网格**（`floor(中心 / span) * span`），而不是每帧跟着
   视图滑动。理由：跟着滑动的话亮框永远钉在正中央，拖动时没有任何反馈；对齐到网格后
   亮框会在地图里真的走动，跨格时地图重新对中（重新对中是不连续的，但拖动时"指针下的
   文档点"始终是视图中心，所以手感是连续的）。
3. **反解**：地图上的归一化点 `(nx, ny)` → 该点对应的文档坐标 → 让它成为视图中心 →
   夹进文档范围。两个轴各按自己的比例换算，所以小地图画成什么宽高比都不影响正确性。
4. **退化输入不产生 NaN**：文档为 0、视图为 0 时 `span` 为 0，投影退化成 0/1 的常数。

## 交互与无障碍

- `pointerdown` + `setPointerCapture` 拖动（`touch-action: none`，不抢页面滚动）；
  `pointercancel` / 抬起都结束拖动。
- 键盘：聚焦后方向键按视图尺寸的 1/10 平移；`role="application"` 是为了让方向键
  交给它自己处理（也因此豁免了 svelte 的两条 `a11y_no_noninteractive_*` 规则）。
- 视口整块是 `pointer-events: none` 的洞，只有小地图（`.minimap`）opt-in 回指针事件，
  所以洞的其他部分仍然是网页。
- 小地图浮在宿主网页上，用 `--gpen-viewport-overlay-*` 两个 token 绘制（不随白天/夜间
  变化，保证在任何网页背景上都可读）。

## 尺寸

卡片宽 `16ch`，地图高度由 `aspect-ratio`（= span 的宽高比）决定，并夹在
`min-height: 3lh` / `max-height: 10lh` 之间。极端宽高比时地图会被夹扁（视觉比例不再
忠实），但归一化映射不受影响——拖拽位置依然正确。
