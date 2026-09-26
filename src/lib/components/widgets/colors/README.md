# 颜色控件（Spectrum Web Components）

`src/lib/components/widgets/colors/`：**不自己写颜色选择器**，直接用 Adobe 的
[Spectrum Web Components](https://opensource.adobe.com/spectrum-web-components/)（Lit 自定义元素，
Apache-2.0，2026-09 时是 `1.12.2`）。

```text
src/lib/components/widgets/colors/
├── SpectrumTheme.svelte  # 把 <sp-theme> 限制在控件子树内（隔离 --spectrum-* 与 --gpen-*）
└── ColorPicker.svelte    # 面积图 + 色相条 + 十六进制字段 + 预览，双向绑定 #rrggbb
```

```svelte
<ColorPicker bind:value={layerColor} label="图层颜色" disabled={locked} />
```

## 用到的 SWC 元素与它们的行为

| 元素                     | 值语义                                        | 事件                       |
| ------------------------ | --------------------------------------------- | -------------------------- |
| `sp-color-area`          | `.color`（hex 格式回读）＋ `.x` / `.y`        | `input`（拖动中）/ `change` |
| `sp-color-slider`        | `.color` ＋ `.value`（色相 0–360）            | 同上                        |
| `sp-color-field`         | `.value`（文本）＋ `getColorValue()`          | 同上                        |

- 它们是**自定义元素，不是表单控件**：值走 property，不参与 `<form>` / `FormData`。
- 事件都 `bubbles` + `composed`，所以能穿过 shadow root 冒到 Svelte 的 `oninput`。
- **格式跟着写入格式走**：写 `#rrggbb` 就回读 `#rrggbb`（写 `rgb()` 则回读 `rgb()`），
  所以本组件一律写 hex，回读也就确定。

## 踩过的四个坑（都已在代码里处理）

1. **`sp-theme` 必须同时给 color 与 scale 两个片段**。只 `import theme-light.js`（color）时，
   依赖 scale token 的组件会量出 **0×0**（实测 `sp-swatch` 的 `--spectrum-swatch-size` 是空串）：
   ```js
   import '@spectrum-web-components/theme/theme-light.js'; // color 片段
   import '@spectrum-web-components/theme/scale-medium.js'; // ← 少了这行就 0×0
   ```
   两个片段各自是一份 CSS custom property 表（本仓库 light + dark + scale-medium 三份）。
2. **面积图的尺寸必须走 `--mod-colorarea-width/height`**，不能用普通 `width`/`height`：
   它内部手柄的位移量直接读这个变量
   （`.handle { transform: translate(calc(var(--mod-colorarea-width) - border)) }`），
   用 `width` 改尺寸会让手柄错位。色相条则可以用普通 `width`（手柄按百分比定位）。
3. **`sp-swatch` 不适合当装饰预览**：它默认是 `role="button"` + 可聚焦的可选项
   （要给正确语义得配 `sp-swatch-group` + `selects`），所以预览用自己的 `<span>` + 背景色。
4. **HSV 往返会有 ±1 的 RGB 漂移**：把面积图设成 `#22aa66`，它自己回读是 `#22ab67`
   （面积图按 HSV 管理，百分比分辨率有限）。所以：
   - 绑定的 `value` 以「用户最后操作的那个元素」为准，不要拿面积图的回读去覆盖另外两个；
   - 如果协议侧要求精确 RGB（`Vec3T` 是 0..1 浮点），要么接受 ±1，要么自己持有颜色状态、
     只把 SWC 当交互层。

## 与 gpen 的接缝

- **token 隔离**：`<sp-theme>` 只包住控件子树，Spectrum 的 `--spectrum-*` 不会漏进 `--gpen-*`。
  控件自己的外框（边框/圆角/内边距）仍用 `--gpen-*`，视觉上它是一块「Spectrum 风格的内胆」。
- **配色联动**：`SpectrumTheme` 按 `prefers-color-scheme` 切 `color="light|dark"`，
  与 `day-night.css` 的静态兜底保持同一判据（仓库还没有 JS 侧的主题开关）。
- **绑定值**：`#rrggbb` 小写。协议侧 `UiLayerTreeNode.color` 是 `Vec3T`（0..1 三通道），
  换算在调用方（demo 里有 `toVec3` 示例），控件不引入协议类型。
- **回声守卫**：拖动期间 SWC 元素是真值源、`value` 只是镜像；外部改值由 `observedValue` 比较
  推回元素（与 `InputNumber` / `CodeEditor` 同一套写法）。

## 无障碍（SWC 自带，实测可用）

- 色相条内部是**原生 `input[type=range]`**：`aria-label` + `aria-valuetext="220°"`，
  方向键步进 1、Shift 10 倍、Home/End 到 0/360 —— 所以 `getByRole('slider', { name })` 直接可用。
- 面积图给两轴各一组 `label-x` / `label-y`（本组件传「饱和度」「明度」，由 `label` prop 前缀）。
- 十六进制字段是有 label 的 textbox，自带非法输入反馈（对勾/警示）。

## 体积成本（实测，`bun run build`）

| | 不含颜色控件 | 含颜色控件 | 差 |
| --- | --- | --- | --- |
| JS 原始 | 983.8 KB | 1611.6 KB | **+627.8 KB** |
| 整站 gzip | 290.6 KB | 408.0 KB | **+117.4 KB** |

- `/demo/colors` 自己的路由 chunk 是 497.8 KB 原始 / 80.0 KB gzip（其余是 Lit 运行时等共享块）。
- **对 embed 目标要注意**：`bun run build:embed` 会把所有东西内联进单个 JS 文件，
  这 +0.6 MB 会落在每个宿主都要下载的那一个文件里。

## 明确不做 / 待办

- **alpha / 透明度**：当前只绑 `#rrggbb`。要支持得加一条 opacity 控件（SWC 有
  `sp-color-handle` + `opacity-checkerboard`，但没有现成的孤立 alpha slider），
  而且绑定值的形状要跟着变（`#rrggbbaa` 或 `{rgb, a}`）。
- **弹层版本**：现在是把取色器直接渲染出来（inline）。Blender 是「色块 + 弹层」，
  要弹层得处理 dockview / overlay 的层叠与 `pointer-events`（SWC 有 `sp-overlay`/`sp-popover`，
  也可以复用仓库自己的浮层做法）。
- **色彩空间**：只用 sRGB（hex）。OKLCH / 广色域、颜色拾取（吸管）都没做。
- 单位/命名：`widgets/colors/` 与 `widgets/inputs/` 平级；`ColorPicker` 目前不是
  `.web.svelte` 自定义元素（不对外暴露成 web component）。
