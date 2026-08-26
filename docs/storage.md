# gpen-js 存储

存储由两个相互独立的部分组成：

- `storage.kv`：保存 JSON 数据。
- `storage.blob`：保存 `Blob` / `File`。

两者都挂在同一个 `Storage` 对象上，但不会组成跨存储事务。

## 选择存储

通常使用 `createRuntimeStorage()`，它会根据当前环境选择实现：

| 运行环境        | KV                             | Blob                                    | 工厂                     |
| --------------- | ------------------------------ | --------------------------------------- | ------------------------ |
| 普通网页        | IndexedDB                      | OPFS broker，初始化失败时使用 IndexedDB | `createWebsiteStorage()` |
| WebExtension    | `browser.storage.local`        | OPFS broker，初始化失败时使用 IndexedDB | `createBrowserStorage()` |
| userscript      | GM storage                     | OPFS broker，初始化失败时使用 IndexedDB | `createMonkeyStorage()`  |
| VS Code host    | Memento 或 `.gpen/state.jsonc` | `host.blob` 或 `.gpen/blob/<id>`        | `createVscodeStorage()`  |
| VS Code webview | bridge                         | bridge                                  | `createVscodeStorage()`  |
| 内存 / 测试     | 内存                           | `Map`                                   | `createMemoryStorage()`  |

`createRuntimeStorage()` 的选择顺序为 userscript → VS Code → WebExtension → 普通网页。返回值始终是同样的对象结构：`storage.kv` 和 `storage.blob`。

普通网页、WebExtension 和 userscript 的 Blob 默认使用 `targetDomain` 提供的 `/storage-broker` 页面，将 Blob 保存到 OPFS；默认 `targetDomain` 为 `https://xxx.github.com`。部署时应确保目标 origin 提供该页面，也可以通过 `brokerPath` 修改路径。OPFS broker 初始化失败时，Blob 会使用当前 origin 的 IndexedDB。

## 基本用法

```ts
import { createRuntimeStorage } from "gpen-js/storage";

type AppState = {
  settings: {
    theme: string;
  };
};

const storage = createRuntimeStorage<AppState>({
  dbName: "gpen-demo-storage",
  targetDomain: "https://example.com",
});

const theme = await storage.kv.get.settings.theme;
await storage.kv.set.settings.theme("dark");
await storage.kv.submit();

await storage.blob.set("model/latest", file);
const model = await storage.blob.get("model/latest");
```

使用完毕后可以关闭资源：

```ts
await storage.close?.();
```

需要自行指定 backend 时，直接组合 `kv` 和 `blob` 即可：

```ts
import { createKvStorage } from "gpen-js/storage";

const storage = {
  kv: createKvStorage(myKvBackend, {
    cache: true,
    initValue: (oldValue) => ({ ...oldValue, visits: oldValue.visits ?? 0 }),
  }),
  blob: myBlobBackend,
};
```

## KV

`createKvStorage(backend, options)` 通过路径访问嵌套 JSON 值：

```ts
await storage.kv.get.settings.theme;
await storage.kv.set.settings.theme("dark");
await storage.kv.del.settings;

await storage.kv.get.settings.keys();
await storage.kv.keys();
```

默认 `cache: true`。修改先保存在内存工作区，调用 `submit()` 后写入 backend；设置 `cache: false` 后每次修改都会立即保存。

缓存模式也可以在运行时切换。切换为 `false` 时，会先保存尚未提交的缓存内容；切换回 `true` 时，后续修改会以 backend 的最新值建立缓存：

```ts
storage.kv.cache = false;
await storage.kv.set.settings.theme("light");

storage.kv.cache = true;
await storage.kv.set.settings.theme("dark");
await storage.kv.submit();
```

`initValue` 可以是初始值、Promise，或接收旧值并返回新值的函数；每个 store 初始化时只执行一次，适合设置默认值和迁移数据：

```ts
const kv = createKvStorage(backend, {
  initValue: async (oldValue) => migrate(oldValue),
});
```

KV 只接受 JSON 值，不接受 `Blob`、`File` 或文件句柄。`version` 是应用版本字符串；`versionNum` 是数值版本，在 IndexedDB 中必须保持不下降。

## Blob

Blob backend 提供三个操作：

```ts
await storage.blob.set("model/latest", value);
const value = await storage.blob.get("model/latest"); // Blob | undefined
await storage.blob.delete("model/latest");
```

文件选择和下载由 `gpen-js/upDownloader` 单独提供，不会自动写入 Blob storage：

```ts
import { createUploadDownloadOnlyBlob } from "gpen-js/upDownloader";

const selector = createUploadDownloadOnlyBlob();
const file = selector.upload(fileInput);

if (file) await storage.blob.set("model/latest", file);

const value = await storage.blob.get("model/latest");
if (value) await selector.download(value, "model-latest.bin");
```

也可以直接使用 `createOpfsBlobBackend()` 创建 OPFS Blob backend。文件选择器默认会自动选择实现：浏览器扩展和普通网页使用原生 File API；检测到 userscript 的 `GM_download`/`GM.download` 时，下载会绑定到该 API。也可以显式使用 `createNativeUploadDownloadSelector()` 或 `createMonkeyUploadDownloadSelector()`。

userscript 需要声明下载权限：

```js
// ==UserScript==
// @grant        GM_download
// @connect      example.com
// ==/UserScript==
```

`@connect` 只需列出要下载的跨域主机；Blob 和同源 URL 不需要额外声明。

Blob backend 也支持路径代理和可变 hook。`blob.get.pathA.pathB` 对应
`pathA/pathB`，同时保留 `blob.get("pathA/pathB")` 形式：

```ts
const blob = createBlobBackend();
blob.proxy.setters.record = async ({ id, options }) => {
  console.log(id, options?.source);
};
await blob.set.pathA.pathB(file);
const value = await blob.get.pathA.pathB;
```

需要把 Blob 的外部引用同步到 KV 时，可以使用内置 hook：

```ts
const kv = createKvBackend();
const storage = {
  kv,
  blob: bindBlobToKv(createBlobBackend(), { kv }),
};

await storage.blob.set("attachments/model.bin", file, {
  source: "/work/model.bin",
});
// KV 中会得到 blob/model.bin = "file:///work/model.bin"
```

如果 Blob 是带有非标准 `path` 属性的 `File`，未提供 `source` 时会自动使用该路径；也可以
直接修改 `blob.proxy.getters`、`blob.proxy.setters` 和 `blob.proxy.deleters`。需要先创建
Blob 再装配 hook 时，可以使用 `createBlobKvSyncHooks({ kv })`。

## VS Code

VS Code host 可以提供 `workspaceState` / `globalState` 和持久化的 `blob`，也可以提供 `fileSystem`：

- 提供 `fileSystem` 时，默认将 KV 保存到 `.gpen/state.jsonc`，Blob 保存到 `.gpen/blob/<id>`。
- 只提供 Memento 时，KV 使用对应的 state，Blob 使用 `host.blob`。
- VS Code webview 使用 `bridge` 与 host 通信。

文件传输使用统一的 `createVscodeUploadDownloadSelector()`。web/ssh 模式通过注入的
`VscodeFileSystem` 或 webview bridge 读写远端文件；本地模式会先调用 VS Code 的
`createSymbolicLink`，再尝试 `bindings/shell/symlink` 的命令 runner。创建失败时，外部
路径会以 `file:///...`、`ftp://...` 等 URL 写入 `.gpen/state.jsonc` 的 `blob` 对象；下载
则通过 VS Code 的 open-file API 打开目标文件。需要检查本地处理结果时可调用
`uploadDetailed()`，返回值会标记 `linked` 或 `recorded`。

## 一致性

KV 的嵌套修改最终都是 root 级别的读改写。多个标签页同时提交时不会自动合并，冲突策略需要由业务层处理；KV 和 Blob 之间也没有跨 backend 事务。
