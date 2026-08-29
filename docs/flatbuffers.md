# FlatBuffers 接入与边界

状态：协议生成链、TypeScript accessor、gpen-js codec/storage 和跨端 fixture 已接入；gpen-zig 的 accessor 已按当前 schema 重生成并通过测试。

这份文档记录当前事实、生成物归属、协议数据边界和跨端验证约定。实现时以这里的结论为准；不要把旧的未维护说明或目标路径当成当前 API。

## 结论

`gpen-protocol` 已经有从 TypeSpec 到 FlatBuffers schema 的生成链，并已生成、发布供 `gpen-js` 使用的 TypeScript accessor。当前链路是：

```text
gpen-protocol/protocol/v1/*.tsp       # 唯一事实来源
        │ tsp compile .
        ▼
protocol/gpen/v1.proto                 # 生成的 protobuf，中间产物
        │ scripts/build-fbs.mjs
        │ flatc-wasm
        ▼
schema/gpen/v1/model.fbs               # 已生成并提交的 FlatBuffers schema
        │ flatc --ts / FlatcRunner.generateCode
        ▼
generated/flatbuffers/gpen/v1*.ts     # 生成、导出并锁定的 TS accessor
        │
        ▼
gpen-js codec → storage / crossTabBus / layer adapter
```

`gpen-protocol` 的 `npm run build` 现在依次执行 `build:proto`、`build:fbs`、`build:ts` 和 `build:fixtures`，生成 accessor 与跨端 fixture。`gpen-js` 通过 `gpen-protocol/flatbuffers` 使用生成的 object API；codec 只负责 FlatBuffers 二进制边界，storage 负责 Blob 与 JSON metadata 的持久化。

## `generated/` 与 `fixtures/`

- `generated/flatbuffers/`：由 `flatc` 从 schema 生成的 TypeScript accessor（包括 barrel）。这是 build 产物，生成文件头部标注 `do not modify`，由 `npm run build:ts` / 协议生成链重建，代表“从 schema 派生的代码”。
- `fixtures/gpen/v1/`：手工编写的 JSON 样本文档，以及由脚本根据这些 JSON 生成的 `.bin` 二进制。它们用于跨端一致性测试（JS/Zig 解码对照），其中 `.bin` 由 `npm run build:fixtures` 生成，代表“示例文档数据”。

一句话：`generated` = 代码（schema 派生）；`fixtures` = 数据样本（文档实例）。

## 当前事实与证据

| 项目                | 当前状态                                                               | 备注                                                                                             |
| ------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| canonical schema    | `../gpen-protocol/protocol/v1/*.tsp`                                   | TypeSpec 是协议源，`.proto` 不应手工编辑                                                         |
| protobuf            | `../gpen-protocol/protocol/gpen/v1.proto`                              | 由 `tsp compile .` 生成                                                                          |
| FlatBuffers schema  | `../gpen-protocol/schema/gpen/v1/model.fbs`                            | 由 `scripts/build-fbs.mjs` 生成，含 `root_type Gpen`                                             |
| TS accessor         | `gpen-protocol/generated/flatbuffers/gpen/v1*.ts`                      | `npm run build:ts` 生成，导出 barrel 和 object API；头部标注 `do not modify`                     |
| Fixtures            | `gpen-protocol/fixtures/gpen/v1/*.json` + `*.bin`                      | JSON 是手工样本文档，`.bin` 由 `npm run build:fixtures` 生成，用于 JS/Zig 对照                   |
| FlatBuffers runtime | `gpen-protocol` 直接依赖 `flatbuffers@25.9.23`；gpen-js 通过协议包消费 | 生成代码的 runtime 不依赖 `hd-wallet-wasm` 的传递依赖；消费方仍需直接声明/验证版本               |
| compiler            | `flatc-wasm@26.1.32`（exact）                                          | 本地 `FlatcRunner.version()` 实际报告 `flatc version 25.12.19`；npm 包版本不能代替 compiler 版本 |
| runtime 间接依赖    | `flatc-wasm` 内部仍有 `hd-wallet-wasm`                                 | 它只属于 build-time；浏览器生产 bundle 不得携带 `flatc-wasm`/WASM compiler                       |
| Zig accessor        | `gpen-zig/src/flatbuf/model.zig/.zon/.bfbs`                            | 从当前 `model.fbs` 重生成，`zig build test` 与 fixture 解码用于跨端核对                          |

上述版本是勘测结果，不是最终依赖决策。最终版本必须写入相应 `package.json` 和 lockfile，并在 CI 中报告实际 compiler/runtime 版本。

## 不可违反的边界

### Schema 和生成物归属

- `protocol/v1/*.tsp` 是唯一事实来源；修改协议字段时先修改 TypeSpec，并重新生成 `.proto` 与 `model.fbs`。
- `protocol/gpen/v1.proto`、`schema/gpen/v1/model.fbs` 和生成的 TS 文件都视为 generated files，不在生成结果上直接修补。
- FlatBuffers field id 是从 protobuf field number 映射来的 0-based id（当前脚本使用 `--keep-proto-id`）。新增字段只能追加稳定的 protobuf field number，不能因为 accessor 排序或 UI 需求重排字段。
- codec、storage 和 UI 不得直接依赖 Zig/C ABI 的指针、布局、allocator 或 runtime cache；它们只依赖协议语义。

### Compiler 和 runtime

- `flatc-wasm@26.1.32` 只用于 protocol build、fixture 或 CI 工具，不得进入浏览器生产 bundle。`FlatcRunner.version()` 当前为 `flatc version 25.12.19`，CI 应同时报告这两个值。
- 生成代码所 import 的 `flatbuffers` 是运行时依赖，必须由实际发布生成代码的 package 以直接 dependency 或等价的可验证方式提供；不能依赖 `hd-wallet-wasm` 的传递依赖。
- compiler 与 runtime 先做一组已验证的精确版本组合，再去掉 `^` 漂移。记录 npm 包版本和 `FlatcRunner.version()` 两个版本，避免只看其中一个。
- 生成 TS 时要保留 ESM 可运行的相对 import（当前 `flatc-wasm` 的输出使用 `.js` 后缀）；必须通过项目的 TypeScript、Vite/Bun 和浏览器构建检查。

### 生产 API 和数据层

业务层、storage adapter 和 layer adapter 直接使用 `gpen-protocol/flatbuffers` 生成的
object API（`GpenT` / `ToolbarStateT`，camelCase 字段）。三层持久数据——文档层、
toolbar/session 层、workspace/ui 层——都内嵌在 `Gpen` / `GpenT` 中；其中
`ToolbarState` 既可以作为独立消息读写，也可以经 `Gpen.toolbar_state` 内嵌。

```ts
type GpenBytes = Uint8Array;

decodeGpen(bytes: GpenBytes): GpenT;
encodeGpen(document: GpenT): GpenBytes;
// ToolbarState 同理：decodeToolbarState / encodeToolbarState
```

`codec.ts` 只保留纯二进制 encode/decode，已删除手写 domain model、from/to 映射和
手写 validator 层。客户端不再做业务校验，只认服务端提供的完整数据；TypeScript
类型检查负责静态字段约束，FlatBuffers codec 只报告二进制本身无法解码的错误。

- `decode`/`encode` 不创建 Svelte 状态、不访问 storage、不操作 DOM；
- 业务代码直接依赖生成的 `*T` 类名与字段名，不再有独立的协议类型层；
- 明确 `Uint8Array` 的 byte offset、复制/转移和生命周期；不能在转移 `ArrayBuffer` 后继续使用已失效的 view；
- Blob 只保存 FlatBuffers payload，KV 只保存版本化 JSON metadata；这不改变三层协议数据都嵌入 `Gpen` 的事实。

目标出口现在由 `gpen-protocol/package.json` 的 `./flatbuffers` export 提供；协议 package 沿用现有名称 `gpen-protocol`：

```ts
import * as flatbuffers from "flatbuffers";
import { Gpen } from "gpen-protocol/flatbuffers";

const view = Gpen.getRootAsGpen(new flatbuffers.ByteBuffer(bytes));
```

生成文件仍是 TypeScript source，`./flatbuffers` export 供 workspace/package adapter 使用；在 `gpen-js` 声明可重复的 protocol package 边界前，不得从 `../gpen-protocol` 的源码相对路径直接 import 到生产代码。

### Buffer、storage 和传输约定

- v1 的 payload 暂定是 `Builder.finish(rootOffset)` 产生的原始 FlatBuffer：无 size prefix、无 file identifier；读取使用 `getRootAsGpen`，不得调用 `getSizePrefixedRootAsGpen`。如果要改变 framing，必须先作为协议决策更新 schema、fixture 和所有 runtime。
- FlatBuffers bytes 是二进制内容：优先以现有 Blob backend 保存，例如 `gpen/<document-id>.bin`；KV 只保存 document id、协议版本、codec 版本、大小、更新时间和 Blob 引用等 JSON metadata。
- 不把 `Uint8Array` 直接塞入当前 `Storage<T extends JsonValue>` 的 KV；不为了绕过类型而把二进制编码成未经约定的 JSON 数组。
- `crossTabBus` 可以传递 `ArrayBuffer`，但消息协议必须声明是否转移 buffer、接收方是否复制，以及失败时的重试/关闭语义。
- 生产读写不需要先转 JSON；JSON 只用于 debug、fixture 和与 `flatc-wasm` 做语义对照。
- 文档、toolbar/session、workspace/ui 都随 `Gpen` 一起编码；不要把它们拆成两套协议存储。FlatBuffers schema version 仍不等于 host layout schema version。

## 当前协议事实与服务端完整数据约定

这些是协议/一致性边界，不是客户端业务 validator 的职责。服务端提供完整且符合协议约定的数据；客户端只做二进制解码，不补造领域状态或在客户端维护第二套校验模型。

1. **sentinel 是协议数据约定。** `active_node_index` 和 `parent_index` 用 `0xffffffff` 表示无节点/无父级。FlatBuffers 的默认值不能替代服务端完整数据；客户端不在 domain adapter 或 validator 中补写 sentinel。
2. **`DrawingSlot` 不是 FlatBuffers union。** 当前 schema 使用两个 optional message：`drawing` 和 `reference`，没有 `payload_type`。owned/reference 分支及其完整性由服务端协议数据保证；客户端不维护第二套 union validator。
3. **当前类型都是 table。** `Vec3`、`Color4`、`Point` 等在 `model.fbs` 中是 table，而不是旧 schema 中的 struct。不要为了压缩或匹配旧 Zig 绑定而擅自改回 struct。
4. **矩阵和索引是服务端数据约定。** `Matrix4x4F32.elements` 的协议注释要求恰好 16 个 float；`item_index`、`parent_index`、`child_range`、`drawing_index` 的 bounds/循环关系由服务端保证。
5. **当前没有 file identifier。** `model.fbs` 只有 `root_type Gpen`，没有 `file_identifier`。codec 不得假设存在 magic identifier；如果未来加入，必须作为显式协议变更并同时更新所有 runtime。
6. **跨 runtime 生成物已同步。** gpen-zig 的 `model.zig`、`model.zon` 和 `model.bfbs` 已从当前 `model.fbs` 重生成；`zig build test` 与 JS/Zig fixture 链路用于持续确认 accessor 一致。

## 推荐的 package 结构

这是实现目标，不代表当前目录已经存在：

```text
gpen-protocol/
├─ protocol/v1/*.tsp
├─ protocol/gpen/v1.proto                 # generated
├─ schema/gpen/v1/model.fbs               # generated
└─ generated/flatbuffers/
   ├─ gpen/v1.ts                           # generated namespace barrel
   └─ gpen/v1/*.ts                         # generated accessors

gpen-js/
└─ src/lib/bindings/flatbuffers/
   ├─ codec.ts                             # protocol-independent binary boundary
   └─ index.ts
```

协议 package 需要提供一个稳定的 `./flatbuffers` export，至少能导出生成的 `Gpen` 及其依赖的 accessor。`gpen-js` 不应在自己的源码中复制一份生成文件；如果暂时不能发布 npm package，应建立可重复安装的 local/workspace package 边界，并把这个限制写进 CI，而不是使用运行时 sibling path import。

## Agents 工作包

任务 ID 供批量 agents、commit 和 review 使用。每个 agent 只修改自己负责的仓库/目录；跨仓库任务先完成协议契约，再让消费方接入。

| ID      | 负责范围                                 | 任务                                                                                                                                               | 依赖                       |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| FBS-001 | `gpen-protocol`                          | 核对 TSP → proto → FBS 的确定性；记录 sentinel、`DrawingSlot` 和 matrix/index 的服务端数据约定，补 fixture 基线                                    | 无                         |
| FBS-002 | `gpen-protocol`                          | 用现有 `flatc-wasm` 生成 TS accessor；确定输出目录、`.js` import、是否启用 object API；添加 barrel、package export 和“不手改 generated files”检查  | FBS-001                    |
| FBS-003 | 两个 JS package                          | 固定并验证 compiler/runtime 版本；让 `flatbuffers` 成为可解析的直接 runtime dependency；确认 `flatc-wasm` 不进入 gpen-js bundle                    | FBS-001，可与 FBS-002 并行 |
| FBS-004 | `gpen-js/src/lib/bindings/flatbuffers`   | 实现纯 codec、错误类型和 `Uint8Array` 生命周期规则；直接使用生成的 `*T`，不新增 domain model/validator；覆盖 root、空文档和完整图层/笔迹           | FBS-002、FBS-003           |
| FBS-005 | `gpen-js` storage                        | 将 codec 接到 Blob/KV；定义 binary key、metadata、schema migration、写入 debounce/失败恢复，不污染现有 JSON KV API                                 | FBS-004                    |
| FBS-006 | `gpen-js` + `gpen-zig` + `gpen-protocol` | 建立最小/完整/owned drawing/reference/invalid fixture；用 `flatc-wasm` JSON、JS accessor 和 Zig accessor 互相验证；同步 Zig 生成物                 | FBS-001、FBS-002、FBS-003  |
| FBS-007 | `gpen-js` layer                          | 从 protocol model 映射 `nodes/layers/groups/active_node_index`，实现 parent/child 顺序和 flags；业务模型不得把 CSS z-index 当协议字段              | FBS-004、FBS-006           |
| FBS-008 | 根仓库 CI                                | 串起 protocol generation、generated diff、JS typecheck/test/build、fixture conformance 和 bundle 检查；失败信息要报告 schema/compiler/runtime 版本 | FBS-002、FBS-004、FBS-006  |

建议批次：

```text
Batch A: FBS-001 + FBS-003 的勘测/契约
Batch B: FBS-002 的生成物与 package export
Batch C: FBS-004 + FBS-006 的 codec/fixture（两者可并行）
Batch D: FBS-005 + FBS-007 的 storage/layer adapter（两者可并行）
Batch E: FBS-008 全链路 CI 和回归
```

如果 FBS-001 改变了字段、默认值或 union 语义，后续批次必须以新的 fixture 和文档为准，不要在消费方临时兼容两个未经版本化的解释。

## 生成与使用的最小约定

当前 `flatc-wasm@26.1.32`（实际 compiler `25.12.19`）已验证可以从 `model.fbs` 生成如下输出；`npm run build` 会写入 `generated/flatbuffers`：

```text
gpen/v1.ts
gpen/v1/gpen.ts
gpen/v1/layer.ts
gpen/v1/layer-group.ts
...
```

`FlatcRunner.generateCode(schemaInput, "ts", ...)` 支持 `genObjectApi`；若采用 object API，`GpenT.pack()` 和 `Gpen.finishGpenBuffer()` 只应出现在 codec 内部。无论是否启用 object API，都必须保留低层 accessor 的 decode 测试。生成步骤应固定类似以下选项，最终值由 FBS-002 提交的脚本确定：

```text
language: ts
noWarnings: true
tsNoImportExt: false
genObjectApi: 经过 bundle/类型检查后决定
```

不得把 `flatc-wasm` 本身的 `generateBinary` 当作浏览器生产 encoder；它适合生成测试 fixture 和与 JS codec 做语义对照。

## 验收标准

接入完成前至少满足以下条件：

- 在干净环境运行 protocol build，可以从 TypeSpec 重建 `.proto`、`model.fbs` 和 TS accessor；重复生成没有无关 diff。`buf lint protocol` 通过，`PACKAGE_DIRECTORY_MATCH` 因 TypeSpec emitter 的 package-to-filename 规则在 `buf.yaml` 中明确例外，其余 STANDARD lint 规则保持启用。
- `gpen-js` 能从稳定 package export import accessor，且 `bun run typecheck`、`bun test`、`bun run build` 通过。
- JS encode → decode、`flatc-wasm` JSON 对照、Zig decode/encode 至少各有一条 fixture 链路；包含两个 `DrawingSlot` payload 分支和 sentinel。
- schema field id、root type、默认值、矩阵长度、索引关系和 invalid buffer 行为都有自动化断言。
- 生产 bundle 不包含 `flatc-wasm`、WASM compiler 或 protocol build-only 依赖。
- binary 使用 Blob backend，KV 只保存版本化 metadata；storage 重开、跨 tab ArrayBuffer 传递和失败恢复有测试。
- layer adapter 使用协议树顺序推导绘制顺序，图层 renderer 的 stacking context 不能覆盖 Dockview workspace。
- 生成文件头部明确标记 `do not modify`，CI 能在有人手改 generated output 或 compiler 漂移时失败并给出修复命令。

## Agent 交付格式

每个实现 agent 在 handoff 中写明：

- 修改的仓库、文件和生成命令；
- `package.json` 版本与实际 `flatc`/runtime 版本；
- fixture/测试覆盖的协议分支；
- 是否改变了 schema、默认值、field id 或 package export；
- 未解决问题和对下一任务的明确依赖。

相关设计文档：[`docs/panel.md`](panel.md) 只描述面板/图层 UX；协议字段和二进制边界以本文件及 [`gpen-protocol/protocol/v1/gpen.tsp`](../../gpen-protocol/protocol/v1/gpen.tsp) 为准。
