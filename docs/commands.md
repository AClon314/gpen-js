# 命令注册表、菜单与快捷键

状态：实现快照（2026-09-19，handoff T7/T9）。

## 为什么命令和菜单分家

| 层 | 形状 | 谁消费 |
| --- | --- | --- |
| `commands` | 扁平注册表：`id` / `label` / `run` / `keyBind` / `when` / `enabled`，**可枚举** | 菜单、快捷键、（将来）命令面板、设置项 |
| `menus` | 树：节点引用命令 id（`{ command: "gpen.save" }`）或自带 `action` | 菜单栏、右键菜单 |

不合并的理由：菜单是**树**（有子菜单、分隔项、顺序），命令是**扁平可枚举**的集合。
合成一个结构就得让命令面板去遍历菜单树、或让菜单去猜命令的顺序。

**id 是点号**：`gpen.save`、`builtin.brush`、`addon.<vendor>.<op>`，等于协议
`ToolReference.idname`，零转换。

## 注册表（`lib/commands.ts`，纯逻辑）

```ts
registerCommand(command): () => void   // 返回 disposer
unregisterCommand(id): boolean
getCommand(id) / listCommands()        // listCommands 按 id 排序（稳定）
executeCommand(id): boolean            // when/enabled 为假 → false，不执行
```

- **后注册覆盖前者**，且 disposer 是 **token 专属**的：只有「自己仍是当前注册」时才删除。
  HMR 与 embed 反复挂载会先注册新的、后 dispose 旧的；按 id 删除会让旧实例拆掉新命令
  （`tests/commands.test.ts` 有一条用例专门盯这个）。
- **`when` vs `enabled`**：`when === false` = 不存在（隐藏）；`enabled === false` = 存在但不可用（灰掉）。
  两者都**抛错按 `false`** 处理并 `console.debug`——一个坏谓词不该炸掉整个菜单。
- `executeCommand` 对 `run()` 的**同步抛错返回 false**、**异步 rejection 被吞掉并记日志**：
  调用方是菜单点击或 keydown，没有地方向上抛。

## 快捷键（`lib/commands/keymap.ts` + `chord.ts`）

```ts
registerKeyBinding({ key: 'Ctrl+Z' | ['Ctrl+Shift+Z', 'Ctrl+Y'], command, when? }): () => void
installKeymapDispatcher(window?)   // 一个 keydown 监听，capture: false
```

- **和弦归一化**（`chord.ts`，纯函数）：`Ctrl` / `Cmd` / `Meta` / `Super` 全部 → `Mod`；
  `Option` → `Alt`；修饰键顺序固定（`Mod` → `Alt` → `Shift` → key）；键名大小写不敏感，
  并接受 `Esc` / `Space` / `Up` 这类别名。所以 `ctrl+z`、`Cmd+Z`、`MOD+Z` 是同一个和弦。
- **`+` / `-` 必须拼成 `Plus` / `Minus`**：`"Ctrl++"` 里的 `+` 与分隔符无法区分，
  所以它按「末尾空 token」处理（= 没有键，注册时直接抛 `TypeError`，不是静默失效）。
- **捕获阶段 false**：CodeMirror / 原生控件先看到事件；命中才 `preventDefault()` +
  `executeCommand`。
- **文本框跳过**：`isTextEntryTarget()` 是**全项目唯一**一份定义（duck-typing `tagName` /
  `isContentEditable`，所以对 iframe / shadow root 也成立、单测无需 DOM）。
- **binding 的 `when`** 是额外闸门，且**先于**消费事件求值；命令本身不可用时**不吃掉按键**
  （可用性由命令注册表裁决）。

## 菜单节点求值（`components/contextMenu/menuModel.ts`）

菜单层不执行命令，只做两件事：原样透传 id，以及**把命令的 `when` / `enabled` 合并进节点求值**。

- `resolveMenuVisible`：节点 `when` 为真 **且** 命令存在 **且** 命令 `when` 为真。
  引用了一个没注册的 id 的节点**不渲染**（否则就是「显示了但按不动」）。
- `resolveMenuDisabled`：节点 `disabled` 或 命令 `enabled === false`。
- `resolveMenuLabel`：节点没写 `label` 时回退到**命令自己的 label**。
- `resolveMenuKeyBind`：节点没写 `keyBind` 时回退到**命令注册表的 `keyBind`**。
  所以菜单上显示的 `Ctrl+S` 和真正生效的绑定同源，不会各写一份文案而漂移。
- `ContextMenu.svelte` 执行时：有 `command` 走 `executeCommand()`，否则跑 `action`。

## 菜单全铺（`components/menuBar.ts` + `workspaceCommands.ts`）

`menuBar.ts` 是**节点表**：8 个菜单（文件 / 编辑 / 渲染 / 窗口 / 帮助 / 切换 / 实用工具 / 设置齿轮），
每个菜单一个 provider（`registerMenuItems(id, provider)`，`TopBar` 在卸载时逐个 dispose）。

- **不许「点了没反应」**：没实现的项写 `todo(label, order, title)` = `disabled: true` +
  `title`（默认「尚未实现」）。`title` 会被 `ContextMenu` 渲染到节点上（灰掉只是视觉，
  hover 必须说明原因）。`tests/menuBar.test.ts` 与 `tests/e2e/menus.e2e.ts` 都逐项断言。
- **显示的快捷键必须真的注册**：`registerWorkspaceKeyBindings()` 绑
  `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` / `F2` / `Ctrl+S` / `Ctrl+N` / `Ctrl+O` /
  `Ctrl+Shift+O` / `Ctrl+Shift+S` / `Ctrl+Alt+U`。
- 真实现的项（✅）与灰掉的项（🔒）的完整对照见 handoff `tmp/919-night.md` §5.2。

### Escape 的优先级（踩过的坑）

Esc 是**三层共用的键**，必须显式定优先级，否则一次按键会触发多层：

1. **菜单**：`contextMenu.svelte.ts` 的 document 监听在关闭菜单时 `stopPropagation()`。
   不这么做的话，同一次 Esc 会冒泡到 `GpenOverlay` 的 `<svelte:window onkeydown>`
   （「关工作区」），表现为「按 Esc 收菜单，整个工作区没了」。
2. **浮动面板**：`GpenWorkspace` 用**捕获阶段**的 keydown 先收浮动的偏好面板。
   捕获阶段与注册顺序无关（冒泡阶段的两个监听都在它之后），所以不依赖谁先注册。
3. **工作区**：前两层都没接手时才关工作区。

## 已知缺口

- **Blender keymap 兼容**：T6 的 `wmEventType` 码表已经生成，但「用户键位覆盖 +
  keymap item 完整匹配（方向 / 值 / 重复）」没做；现在是「注册表内匹配 + 一个 window 派发器」。
- **命令面板 / 菜单搜索（F3）**：菜单里是灰的；等命令枚举稳定后单独做。
- **多平台键位**：`Ctrl` 与 `Cmd` 归一成 `Mod`，一个动作只有一条绑定，不做「每平台一条」。
