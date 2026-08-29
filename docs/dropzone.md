# gpen 统一拖放目标检测

状态：设计稿，未来实现（2026-08-28）

## 结论先行

不要把 `interact.js.dropzone` 当作全局拖放检测器，也不引入 `Dropzone.js` 来解决 DOM 面板拖放。

Dockview 内部的 dropzone、docking、split、tab 重排和 docking preview 不属于本方案的实现范围。Dockview 已经内置这些能力，使用 `dndStrategy`、`dndEdges` 等选项即可启用，并通过 `onWillDrop`、`onDidDrop`、`onWillShowOverlay` 等公开事件接入 gpen。

建议实现一层轻量的原生 TypeScript `DropZoneRegistry`：

- Moveable、Dockview 或原生 Pointer Events 继续负责产生拖动；
- `DropZoneRegistry` 统一维护拖动会话、命中测试和 `enter/move/leave/drop` 生命周期；
- Dockview 内部的 tab、group、split 和 floating docking 仍由 Dockview 自己提交；
- Registry 只负责 Dockview 之外的 gpen dropzone，以及 Moveable/Dockview 与外部 gpen 目标之间的跨库拖放。

这样可以让不同拖动库在需要跨出自身边界时共享同一套 gpen dropzone 业务协议，而不要求它们产生同一种底层事件。对于 Dockview 内部目标，直接使用 Dockview 自己的 drop target 和 layout commit。

## 为什么不直接使用 `interact.js.dropzone`

`interact.js.dropzone` 的 drop 事件只会在 `interact.js` 自己的 `draggable` interaction 中产生。它能根据 Interact 的 drag 状态计算 `accept`、`overlap` 和 `checker`，但不会因为任意 DOM 元素的 `transform`、`left` 或 `top` 发生变化就自动开始检测。

Moveable 使用自己的 `dragStart`、`drag`、`dragEnd` 事件和手势系统。Dockview 也有自己的 HTML5 和 Pointer DnD backend。因此下面的组合不会自动联动：

| 拖动来源                   | `interact.js.dropzone` 是否能直接检测 | 处理方式                               |
| -------------------------- | ------------------------------------- | -------------------------------------- |
| `interact.js.draggable`    | 可以                                  | 可通过 Interact adapter 接入 Registry  |
| Moveable `draggable: true` | 不可以                                | 监听 Moveable 事件，转成统一拖动会话   |
| Dockview Pointer DnD       | 不可以                                | 监听 Pointer 路径或 Dockview 事件      |
| Dockview HTML5 DnD         | 不可以直接处理                        | 监听 `dragover/drop/dragleave/dragend` |

`interact.js` 仍可以作为某个拖动源的实现，但不应成为所有来源共用的 dropzone 层。

## 职责边界

### 拖动源负责什么

Moveable、Dockview 或其他拖动实现负责：

- 判断何时从 pointer down 进入拖动；
- pointer capture、触摸长按、拖动阈值和拖动 ghost；
- 更新被拖动对象的位置或预览；
- 提供拖动源标识和业务 payload；
- 在结束、取消或窗口失焦时通知上层。

同一个 pointer 手势只能由一个库负责移动和 pointer capture。不要让 Moveable、Interact 和 Dockview 同时把同一个 header 当作 draggable source。

### `DropZoneRegistry` 负责什么

Registry 只负责：

- 注册和注销 dropzone；
- 根据 viewport client 坐标查找当前目标；
- 维护当前目标和目标切换；
- 触发统一的 `enter`、`move`、`leave`、`drop`、`cancel` 事件；
- 执行业务层的 `accepts` 检查；
- 在拖动结束后清理预览和临时状态。

Registry 不负责：

- 移动、缩放或旋转源元素；
- 修改 Dockview 的 layout tree；
- 自动重设 DOM 父子关系；
- 文件上传或文件预览；
- 替代 Dockview 内部 docking 算法。

## 建议的数据模型

以下是未来实现的 API 草案，不是当前正式 API：

```ts
type DragSourceKind = "moveable" | "dockview" | "interact" | "native";
type DragInputKind = "pointer" | "html5";

type DragSession = {
  source: HTMLElement;
  sourceKind: DragSourceKind;
  inputKind: DragInputKind;
  pointerId?: number;
  x: number;
  y: number;
  payload?: unknown;
};

type DropZone = {
  element: HTMLElement;
  accepts?: (session: DragSession) => boolean;
  onEnter?: (session: DragSession) => void;
  onMove?: (session: DragSession) => void;
  onLeave?: (session: DragSession) => void;
  onDrop?: (session: DragSession) => void;
  onCancel?: (session: DragSession) => void;
};
```

Registry 未来可以提供类似下面的操作：

```ts
const registry = createDropZoneRegistry();

const dispose = registry.register(element, {
  accepts: (session) => session.sourceKind === "moveable",
  onEnter: showPreview,
  onLeave: hidePreview,
  onDrop: commitDrop,
});

registry.begin({
  source,
  sourceKind: "moveable",
  inputKind: "pointer",
  x: event.clientX,
  y: event.clientY,
});

registry.move({ x: event.clientX, y: event.clientY });
registry.end({ x: event.clientX, y: event.clientY });

dispose();
```

实际 API 需要在测试命中 nested dropzone、取消拖动和多窗口场景后再确定。

## 命中测试

默认使用 viewport 坐标和 `elementsFromPoint()`：

1. 按从上到下的顺序取得 pointer 下的元素；
2. 从每个元素向上遍历 `parentElement`；
3. 找到最近的已注册 dropzone；
4. 使用 `accepts(session)` 过滤不接受当前拖动源的目标；
5. 目标改变时触发旧目标 `leave` 和新目标 `enter`。

这种方式适合 tab、panel、浮动面板和有 CSS transform 的元素。Dockview 当前的 Pointer DnD 也采用了注册目标加 `elementsFromPoint()` 的思路。

如果某个 dropzone 需要“拖动对象与目标矩形相交”而不是“pointer 在目标内”，再使用双方的 `getBoundingClientRect()` 做补充判断。不能把 DOM 是否真的被 re-parent 当成 drop 成功条件，因为 Moveable 和 Dockview 都可能使用 transform 或 ghost 来表示拖动。

所有坐标统一使用 viewport CSS pixels：

- pointer 路径使用 `clientX/clientY`；
- HTML5 路径使用 `DragEvent.clientX/clientY`；
- 不直接混用 page coordinates、scroll coordinates 和 device pixels；
- 跨窗口或 popout 时按 source 的 `ownerDocument` 建立对应 Registry；
- iframe 和跨 origin 文档不自动跨越，需要宿主显式转发会话。

## 两条输入路径

### Pointer 路径

适用于 Moveable 和 Dockview Pointer backend：

- `begin`：由 Moveable `dragStart`、Dockview 拖动开始事件或已登记 source 的 `pointerdown` 触发；
- `move`：接收 `pointermove` 或 Moveable `drag` 的 `clientX/clientY`；
- `end`：接收 `pointerup`；
- `cancel`：接收 `pointercancel`、窗口 `blur`、文档 `visibilitychange` 或源库的取消事件。

Pointer 路径不应依赖原生 `dragenter`，因为 Pointer DnD 通常不会产生 HTML5 `DragEvent`。

### HTML5 路径

适用于 Dockview HTML5 backend 或未来的原生外部拖放：

- 监听 `dragenter`、`dragover`、`dragleave`、`drop` 和 `dragend`；
- 对接受当前 payload 的目标在 `dragover` 中调用 `preventDefault()`，否则浏览器可能不派发 `drop`；
- 从 Dockview 的事件 payload 或 `DataTransfer` 中取得 source 信息；
- 不假设 `dataTransfer.files` 存在，因为 Dockview panel drag 不是文件拖放；
- `drop` 与 `dragend` 都必须清理 Registry 的临时目标状态。

两条路径共用 `DropZone`、`accepts` 和生命周期回调，但不共用同一个原生事件监听器。

## 与 Moveable 的联动

Moveable 继续负责元素移动，adapter 只把它的事件转换成 Registry 的会话：

```ts
moveable
  .on("dragStart", (event) => {
    registry.begin({
      source: event.target as HTMLElement,
      sourceKind: "moveable",
      inputKind: "pointer",
      x: event.clientX,
      y: event.clientY,
    });
  })
  .on("drag", (event) => {
    registry.move({ x: event.clientX, y: event.clientY });
  })
  .on("dragEnd", (event) => {
    registry.end({ x: event.clientX, y: event.clientY });
  });
```

如果命中判断依赖移动后元素的矩形，应在 Moveable 更新样式后执行，必要时延迟到同一帧的 `requestAnimationFrame`。仅按 pointer 命中时不需要等待 DOM 布局更新。

Moveable 的 draggable 和 Interact 的 draggable 不应同时绑定同一手势。Moveable 可以继续提供 resize/rotate，而拖动由另一个明确的 header source 负责，但这个组合需要单独的 pointer 事件测试。

## 与 Dockview 的联动

Dockview 内部 docking 应保持由 Dockview 管理，Registry 不参与 Dockview 自己的 tab/group 拖动、方向 preview 或 layout commit。Dockview 已经内置 HTML5/Pointer DnD、drop target、split 和 tab/group 重排；gpen 只需要配置策略并接收公开事件。

未来需要把 Dockview 拖动接入 Dockview 外部 gpen dropzone 时：

- 使用 `onWillDragPanel`、`onWillDragGroup` 识别 Dockview 拖动源；
- 使用 `onWillDrop`、`onDidDrop`、`onWillShowOverlay` 处理或观察 Dockview 自己的 docking 结果；
- 使用 `onUnhandledDragOver` 或外部 dropzone adapter 处理 Dockview 未消费的目标；
- 对 Pointer backend 使用 pointer 坐标和 Dockview payload；
- 对 HTML5 backend 使用 `DragEvent`，不要假设存在 pointermove；
- 如果自定义 gpen dropzone 位于 Dockview 外部，Registry 才参与命中和提交；Dockview 内部目标不经过 Registry。

一个推荐的优先级是：

```text
Dockview 内部有效 docking 目标
        ↓
Dockview 自己提交 layout

Dockview 未消费 / Dockview 外部区域
        ↓
gpen DropZoneRegistry 处理
```

## 状态机

```text
idle
 └─ registered source + pointerdown / dragstart → armed

armed
 ├─ 超过拖动阈值 → active
 └─ pointerup / dragend → idle

active
 ├─ 命中目标 → target-entered
 ├─ 移到其他目标 → target-leave → target-entered
 ├─ 移出所有目标 → target-left
 ├─ pointerup / drop → commit → idle
 └─ pointercancel / blur / Escape → cancel → idle
```

命中目标只影响 preview 和业务事件，不应改变 source 的移动控制权。`Escape`、右键、窗口失焦和 `pointercancel` 必须能取消当前 drop，而不提交半成品布局。

## 与现有 gpen 面板设计的关系

该 Registry 属于几何/交互适配层，不持有 panel 业务数据。它应遵循 [`docs/panel.md`](./panel.md) 中的边界：

- panel definition、panel instance 和 layout tree 由 gpen 自己管理；
- drop preview 可以由 Dockview 或 gpen 渲染，但 layout commit 只能有一个 owner；
- toolbar、layer panel 和 canvas 的 pointer 事件边界由 gpen 决定；
- 位置、布局和文档状态继续分开持久化；
- 统一拖放协议的事件应携带 `origin: 'user' | 'api' | 'restore'`，若未来需要写入 layout。

文件拖放上传属于另一条业务链，不使用这个 Registry 代替文件上传组件。`Dropzone.js` 仍只能作为文件导入功能的候选依赖。

## 未来实施阶段

### Phase 0：协议和纯命中测试

- 定义 `DragSession`、`DropZone` 和 Registry 生命周期；
- 用 fake `clientX/clientY` 测试 nested target、accepts、目标切换和取消；
- 覆盖 CSS transform、滚动、隐藏目标和 `pointer-events`；
- 不引入 Moveable 或 Dockview 作为测试前置条件。

### Phase 1：Pointer adapter

- 接入 Moveable `dragStart/drag/dragEnd`；
- 接入原生 pointer source；
- 处理 pointer capture、pointercancel、blur 和多指输入；
- 验证 toolbar、layer panel 和 canvas 不互相吞掉事件。

### Phase 2：Dockview 内部配置 adapter

- 验证 `dndStrategy`、`dndEdges` 和 Dockview 的内置 drop target；
- 通过 Dockview 的公开事件接入 gpen panel model、持久化和业务状态；
- 确认 Dockview 自己完成 preview/commit，Registry 不参与内部 docking；
- 不直接依赖 Dockview 私有类或私有 DOM class。

### Phase 3：外部跨库 adapter

- 接入 Moveable 或 Dockview 到 Dockview 外部 dropzone 的 adapter；
- 若使用 Dockview HTML5 backend，测试 `dragover/drop/dragleave/dragend` 与 Pointer 路径的差异；
- 测试浏览器文件拖入时不会误触发 panel drop；
- 测试 iframe、popout、webview 和跨窗口限制。

## 验收清单

- [ ] Moveable 拖动可以触发统一的 enter/move/leave/drop 生命周期；
- [ ] Dockview 的 Pointer/HTML5 内部 docking 通过配置启用，且 gpen 不重复提交；
- [ ] Dockview 外部 dropzone 才使用 Registry 识别 Pointer/HTML5 拖动；
- [ ] nested dropzone 按视觉层级选择正确目标；
- [ ] `accepts` 可以区分 Moveable、Dockview、Interact 和文件来源；
- [ ] CSS transform、滚动、缩放和 visual viewport 下坐标一致；
- [ ] pointercancel、blur、Escape、dragend 都能清理状态；
- [ ] 同一手势没有多个库同时拥有 pointer capture；
- [ ] iframe、popout 和 Shadow DOM 的限制有明确降级行为；
- [ ] Registry 不直接持有或修改 panel、layer、stroke 业务数据；
- [ ] 不因新增 Registry 而引入 `Dropzone.js` 或让文件上传逻辑耦合进面板系统。
