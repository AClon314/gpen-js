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

## 工作区缩放变量（`--gpen-workspace-zoom`）

工作区把 `uiScale / 外部缩放` 的结果写在**根元素**（网页 `<html>`，embed 是 ShadowHost
——就是 `themeTarget()` 返回的那个）上，供**不在 dockview 子树里**的浮层跟上缩放：

```css
.contextMenu { zoom: var(--gpen-workspace-zoom, 1); }
```

- 消费者目前只有右键菜单（`components/contextMenu/ContextMenu.svelte`）：它挂在根 layout，
  拿不到 `.dockview-container` 那句 `style:zoom`，不跟上就会出现「chrome 2 倍大、菜单 1 倍小」。
- DOM 上必须分两层：**不缩放的定位壳**（`position: fixed` + 原始 client 坐标 + z-index）
  ＋**吃 `zoom` 的菜单本体**。原因是 `zoom` 会把元素**自己声明的** `left/top` 一起放大
  （实测：`fixed; left:100px; zoom:2` → 视觉 200px），所以坐标与缩放不能在同一层。
- 量尺寸一律用 `getBoundingClientRect()`（视觉 px）：`offsetWidth` 是未缩放的局部 px，
  拿它夹取会让菜单挂到视口外。夹取逻辑因此完全不需要知道缩放值。
- 读写入口在 `components/workspaceZoom.ts`（`setWorkspaceZoomVariable` /
  `readWorkspaceZoomVariable`）；写变量的是 `GpenWorkspace` 的 zoom effect，工作区卸载时收回 1。

## 磨砂玻璃（可选外观，默认关）

`GpenPreferences.blur` → `themes/blur.css`：面板 / chrome / 右键菜单半透明 +
`backdrop-filter: blur(var(--gpen-blur))`（`--gpen-blur` 是 `day-night.css` 里的形状 token，
已加进 `GPEN_TOKENS`）。

实现上只有两处 JS：

- `applyBlurPreference(enabled, target)` 写一个**布尔**根属性 `data-gpen-blur`
  （同 `data-gpen-theme` 的做法；`+layout.svelte` 里跟着偏好走），CSS 用它覆盖
  `--gpen-panel-background` 等 token 为半透明；
- `GpenWorkspace` 给容器加 `gpen-blur` class、`ContextMenu` 给自己加同一个 class ——
  `:host` 选择器带不了后代组合子，embed 目标里光靠根属性选不到内部的 `.dv-groupview`。

三条约束（写进 `blur.css` 的文件头）：

1. **视口的「洞」保持原样**（`.gpen-hole` 既不半透明也不加 filter）——它透出的是宿主网页，
   糊了就等于把洞补上；
2. 半透明与模糊必须一起给；
3. 整个文件包在 `@supports (backdrop-filter: blur(1px))` 里：不支持的浏览器保持不透明，
   而不是退化成「半透明但没模糊」的糊状。

代价：`backdrop-filter` 在移动端是 GPU 大头，且每个面板一层合成层 —— 所以默认关，而且
filter 只加在「组」这一层（不是每个面板内容各加一次）。实测截图见 `tmp/blur-on.png`
（工作区）与 `tmp/blur-on-menu.png`（右键菜单）。

## 三态：`system` / `light` / `dark`（2026-09-19）

`GpenPreferences.theme` 是三态，不是「一对解析好的 token」：`system` 必须与「用户手动选了
平台当前恰好一致的那一档」区分开。

实现只有一条：每个随主题变化的 token 用 **`light-dark(浅色, 深色)`** 声明一次，
`color-scheme` 决定取哪一支：

```css
:root,
:host {
	color-scheme: light dark; /* system：跟平台走 */
	--gpen-panel-background: light-dark(#ffffff, #1e293b);
}
:root[data-gpen-theme='light'],
:host([data-gpen-theme='light']) {
	color-scheme: light;
}
:root[data-gpen-theme='dark'],
:host([data-gpen-theme='dark']) {
	color-scheme: dark;
}
```

- `system` = **不写属性**（回到 `light dark`）；`light` / `dark` = JS 写
  `data-gpen-theme`（`applyThemePreference` / `setThemePreference`）。
- **不要用 `@media (prefers-color-scheme: dark)` 覆盖 token**：媒体查询无法被属性顶掉，
  手动选 `light` 会在深色系统上被媒体查询覆盖回去（实测）。这一轮把原来的媒体查询块删掉了。
- 不支持 `light-dark()` 的浏览器会丢掉那一行，回落到紧邻的普通值（只出浅色）——降级但不破版，
  所以每行都写了「普通值 + `light-dark()`」两条声明。
- `--gpen-workspace-background` 与视口浮层 token **故意不随主题**（洞要透明、浮层底下是别人的网页）。

`theme.svelte.ts` 里有两个互不重叠的旋钮：`setThemePreference` 选 `light-dark()` 的哪一支
（从不写 token 值），`setThemeToken(s)` 覆盖单个 token（从不改其它 token 走哪一支）。

> 早期版本用「JS 读一次静态 token，再整套写回内联样式」来表达主题，那样既要把调色板在 TS 里
> 再抄一遍，又表达不了 `system`（读回来的值看不出用户有没有做过选择）。`setThemeTokens`
> 现在只服务「换肤」这种真的需要覆盖单个 token 的场景。
