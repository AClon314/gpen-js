# 偏好设置（`GpenPreferences`）

状态：实现快照（2026-09-19，handoff T8）。

## 三层，各归各的落点

| 层 | 归属 | 落点 | 例子 |
| --- | --- | --- | --- |
| 用户偏好（跨文档 / 跨工作区） | `GpenPreferences` | `gpen.preferences` KV（**新根**） | 主题、语言、默认工具、显示状态栏、自动保存间隔 |
| 工具栏 / 会话 | 协议 `ToolbarState` | `Gpen.toolbarState`（文档 field 10） | 画笔尺寸 / 颜色 / 强度、橡皮模式 / 尺寸 |
| 工作区布局 | `GpenWorkspaceState` | `gpen.workspaceState` KV | panelLayout、immersive、ballPosition、uiScale、activeTool |

**必须是三个 KV 根**：`createKvStorage` 每个实例持有一份内存根、`submit()` 整根写回同一个
IndexedDB key，共用根会互相覆盖命名空间（`tests/gpenPreferences.test.ts` 有一条用例
开两个 runtime root 断言互不覆盖）。`uiScale` / `activeTool` **留在 workspaceState 不动**
（搬了要写迁移，收益为零）。

## 形状与校验

```ts
interface GpenPreferences {
  version: 1;
  theme: 'system' | 'light' | 'dark';
  locale: 'system' | 'en' | 'zh-cn';
  defaultTool: GpenToolId;
  showStatusBar: boolean;
  blur: boolean; // 磨砂玻璃（默认 false；见 theme.md）
  autoSaveDebounceMs: number; // 0..10000
}
```

- `normalizeGpenPreferences(value, fallback?)` **逐字段**校验并回退：一个坏字段不会把整份记录
  重置掉（旧版本写下的偏好里，它认识的部分必须留下）。
- `autoSaveDebounceMs` 会被 clamp 到 `[0, 10000]` 并取整；`NaN` / 非数字回退到默认。
- 适配器：`createKvGpenPreferencesStorage`（KV 根）/ `createMemoryGpenPreferencesStorage`
  （测试与降级）/ `createRuntimeGpenPreferencesStorage`（运行时 KV，**建不出来时降级到内存**，
  这样面板还能用而不是打开就抛）。

## 状态容器（`gpenPreferencesState.svelte.ts`）

runes 模块（不进 `#lib` 桶，理由同 `themes/theme.svelte.ts`）：`preferences()` /
`updatePreferences(patch)` / `resetPreferences()` / `loadPreferences()` / `closePreferences()`。

- **`updatePreferences` 必须丢弃等值 patch**：设置面板的 `InputSlider` 在 `$effect` 里发
  `onvalidvalue`，重新赋值 → 重渲滑条 → 再发同一个值 = `effect_update_depth_exceeded`
  （实测踩到，见下面「消融」）。
- `loadPreferences()` 幂等（`loadStarted` 守卫）：embed 反复挂载不会重新读盘、覆盖未保存的改动。
- 主题在 `+layout.svelte` 的 `onMount` 里 `initTheme()` 后立刻 `setThemePreference()`，
  并在 KV 读完后**再同步一次**——首屏不闪错配色。

## 面板形态：浮动，不是模态

`GpenWorkspace.openPreferences()`：

```ts
const existing = dockview.getPanel(PREFERENCES_PANEL_ID);
if (existing) { existing.api.setActive(); return; }   // 幂等，不开第二个
// 几何是纯函数（有单测）：夹到容器内 + 居中 + 四边留 16px，见 lib/components/workspaceLayout.ts
const bounds = centeredFloatingBounds(
  { width: instance.width, height: instance.height },
  { width: PREFERENCES_WIDTH, height: PREFERENCES_HEIGHT },
  FLOAT_MARGIN
);
dockview.addPanel({
  id: PREFERENCES_PANEL_ID,
  component: 'preferences',
  title: '偏好设置',
  floating: { ...bounds, dragHandle: 'titlebar' },
});
```

- ⚠️ **必须用 `addPanel({ floating })`，不要写成 `addPanel({initialWidth, initialHeight})` +
  `addFloatingGroup(panel)`。** dockview 8.2 的 `_doAddPanel`：没有 `position` / `floating` 时，
  它把面板开进 **active 组**，并在末尾对那个组调
  `group.api.setSize({ width: initialWidth, height: initialHeight })` —— 这一下就把**整个网格**
  重新分配了；随后 `addFloatingGroup` 把面板挪成浮窗，但网格尺寸**不会恢复**。
  实测（1280×720）：视口组 `918×442 → 860×200`、状态栏 `1218×24 → 420×406`、
  时间轴 `1218×188 → 420×48`，顶栏的「Airbrush」那一行被顶出容器。
  走 `floating:` 分支完全不碰网格（dockview 新建一个组直接挂成浮窗，`skipRemoveGroup: true`），
  实测开/关浮动面板前后所有网格组矩形**逐字节相同**。
  回归：`tests/e2e/preferences.e2e.ts` 的「opening the panel does not reflow the workspace grid」
  （快照所有非浮动组 + 顶栏两行的矩形做比对）。
- **`position` 与 `floating` 互斥**（同时传 dockview 会抛错）；`FloatingGroupOptions.position`
  的类型是 `AnchorPosition`（`TopLeft` / `TopRight` / `BottomLeft` / `BottomRight`），
  **没有 `'center'`**，传 `'center'` 编译报错、运行时落回默认左上角 `{left: 100, top: 100}`。
  所以居中坐标自己算，**夹取也得自己算**：`floatingGroupBounds: 'boundedWithinViewport'`
  只管用户拖动，初始请求大了它照放——消融实测（去掉夹取、直接请求 420×520）在 560×460 的
  容器里下边缘落到 519、在 360×340 里铺满到 418×492 @ (1,27)，全部测试仍然跑绿。
  所以这段几何被提成 `centeredFloatingBounds()` 并单测（`tests/workspaceLayout.test.ts`），
  e2e 再补一条「浮窗在视口内且水平居中」。
- **不进 `buildDefaultLayout`**：否则默认布局变大，且老用户存下的布局里没有它。
- **保留标题栏**（不加进 `:has(.blender-panel-...) > .dv-tabs-and-actions-container { display: none }`
  那组）：它是浮动的，需要标题栏当拖动手柄（`dragHandle: 'titlebar'`）。
- dockview 给浮动组的类名是 **`.dv-groupview-floating`**（没有 `.dv-floating` 容器）。
- 面板内容分四组：界面（缩放 / 主题 / 语言 / 状态栏）、工具（默认工具 + 画笔 + 橡皮，
  **直接绑协议 `ToolbarState`**）、文件（自动保存间隔、文档 id、落盘状态、清空）、重置。
- **属性面板与设置面板共用同一批 `aria-label`**（两边都绑同一份 `ToolbarState`），
  所以 e2e 里查值必须限定作用域（`.blender-panel-preferences` / `.blender-panel-properties`）。
  属性面板跟随当前工具（画笔显示「画笔直径 / 强度 / 间距」，橡皮显示「橡皮直径 / 强度」）；
  尺寸两边都用 `px` 直径表述（`BrushSettings.size` 是直径、CSS px，不做单位换算）。
- 关闭 / 重置：面板内「恢复默认偏好」调 `resetPreferences()` 并把 `ToolbarState` 的画笔 /
  橡皮重置为默认；「重置面板布局」复用 `gpen.reset_panel_layout`。

## 主题三态

见 [`theme.md`](theme.md)「三态」一节：`light-dark()` + `data-gpen-theme` 属性，没有
`@media (prefers-color-scheme: dark)` 覆盖块。

## 磨砂玻璃（`blur`，默认关）

`blur: true` → 面板 / chrome / 右键菜单半透明 + `backdrop-filter`，实现全在
[`themes/blur.css`](../src/lib/themes/blur.css)（token 覆盖 + filter），JS 只写
`data-gpen-blur` 根属性与容器 / 菜单上的一对 class —— 理由与「视口那个洞不能糊」的约束
见 [`theme.md`](theme.md)「磨砂玻璃」一节。

## 消融结论（实测）

1. **`effect_update_depth_exceeded`**：`InputSlider` 的 `onvalidvalue` 在 `$effect` 里触发，
   而文档 / 偏好一改就重渲滑条。修法是设置类写入的统一前置：
   `changedFields()`（`GpenWorkspace`）与 `changedPreferences()`（state 模块）丢掉等值 patch。
   顺带修掉「聚焦滑条就往 undo 里塞一条空记录」。删掉守卫立刻复现。
2. **`position: 'center'` 不存在**（见上）：改为自算居中坐标。
2b. **打开浮动面板会把整个网格重排**：`addPanel` 不带 `floating` 时会把
   `initialWidth/initialHeight` 应用给 **active 组**（`group.api.setSize(...)`），
   浮出去之后也不恢复 —— 表现是顶栏「Airbrush」那行被撑高/被顶出容器、视口与状态栏尺寸全变。
   改用 `addPanel({ floating })` 后完全不碰网格（e2e 逐字节比对所有非浮动组矩形）。
3. **`.dv-floating` 不存在**（见上）：e2e 断言按实测改成 `.dv-groupview-floating`。
4. **Esc 关掉整个工作区**：浮动的偏好面板开着时按 Esc 会冒泡到工作区的「关工作区」处理；
   改为捕获阶段的 Esc 优先收面板（见 [`commands.md`](commands.md)「Escape 的优先级」）。
5. **`@media (prefers-color-scheme: dark)` 顶掉手动 light**：媒体查询无法被属性覆盖；
   删掉媒体查询块，改为 `light-dark()`。不支持 `light-dark()` 的浏览器回落到普通值（降级不破版）。
6. **偏好写了读不回来**：`createRuntimeGpenPreferencesStorage` 没传 `kvKey`，落到默认 `"root"`，
   与工作区偏好的 `"gpen-root"` 不是同一格；同页面两个 runtime root 各持一份内存副本、
   各自整根写回同一个 IndexedDB key，互相覆盖。现在显式传 `kvKey: GPEN_PREFERENCES_KEY`，
   并有单测断言两个 root 互不覆盖（`tests/gpenPreferences.test.ts`）。
7. **打开设置面板会改文档**：面板里 `InputSlider` 的 `value` 回退成 `0`，被 `min={1}` 钳住后
   在 `$effect` 里回发 → 把默认 `toolbarState` 写进文档（实测 352 → 720 字节，还多一条 undo）。
   修法是回退值**必须等于协议默认值**（`DEFAULT_BRUSH_SIZE` 等），配合 `changedFields` 守卫；
   `preferences.e2e.ts` 有一条「打开面板前后文档字节数不变 + Ctrl+Z 能退回笔画」的回归。

## 自动保存间隔：真的接了

`autoSaveDebounceMs` 不是「只存不用」：`GpenWorkspace` 的落盘 `$effect` 比较
「当前偏好值」与「store 正在用的值」（`appliedDebounceMs`），不同就**重建 store**。
重建前**先把旧 store 挂起的写入 `commit()` 刷盘**，否则最后一次编辑会丢；
重建只在 `documentReady` 之后发生（load 期间不写盘）。

> 之所以要重建而不是改一个字段：`debounceMs` 是 `createGpenBinaryStore` 的构造参数。

## 已知缺口

- **语言**：`locale` 存下来、`normalize` 校验，但 Paraglide 的 `strategy` 目前只有
  `["cookie", "globalVariable", "baseLocale"]`（没有 `localStorage`），且 `setLocale` 默认
  reload；「切换语言」这一轮只落偏好、没接 `setLocale`。
- **`defaultTool`**：存下来并在面板里可选，但打开工作区时**没有**用它覆盖
  `workspaceState.activeTool`（那是会话记忆，见 `commands.md` 的「两个家一个主人」）。
