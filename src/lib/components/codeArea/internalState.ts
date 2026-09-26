/**
 * 内置调试源：**内部 JSON 状态树**（文件菜单「调试：内部 JSON 状态树」）。
 *
 * 为什么需要它：工作区里大量状态是看不见的——`workspaceState`（含 `panelLayout` /
 * `uiScale`）、偏好、文档摘要、以及排查缩放问题要用的 `visualViewport.scale` / `dpr` /
 * `workspaceZoom` / 容器的未缩放尺寸。以前想看这些只能翻 devtools 或改代码。
 *
 * 拆成「同步部分 + 可选异步部分」，是因为两类数据源的性子不同：
 *
 * - 同步的（`read`）在组件 `$derived` 里调用 → 读 `$state` 就是**实时**的；
 * - 异步的（`load`）是一次性快照（KV 这类），只在打开面板与点「刷新」时跑一次。
 *
 * `read` 刻意只读内存：那里不能 `await`，也不该新建存储句柄。持久化层「将要写入」的
 * 内容由 `serializeGpenWorkspaceState()` / `serializeGpenPreferences()` 原样给出，所以
 * 「KV 里存的是什么」仍然是实时且可信的。
 */
import type { GpenKvRoot, KvStorage } from "#lib/bindings/storage/index.js";
import { listMenuIds } from "../contextMenu/contextMenu.svelte.js";
import type { CodeAreaSource } from "./source.js";

/** 宿主（`GpenWorkspace`）注入的读取器；全部是纯 getter，不持有状态。 */
export interface InternalStateReaders {
  /** 会被写入 `gpen.workspaceState` KV 的那份载荷。 */
  workspaceState(): unknown;
  /** 会被写入 `gpen.preferences` KV 的那份载荷。 */
  preferences(): unknown;
  /** 内存中的文档摘要（不是整篇文档：那可能几 MB）。 */
  document(): unknown;
  /** 与缩放 / 视口相关的实时数字。 */
  viewport(): unknown;
  /** 右键菜单状态与菜单注册表快照。 */
  menu(): unknown;
  /** gpenBinary 的 KV（`gpen-root`），异步读。 */
  gpenKv(): KvStorage<GpenKvRoot> | undefined;
}

/** 「内部 JSON 状态树」数据源的固定 id。 */
export const INTERNAL_STATE_SOURCE_ID = "gpen-internal-state";

/** 用一组读取器创建内置调试数据源。 */
export function createInternalStateSource(readers: InternalStateReaders): CodeAreaSource {
  return {
    id: INTERNAL_STATE_SOURCE_ID,
    title: "内部 JSON 状态树",
    read() {
      return {
        // `viewport` 放最前：排查缩放类问题时它就是入口，而且 CodeEditor 只把可见行
        // 渲染进 DOM（虚拟滚动），靠后的内容要滚下去才看得见。
        viewport: readers.viewport(),
        workspaceState: readers.workspaceState(),
        preferences: readers.preferences(),
        document: readers.document(),
        menu: readers.menu(),
        // 菜单注册表是命令式 Map，不是 $state：这里的快照只在打开 / 刷新时更新。
        registeredMenus: listMenuIds(),
      };
    },
    async load() {
      const kv = readers.gpenKv();
      if (!kv) return { storage: { error: "存储尚未就绪" } };
      const [rootKeys, gpen] = await Promise.all([kv.keys(), kv.get.gpen.then()]);
      return {
        storage: {
          kvName: kv.name,
          rootKeys,
          // `gpen.<documentId>` 的元数据（字节数 / 上次保存时间 / blob id）。
          gpen: gpen ?? null,
        },
      };
    },
  };
}
