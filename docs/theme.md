# 主题（`--gpen-*` token）

## 两层：静态 CSS 兜底 + JS 控制

```text
src/lib/themes/
├── day-night.css     # 静态 token：:root/:host 白天 + prefers-color-scheme: dark 夜间
├── dockview.css      # dockview 桥：把 --dv-* 映射到 --gpen-*（只在工作区里生效）
├── theme.ts          # 纯函数：GPEN_TOKENS / readGpenTokens / applyGpenTokens / clearGpenTokens
└── theme.svelte.ts   # 响应式封装：initTheme / themeTokens / setThemeToken(s) / resetTheme
```

- **静态 CSS 是首屏兜底**：`day-night.css` 定义全部 `--gpen-*`，无 JS 时也正常渲染；
  夜间用 `@media (prefers-color-scheme: dark)` 覆盖。
- **JS 接管后是 source of truth**：`initTheme()` 先 `readGpenTokens()` 把当前生效的静态值读进
  `$state`，之后 `setThemeToken` / `setThemeTokens` 直接往目标元素写内联样式（`style.setProperty`）；
  `resetTheme()` 清掉内联样式，退回静态 CSS。

目标元素默认 `document.documentElement`；embed 传自己的 ShadowHost，读写的就是 `:host` 的那份。

```ts
import { initTheme, setThemeToken, themeTokens } from "#lib/themes/theme.svelte";

initTheme(); // onMount 里读一次（+layout 已调用）
setThemeToken("--gpen-panel-accent", "#e11d48"); // 之后 JS 说了算
themeTokens()["--gpen-panel-accent"]; // 响应式读取
```

> `theme.svelte.ts` 带 runes，**不进 `#lib` 桶**（否则非 Svelte 上下文 import `#lib` 会炸），
> 需要的地方直接 `import "#lib/themes/theme.svelte"`。`theme.ts` 是纯函数，从 `#lib` 导出。

## 约定

- token 只在这里定义一次；组件用 `var(--gpen-*)` 消费，需要局部变体时**覆盖变量本身**，不要新增
  “传具体值”的 props。
- 新增 token 要同时加进 `GPEN_TOKENS`（否则 JS 读不到 / 管不了）。
- 长度单位见 `AGENTS.md`：横向 `ch`、纵向 `lh`，字号/边框/圆角等保留 px。
- **两个布局基准 token**（都是无单位数，方便缩放）：
  - `--gpen-line-height`：既当 `line-height` 用，也是纵向基准。组件把自身的 `line-height` 设成它，
    于是 `1lh` 处处等值（水平数值控件高 `calc(2 * var(--gpen-line-height) * 1lh)`）。
    库内不要再把 `line-height` 写成字面值（`font: …/var(--gpen-line-height) …`）。
  - `--gpen-char-width`：竖向控件的宽度（ch 数），用 `calc(var(--gpen-char-width, 6) * 1ch)` 消费。

## token 分组

| 组             | token                                                                                    | 用在哪                                   |
| -------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| 排版 / 基准    | `--gpen-font-sans` / `-mono` / `-size` / `-line-height` / `-char-width`                  | 所有组件                                 |
| 面板表面       | `--gpen-panel-background` / `-foreground` / `-muted` / `-border` / `-accent` / `-shadow` | 面板本体、控件、菜单                     |
| 工作区外壳     | `--gpen-chrome-background` / `--gpen-chrome-background-subtle`                           | 菜单栏、状态栏、标题栏（tab 条）、工具条 |
| 面板内部次级面 | `--gpen-panel-background-raised` / `-hover` / `--gpen-panel-selection`                   | 卡片、胶囊按钮、输入、选中行             |
| 视口浮层       | `--gpen-viewport-overlay-background` / `-foreground` / `-shadow`                         | 小地图（浮在宿主网页上，不随配色方案变） |
| 形状           | `--gpen-radius` / `-sm`                                                                  | 控件圆角                                 |

`--gpen-workspace-background` 供工作区容器使用，默认 `transparent`：工作区铺满 `visualViewport`，
视口那一格是真正的“洞”，宿主网页从那里透出来，所以**容器不能有底色**，底色由各面板自己画
（细节见 `docs/panel.md`）。

## dockview 主题桥（`themes/dockview.css`）

dockview 用 `--dv-*` 变量描述 tab 条、sash、drop preview、浮动组。工作区不直接改它的结构样式，
只在 `GpenWorkspace` 里给 dockview 加一个 `gpen-dockview` class（`theme.className`），由
`themes/dockview.css` 把 `--dv-*` 指回 `--gpen-*`：

- `--dv-group-view-background-color` → `--gpen-chrome-background`（视口那一组再覆盖回 `transparent`）；
- `--dv-shape` 类变量（`--dv-floating-border` / `--dv-floating-box-shadow`）→ `--gpen-radius` / `--gpen-panel-shadow`；
- `--dv-tabs-and-actions-container-*` → chrome 底色 + 2lh 高度，并把 tab 当成 area header：
  去掉关闭按钮、活动 tab 用 accent 下划线；
- `--dv-drag-over-*` / `--dv-edge-dock-indicator-color` → `--gpen-panel-accent`；
- 面板分界：`.dv-groupview` 自带 1px inset `outline`（sash 静止时透明，hover 才显形）。

引入顺序必须在 `dockview/dist/styles/dockview.css` **之后**，否则 `--dv-*` 会被 dockview 自己的主题覆盖。
