# 图层树（Outliner）选型与接口设计

目标：`areas/Outliner.svelte` 里的图层树，要能承载 **多选 / 拖拽排序与入组 / 内联重命名 /
上千节点虚拟化**，并且**高可扩展**（行内容、展开箭头、拖拽把手都由调用方渲染）。
本文是选型调研 + 接口草案，**尚未实现**。

调研原件（未跟踪的草稿，细节更全）：`tmp/tree-reactaria.md`（52 KB，含源码级扩展点索引）、
`tmp/tree-webawesome.md`、`tmp/tree-elementplus.md`。

## 一、选型结论：自研，借 React Aria 的扩展点设计

| 候选 | 结论 |
| --- | --- |
| **React Aria `Tree` / `NavigationTree`** | **架构参考（不直接用，React-only）**：扩展点设计最完整——render props、slot 注入行为、可替换的集合渲染器、整层可注入的 DnD。 |
| Web Awesome / Shoelace `wa-tree` / `sl-tree` | ❌ 非受控「DOM 即状态」（折叠也保留全 DOM，每项一个 shadow root，热路径 `querySelectorAll` 是 O(n)）、**无虚拟化且架构不兼容**、多选只有级联复选框、**无拖拽**。它的 slot 分流技巧可以借。 |
| Element Plus `el-tree` / `el-tree-v2` | ❌ v1 全量 DOM + 组件持真相（实例方法式 CRUD）；v2 的**扁平化 + 定高虚拟化**值得抄，但它**没有 lazy、没有内置拖拽**（半成品），字段映射能力也回退成只收字符串。 |
| bits-ui / melt-ui | ❌ bits-ui 没有 tree 组件；melt-ui 已停更（2025-03，peer 只到 `5.0.0-next`）。 |

自研的理由（按重要性）：① 我们的数据是嵌套 `children` + `parent_index` + 协议字段
（`active` / `flags` / `color`），现成组件的形状约定会变成负担；② 视觉要走 `--gpen-*`，
三家都自带设计系统；③ a11y 要做的其实是**一份可枚举的规范**（APG tree pattern），
可以像 `numericCaret.ts` 那样抽成纯函数 + `bun test`，正好合「逻辑与框架解耦」的仓库约定；
④ 已有 `gestures/draggable` 与 `GpenPanel.web.svelte` 的先例。

## 二、三家横向对比（只记影响设计的差异）

| 维度 | React Aria | Web Awesome | Element Plus v2 |
| --- | --- | --- | --- |
| 数据形状 | `items` + `children(item)`（集合 API，可混用 `<Collection>`） | 纯嵌套 `<wa-tree-item>`（DOM 即状态） | 嵌套数据 + `props{value,label,children}` 字段映射 |
| 状态 | `TreeState`（`collection/expandedKeys/selectionManager/…`）+ 统一 `controlled/default/onChange` | 属性 + 事件，无可注入 store | 内部 store + 实例方法（`setExpandedKeys/scrollToNode`） |
| 行内容扩展 | `TreeItemContent` 收 render props；`slot="chevron\|selection\|drag"` 注入行为 props | 一个平铺 slot（固定四段布局，无尾部操作 slot） | default slot `{node}` |
| 拖拽 | 整层可替换：`dragAndDropHooks` + `DropTargetDelegate` | ❌ 无 | ❌ 半成品（只 emit `node-drop`） |
| 虚拟化 | 外层 `<Virtualizer>`，无 tree 专用 layout | ❌ 架构不兼容 | ✅ 扁平化 + 定高 `FixedSizeList` |
| 懒加载 | 1×1 哨兵元素 + `hasChildItems` 占位 | `lazy` + `wa-lazy-load` | ❌ 无 |
| a11y | `role=treegrid` + `gridcell` + `display:contents`（我们有异议） | `tree/treeitem/group` + `aria-selected/expanded/busy`，**缺 typeahead 与 `aria-setsize/posinset/level`** | 有 ARIA 但无 typeahead 文档 |
| 扁平化 | 行是兄弟（`--tree-item-level` 表层级） | 真实 DOM 嵌套 | `flattenTree` → 一维数组（虚拟化前提） |

## 三、要照搬的扩展点（这是「高可扩展」的答案）

1. **slot 机制 = 行为在库、DOM 在你。** `<Button slot="chevron">` 只声明「这是展开按钮」，
   库把 `expandButtonProps`（`aria-expanded`、键盘处理、ref 注册）注入进来；`slot="drag"` 同理，
   并额外 `pointer-events:none` 让指针事件落到行上。
   → Svelte 5 对应：`{#snippet chevron(props)}` / `{#snippet dragHandle(props)}`，
   库通过 context/参数下发行为 props，调用方自己渲染图标。
2. **一个 `renderState` 对象下发全部渲染状态**（不是一堆散装 boolean），同时喂给
   `className/style` 函数、`data-*` 与行内 slot —— 保证按状态渲染在任何替换深度都一致。
3. **`data-*` + CSS 变量暴露状态，不用 JS 算样式**：`data-selected/expanded/dragging/drop-target` +
   `--tree-item-level`（缩进用 `calc((level - 1) * var(--indent))`）。与仓库
   「覆盖变量本身而不是新增传值 props」的约定完全一致。
4. **受控/非受控统一三件套**：`controlled / default / onChange`，且**受控存在时忽略 default**。
   Svelte 侧即 `$bindable()` + `onExpandedChange`：bindable 优先、`default*` 只作初值、回调总是触发。
5. **扁平化只有一个派生入口**：`expandedKeys` → `visibleRows` 由一个 `$derived` 产出，
   组件层不许再算一遍（RAC 在这里重复实现了两遍，源码注释自嘲）。
6. **拖拽用纯数据契约 + 可替换的落点解析**：
   `DropTarget = {type:'root'} | {type:'item', key, dropPosition:'on'|'before'|'after'}`，
   `getDropTargetFromPoint(x, y, isValid)` 是唯一把指针变成它的地方（可替换），
   业务只处理 `onMove`（跨层级）/ `onReorder`（同级）。RAC 的树专用 delegate 用 X/Y 阈值
   （10px / 5px）切换「入组 / 同级 / 祖先同级」——正是 Blender Outliner 的拖拽语义。
7. **`shouldAcceptItemDrop` + `getDropOperation`**：细粒度否决（禁止拖进自己的后代）与
   copy/move/link 决策 —— 对应 Blender 的「拖到组上=入组、组间=排序、加修饰键=复制」。
8. **悬停自动展开 + 拖拽时按展开键展开**：拖拽排序的体验刚需，位置在落点配置里，不侵入业务。
9. **内联重命名的官方组合**：`textValue`（给 typeahead / 无障碍的字符串）**与显示内容解耦** ——
   重命名时 DOM 换成输入框，但集合仍知道这一行的文本值；输入框用 `focusMode="child"` 拿焦点。
   重命名状态**不进 tree state**（RAC 也没进）：用独立 UI state，提交时走 `layerOps`。
10. **选区集中在一个 store**（`SelectionManager` 单一事实来源）：`selectionMode/behavior/
    disallowEmptySelection/disabledKeys` 全在一处解释，行组件只问 `isSelected(key)`。
11. **`tree` 用全局唯一 key**（我们的 `node_index` 满足）。
12. **懒加载用哨兵元素**而不是 scroll 监听；`hasChildItems` 让「未加载也知道有子节点」成立，
    但加载逻辑必须幂等（RAC 自认 `onLoadMore` 会重复触发）。

## 四、反面教材（避开）

- **变体组件不要靠 `Omit<Base, …>` 继承**：RAC 的 `NavigationTreeProps` 是 14 项 `Omit` + 重声明，
  基类每加一个 prop 就会静默继承（类型通过但语义错）。变体应显式列出接受的 props。
- **别把 19 个 `onMouse*/onPointer*/onTouch*` 灌进公开 props 表**：DOM 透传用 `...rest`，
  真正要文档化的是扩展点。
- **别用「集合兄弟数减一」推断层级**（RAC 的 `hasChildItems` 依赖 content 节点也在集合里）；
  用显式字段（我们的 `children.length`）。
- **不要选 `role=treegrid` + `gridcell` + `display:contents`**：对纯层级列表太重，
  且 `display:contents` 有历史无障碍 bug。我们用 `tree` / `treeitem`。
- **别让「布局引擎不认识层级」**：RAC 虚拟化时缩进只能写在 CSS 变量里、drop 指示线依赖可选实现。
  我们的行布局器应**把 `level` 纳入布局计算**（缩进直接影响可用宽度与命中测试）。
- 开发期契约（必须有 `textValue`、必须给 chevron）应当由类型或 dev 断言立刻暴露，而不是只 `console.warn`。

## 五、给 gpen 的接口草案（Svelte 5 + 纯函数行为层）

分三层，**行为层是纯函数**（可 `bun test`，与 `numericCaret.ts` 同一套路）：

```ts
// ① 纯函数行为层（src/lib/layers/tree/*.ts，无 Svelte / 无 DOM）
interface TreeRow { key: Key; parentKey: Key | null; level: number; hasChildren: boolean;
                    textValue: string; data: UiLayerTreeNode; }

function visibleRows(tree: UiLayerTreeNode[], expanded: ReadonlySet<Key>): TreeRow[];
function nextFocusKey(rows: TreeRow[], current: Key, move: 'up'|'down'|'left'|'right'|'home'|'end'): Key;
function typeaheadKey(rows: TreeRow[], from: Key, query: string): Key | undefined;   // WA/RAC 都没做全
function selectionAfter(rows: TreeRow[], selected: ReadonlySet<Key>, key: Key,
                        modifiers: { shift: boolean; ctrl: boolean }): Set<Key>;
function dropTargetFromPoint(rows: TreeRow[], point: {x: number; y: number},
                             layout: RowLayout, isValid: (t: DropTarget) => boolean): DropTarget | null;
function applyDrop(tree: UiLayerTreeNode[], keys: Key[], target: DropTarget): Op[];  // 只产 op，不改数据
```

```svelte
<!-- ② 组件层：State（唯一真相）→ 虚拟化排布 → 行 → 行内容 -->
<LayerTree items={tree} bind:expandedKeys bind:selectedKeys bind:activeKey
           onMove={...} onReorder={...} dnd={hooks}>
  {#snippet row(state)}                       <!-- state: RowRenderState（一个对象，含 level/isSelected/…） -->
    <LayerRow {...state}>
      {#snippet chevron(props)}<IconChevron {...props} />{/snippet}
      {#snippet label(props)}{#if state.isRenaming}<Input bind:value={draft} />{:else}{state.textValue}{/if}{/snippet}
      {#snippet dragHandle(props)}<IconGrip {...props} />{/snippet}
    </LayerRow>
  {/snippet}
  {#snippet dragPreview(rows)}…{/snippet}
  {#snippet dropIndicator(target)}…{/snippet}
  {#snippet empty()}…{/snippet}
</LayerTree>
```

- **`RowRenderState`**：`isSelected / isActive / hasActiveDescendant / isExpanded / isDragging /
  isDropTarget / isFocused / isFocusVisible / isRenaming / level / hasChildren / allowsDragging /
  selectionMode / selectionBehavior`，同时驱动 `data-*`、CSS 变量与 snippet 参数。
- **受控三件套**：`bind:expandedKeys`（`$bindable`）+ `defaultExpandedKeys` + `onExpandedChange`；
  选区同理。语义：bindable 优先、default 只作初值。
- **虚拟化**：`RowLayout` 接口（`rowSize` / `gap` / `layout(rows, viewport)`）可替换，
  默认 `ListLayout`（定高）；非等高行（分组行）换自己的 layout，**缩进参与宽度计算**。
- **a11y 清单**（`role=tree` 路线）：`tree` + `treeitem`；行上 `aria-level`（1 基）、
  `aria-expanded`（**仅当 `hasChildren`**）、`aria-selected`（仅当可选中）、`aria-busy`（加载中）；
  多选时 `tree` 带 `aria-multiselectable`；键盘 `↑↓ ←（收起/去父）→（展开/进首子）Home End *（展开同级）
  + typeahead + Enter/Space + F2 重命名 + Shift/Ctrl 点选`；roving tabindex。
  `aria-setsize/posinset` 可选（DOM 嵌套已表达层级，WA 与 RAC 都没给全）。

## 六、待决问题

1. **多选语义**：Blender 是「单击选中 + Shift 范围 + Ctrl 切换 + `active`（最后点击项）与 `selected`
   分离」；我们是否也把 `active`（`UiLayerTreeNode.active`）与 `selectedKeys` 分开？
2. **虚拟化与内联重命名/拖拽的冲突**：行被回收时输入框会丢焦点 → 是否需要「重命名期间禁用虚拟化」或
   把编辑态挂到固定层。
3. **拖拽与 dockview / overlay 的关系**：`pointer-events: none` 的透传策略、跨面板拖拽、
   拖到 viewport（Blender 的「拖到画布上」）要不要支持。
4. **是否要 `sp-tree`/WA 的 slot 分流技巧**：`wa-tree-item` 在 `connectedCallback` 里自动
   `slot="children"`，让父级默认 slot 只装该行的内容 —— 我们用 snippet 方案后不需要这招，但值得记住。
5. **懒加载**：我们的图层树来自内存中的协议文档（`buildLayerTree`），暂时没有分页需求；
   若将来接大文档，按「哨兵 + 幂等加载」设计。
