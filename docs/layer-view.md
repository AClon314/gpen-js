# 图层视图（相机 / 旋转 / 沉浸模式）

gpen 目前没有自己的绘图面：可视区里的宿主网页就是「Web 图层」，我们只往它上面投影
**视图变换**。本文记录这套投影的三件事：相机（平移）、旋转、沉浸模式，以及各自的
代价与已否决的替代。

相关实现：`canvas/infiniteCanvas.ts`（相机）、`layers/layerView.ts`（图层视图投影）、
`components/GpenWorkspace.svelte`（装配）、`components/areas/Viewport.svelte`（旋转入口）。

## 相机：绝对定位 spacer + 原生滚动

打开工作区时，`applyInfiniteCanvas()` 往 `document.body` 追加**一个**绝对定位的
spacer（`200000×200000`、`pointer-events: none`、`data-gpen-canvas-space`）：

```html
<div data-gpen-canvas-space style="position:absolute;top:0;left:0;width:200000px;height:200000px;pointer-events:none"></div>
```

平移**只有一层**：原生滚动。不搬 DOM、不动页面坐标系、不做「滚动 + transform」混合。

| 指标 | 旧方案（把内容搬进 `surface > origin`） | spacer |
| --- | --- | --- |
| 宿主 DOM | 内容被换父节点 | **零改动** |
| 内容坐标 | 变成 origin 里 100000px | **不变**（`getBoundingClientRect` 仍是页面几何） |
| `scrollY` 语义 | 假值 100000 | **0 = 页面顶部**（Home / 回到顶部正常） |
| 滚动条 | 被 `scrollbar-width: none` 隐藏 | **保留** |
| 原生选区 / 命中测试 | ✅ | ✅ |
| 打开工作区 | 页面跳一下 | **不跳** |

`scrollHeight` / `scrollWidth` 变大是这个功能的固有结果（要有更大的画布就有更大的
滚动范围），小地图把它当「画布范围」是明确语义；**别把它当页面真实几何用**。

### 限制：左上角一条边永远进不了洞

spacer 从文档原点起算，且 scroll 不能为负（实测 `scrollTo(0, -500)` 后 `scrollY`
仍是 0）。所以页面上 `x < rail 宽`（62px）或 `y < 菜单高`（66px）的像素永远滚不进
视口洞——是整条左列 + 整条顶行。右 / 下不受影响（滚下去就露出来）。

配套就是下面的**沉浸模式**：chrome 全部隐藏，洞扩到整个可视区，此时页面 `(0,0)` 也
可见可交互。兜底是**最小化**（能看不能画）。

### 已否决的替代（别再翻）

- `transform: translate` slack / 任何「滚动 + transform」混合：平移变两层机制。
- 流内 spacer（上下各一个）：实测与旧 wrapper 同族——`offsetTop` 0→100000、同一视觉
  状态下 `scrollY` 从 0 变 100000，页面「回到顶部」滚进空白，且往 body 插首/末兄弟会
  影响 `:first-child` 与 flex/grid body。
- A⇄流内 spacer 动态切换：等于在用户想看左上角的那一刻挪内容 ±100000 并重锚滚动。
- 原地绝对定位：页面坐标系被搬走。
- 顺带删掉了 `hideScrollbar` 那套（`html::-webkit-scrollbar` + `scrollbar-width` 写入）。

## 旋转 Web 图层：`rotate` + 视口中心枢轴

`layers/layerView.ts` 把图层投影成 `LayerView`：

```ts
createLayerView({ kind: "element", element })  // Web 图层（宿主网页元素）
createLayerView({ kind: "canvas" })            // 未来的 gpen 画布，无 DOM 变换
view.setRotation(20);                          // 绝对角度；0 = 还原
view.restore();                                // 恢复原始 transform-origin / rotate
```

旋转用**独立属性 `rotate`**，不用 `transform`。实测：

- `getComputedStyle(layer).transform` 始终不变（不覆盖页面自己的 transform）；
- 命中测试正常（`elementFromPoint` 仍返回页内元素），原生选区正常；
- overlay / chrome 完全不受影响。

### 枢轴不能省

默认枢轴是图层中心；Web 图层可以高到上万像素（首页 `main` 12624px），绕中心转 20°
会把正看着的那段甩出视口（实测视口空白、rect 跑到 `x≈-2138`）。所以枢轴 =
**旋转那一刻「视口中心」对应的图层内坐标**（`pivotAtViewportCenter`）。

实现细节：先把我们自己的 `rotate` 去掉，**同一个 task 内** `getBoundingClientRect()`
量未旋转的盒子（中间不会画帧），再写 `transform-origin` 与 `rotate`。

**动态枢轴（旋转过程中换枢轴）不在本轮范围**：改 `transform-origin` 会让已旋转内容
跳一下；要无跳变就得自己合成矩阵写 `transform`，那时还要处理与页面自身 transform 的
合成与恢复。以后做的时候把这个结论带上。

### DOM 赋值的已知副作用（写在这里免得再踩）

1. 图层一旦有非 `none` 的 transform，就成为 `position: fixed` 后代的包含块；
2. 产生层叠上下文；
3. `getBoundingClientRect()` 变成旋转后的 AABB——**所以 `guessWebLayer()` 只调一次**
   （`components/GpenWorkspace.svelte` 里在加 spacer 之前调用并缓存）；
4. 盒子尺寸不变，内容跑出盒子会被 `overflow: hidden` 裁掉；
5. 超大图层不要加 `will-change`；
6. 只有页面自身 `transform` 为 `none` 时才放心改 `transform-origin`——
   `layerView.setRotation()` 遇到页面自带 transform 会拒绝并返回 `false`。

真值放图层模型（协议 `LayerT.transform` / `parent_inverse`），DOM 只是投影；
`createLayerView()` 的「记住原值 + restore」是这套约定的实现。

## 沉浸模式

工作区状态位 `immersive`（`components/gpenWorkspaceState.ts`）。进入后
`.dockview-container.immersive` 把整棵 dockview 子树 `visibility: hidden`，视口洞
扩到整个 overlay；页面 `(0,0)` 从此可见可交互。退出入口：右下角浮起的「退出沉浸」
按钮，或 `Esc`（`Esc` 在沉浸模式里先退沉浸，不会顺手关掉工作区）。

与**最小化**（`collapsed`）的区别：

| | 最小化 | 沉浸模式 |
| --- | --- | --- |
| 触发 | 标题栏「最小化」，交还指针 | 标题栏「沉浸模式」（顺带等于 Blender 的最大化区域） |
| 可见性 | 工作区整体隐藏，只剩还原/关闭 | chrome 隐藏，洞 = 整个可视区 |
| 用途 | 看网页（不画） | 画满整个可视区（T4 起由画布接管） |

`immersive` 是持久化偏好；最小化 / 关闭 / 进入沉浸前都会显式清掉相反的状态，避免
「重新打开时仍无 chrome」这种死状态。
