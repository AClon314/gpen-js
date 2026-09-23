/**
 * gpen 文档会话：内存文档、撤销历史、gpenBinary 落盘、笔画 / 橡皮提交、新建 / 打开 / 另存。
 *
 * 从 `GpenWorkspace.svelte` 整块搬出来的（那个文件曾经 1800+ 行）：这一块自成一体——
 * 只碰文档与存储，不碰 dockview / 面板 / 命令注册。组件保留「UI 什么时候调」，
 * 下面这些语义守卫集中在这里。
 *
 * 三个必须守住的点（都是踩过坑写下来的，改动前先读 `docs/stroke.md` 与 `docs/storage.md`）：
 *
 * 1. **`ready` 之前不落盘**：load 是异步的，默认文档会在读到存档之前把存储里的那份覆盖掉。
 * 2. **load 返回时若用户已经改过文档**（`edited`）：不覆盖他的工作，也不清历史
 *    （历史里那条是「默认文档 → …」，清掉之后 Ctrl+Z 不该退回默认文档）。
 * 3. **重建 store 之前先把旧 store 挂起的写入刷盘**（自动保存间隔是构造参数，改了只能重建），
 *    否则最后一次编辑会丢。
 *
 * 用法：组件在脚本顶层 `const session = createGpenDocumentSession()`，`onMount` 里
 * `session.start()`、`onDestroy` 里 `session.dispose()`；读文档用 `session.document`
 * （getter，读它就订阅）。
 */
import {
  createGpenBinaryStore,
  createRuntimeStorage,
  type GpenBinaryStore,
  type GpenKvRoot,
  type HookedBlobBackend,
  type KvStorage,
  type Storage,
} from "../bindings/storage/index";
import { createEditHistory, type CommitOptions } from "../history";
import {
  appendStroke,
  createStroke,
  eraseHard,
  eraseSoft,
  eraseStrokes,
  type StrokePointInput,
} from "../layers/strokeOps";
import { ensureDrawableActiveLayer } from "../layers/layerOps";
import { createDefaultGpen } from "../protocol/defaults";
import {
  EraserMode,
  type BrushSettingsT,
  type EraserSettingsT,
  type ToolbarStateT,
} from "gpen-protocol/flatbuffers";
import type { GpenT } from "gpen-protocol/flatbuffers";
import { preferences as preferencesState } from "./gpenPreferencesState.svelte";
import {
  brushRadiusOf,
  defaultToolbarState,
  ensureToolbarState,
  eraserRadiusOf,
  readToolbarState,
  toolIdName,
  writeBrushSettings,
  writeEraserSettings,
  writeToolbarState,
} from "./toolbarOps";
import type { GpenToolId } from "./gpenWorkspaceState";

/** 本轮只存一份文档（多文档要协议级的文档目录，见「打开」命令的注释）。 */
export const GPEN_DOCUMENT_ID = "gpen-main";

const GPEN_SAVE_DEBOUNCE_MS = 250;
// 工作区偏好与文档各用一份 KV 根：`createRuntimeStorage()` 每次都建一个独立的
// 内存根，`submit()` 会整根写回同一个 IndexedDB key，共用根会互相覆盖命名空间。
const GPEN_KV_KEY = "gpen-root";

/**
 * 撤销预算：条目上限 + 总快照预算。文档快照是不可变引用，所以这里的
 * 「预算」约束的是同时存活的文档份数（真正的内存压力），而不是数组长度。
 */
const UNDO_LIMIT = 50;
const UNDO_BUDGET = 200;

export interface GpenDocumentHistoryState {
  undoDepth: number;
  redoDepth: number;
}

export interface GpenDocumentSession {
  /** 当前文档（`$state.raw`，每次整体替换）。 */
  readonly document: GpenT | undefined;
  /** load 结束前不落盘（见文件头第 1 条）。 */
  readonly ready: boolean;
  /** 落盘状态文案（设置面板的只读诊断）。 */
  readonly status: string;
  /** 用户是否动过文档（load 时据此决定要不要用存档覆盖）。 */
  readonly edited: boolean;
  /** 状态栏的撤销 / 重做深度（history 本身不是响应式的）。 */
  readonly historyState: GpenDocumentHistoryState;
  /** gpenBinary 的 KV（内置调试源用；未就绪时 undefined）。 */
  readonly kv: KvStorage<GpenKvRoot> | undefined;

  /** onMount：建默认文档 + storage + store，并异步读存档。 */
  start(): void;
  /** onDestroy：把挂起的写入刷盘、释放 store 与 storage。 */
  dispose(): void;

  /** 用户改动文档的统一入口（标记 `edited` 并赋值）。 */
  assign(next: GpenT): void;
  pushUndo(previous: GpenT | undefined, options?: CommitOptions<GpenT>): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  commitStroke(points: StrokePointInput[]): void;
  commitErase(point: { x: number; y: number }): void;
  /**
   * 橡皮拖动结束（pointerup / pointercancel）：清掉 coalesce 目标。
   *
   * `eraseGestureStart` 只赋不清的话，两次独立拖动会共用同一个目标，
   * Ctrl+Z 一次把两次都退回（见 `tests/e2e/eraser.e2e.ts` 的回归用例）。
   */
  endEraseGesture(): void;

  /** 立即刷盘（不等 debounce）。 */
  saveNow(): Promise<void>;
  /** 设置面板的「清空」：回到默认文档，可 Ctrl+Z 退回。 */
  clear(): void;
  /** 「新建」：新文档（可 Ctrl+Z 退回）+ 默认工具栏设置。 */
  createNew(): void;
  /** 「打开」/「打开最近文件」：从 gpenBinary 重新读 `gpen-main`。 */
  openStored(): Promise<void>;
  /** 「保存副本」：写到 `gpen-<时间戳>` 下。 */
  saveCopy(): Promise<void>;

  /** 协议 `ToolbarState` 的当前值。 */
  readToolbar(): ToolbarStateT | undefined;
  /** 写入画笔设置（值没变会被丢掉，见 `writeBrush` 的注释）。 */
  writeBrush(patch: Partial<BrushSettingsT>): void;
  writeEraser(patch: Partial<EraserSettingsT>): void;
  /** 把当前工具镜像进协议 `ToolbarState.activeToolId`（UI 真值仍在 workspaceState）。 */
  mirrorToolId(tool: GpenToolId): void;
  /** 恢复默认画笔 / 橡皮设置（设置面板的重置；算一次编辑）。 */
  resetToolbar(): void;
}

/**
 * 丢掉与现有值相等的字段（`Object.is`，所以 `NaN` 也不等于 `NaN` 以外的任何值）。
 * 设置类写入的统一前置：值没变就不该产生新文档、新 undo 条目。
 */
function changedFields<T extends object>(patch: Partial<T>, current: T | undefined): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const existing = (current as Record<string, unknown> | undefined)?.[key];
    if (Object.is(existing, value)) continue;
    result[key] = value;
  }
  return result as Partial<T>;
}

export function createGpenDocumentSession(): GpenDocumentSession {
  /// 撤销/重做存的是不可变文档引用，所以快照本身不复制数据。环形缓冲 + 预算，
  /// 丢弃最旧历史时只推进 head，不搬数组（见 lib/history.ts）。
  const history = createEditHistory<GpenT>({ limit: UNDO_LIMIT, maxEntries: UNDO_BUDGET });
  const historyState = $state<GpenDocumentHistoryState>({ undoDepth: 0, redoDepth: 0 });

  let document = $state.raw<GpenT | undefined>(undefined);
  let ready = $state(false);
  let status = $state("未保存");
  /** 用户是否动过文档：`load` 返回时据此决定要不要用存档覆盖默认文档。 */
  let edited = false;
  /// 一次橡皮拖动开始时的文档：连续擦除用 `coalesceWith` 合成一条 undo。
  let eraseGestureStart: GpenT | undefined;
  let runtimeStorage: Storage<GpenKvRoot, HookedBlobBackend> | undefined;
  let gpenStore: GpenBinaryStore | undefined;
  /** 当前 `gpenStore` 使用的 debounce（构造参数，改了要重建 store）。 */
  let appliedDebounceMs = GPEN_SAVE_DEBOUNCE_MS;

  function syncHistoryState(): void {
    historyState.undoDepth = history.undoDepth();
    historyState.redoDepth = history.redoDepth();
  }

  function assign(next: GpenT): void {
    edited = true;
    document = next;
  }

  function pushUndo(previous: GpenT | undefined, options?: CommitOptions<GpenT>): void {
    if (!previous) return;
    history.commit(previous, options);
    syncHistoryState();
  }

  function undo(): void {
    const current = document;
    if (!current) return;
    const previous = history.undo(current);
    if (!previous) return;
    assign(previous);
    syncHistoryState();
  }

  function redo(): void {
    const current = document;
    if (!current) return;
    const next = history.redo(current);
    if (!next) return;
    assign(next);
    syncHistoryState();
  }

  /**
   * 画布提交一笔：确保 active layer 可画（必要时自动建 `Stroke-N`）→ `createStroke`
   * （半径 / 颜色 / 不透明度来自协议 `ToolbarState.brush`）→ `appendStroke`。
   *
   * 采样点由画布给（图层局部坐标）；这里才把它们变成协议数据，因为画笔参数是
   * 文档级的（`GpenWorkspace` 拥有文档，画布只拥有指针）。
   * 失败只记日志：笔迹丢了比把异常抛回 pointer 事件里更安全。
   */
  function commitStroke(points: StrokePointInput[]): void {
    const current = document;
    if (!current || points.length === 0) return;
    try {
      const state = ensureToolbarState(current);
      const brush = state.brush ?? undefined;
      const stroke = createStroke(points, {
        radius: brushRadiusOf(brush),
        opacity: brush?.drawStrength ?? undefined,
      });
      const next = appendStroke(ensureDrawableActiveLayer(current), stroke);
      pushUndo(current);
      assign(next);
    } catch (error) {
      console.debug("[gpen] ignored rejection: gpen document commitStroke", error);
      return;
    }
  }

  /**
   * 橡皮：按 `EraserSettings.mode` 选算法（STROKE / SOFT / HARD）。
   *
   * `mode` 是唯一真值——`EraserTarget` 已 deprecated（见 handoff §3.2），
   * 这里**不读 `target`**。橡皮笔是「拖动即擦」的连续手势：每次 pointermove
   * 都会改文档，所以用 `coalesceWith` 把一次拖动合并成一条 undo 记录。
   */
  function commitErase(point: { x: number; y: number }): void {
    const current = document;
    if (!current) return;
    const eraser = ensureToolbarState(current).eraser ?? undefined;
    const radius = eraserRadiusOf(eraser);
    if (!(radius > 0)) return;

    let next: GpenT;
    // 橡皮模式：协议枚举的 0 值叫 `ERASER_MODE_SOFT_UNSPECIFIED`（不是 `..._SOFT`），
    // 因为 0 同时要当 protobuf 的 unspecified 哨兵；SOFT 就是 0。
    switch (eraser?.mode) {
      case EraserMode.ERASER_MODE_SOFT_UNSPECIFIED:
        next = eraseSoft(current, point, radius, eraser?.strength ?? 1);
        break;
      case EraserMode.ERASER_MODE_STROKE:
        next = eraseStrokes(current, point, radius);
        break;
      default:
        next = eraseHard(current, point, radius);
        break;
    }
    if (next === current) return;
    // 拖动中的连续擦除合成一条 undo。**手势第一步要 push，之后才 coalesce**：
    // `coalesceWith` 是「替换最新一条」，如果第一步也走 coalesce，它会把上一步
    // （比如刚画的那一笔）的 undo 条目吃掉；第一步 push 的是「手势之前的文档」，
    // 之后每一步只是把这条替换成同一个值（no-op）。
    if (eraseGestureStart === undefined) {
      eraseGestureStart = current;
      pushUndo(current);
    } else {
      pushUndo(current, { coalesceWith: () => eraseGestureStart });
    }
    assign(next);
  }

  /**
   * 橡皮拖动结束（pointerup / pointercancel）。
   *
   * 必须在手势边界清掉 `eraseGestureStart`：它只赋不清的话，第二次独立拖动会继续用
   * 第一次拖动开始时的文档当 coalesce 目标，Ctrl+Z 一次把两次拖动都退回（预存在问题，
   * 2026-09-21 补回归用例后修）。
   */
  function endEraseGesture(): void {
    eraseGestureStart = undefined;
  }

  /** 保存 = 立即刷盘（不等 debounce），失败只记日志。 */
  async function saveNow(): Promise<void> {
    const store = gpenStore;
    if (!store) return;
    try {
      await store.commit();
      status = "已保存";
    } catch (error) {
      console.debug("[gpen] ignored rejection: gpen document explicit save", error);
      status = "保存失败";
      return;
    }
  }

  /**
   * 清空当前文档（设置面板的「清空」）：回到默认文档，可 Ctrl+Z 退回。
   * 不删存储里的 blob——下一次 debounce 落盘会把它覆盖成默认文档，语义更接近
   * Blender 的「恢复默认」而不是「删除文件」。
   */
  function clear(): void {
    const current = document;
    if (!current) return;
    pushUndo(current);
    assign(createDefaultGpen(window.location.href));
  }

  /** 「新建」：新文档（可 Ctrl+Z 退回），并把工具栏设置带回默认值。 */
  function createNew(): void {
    const current = document;
    const fresh = createDefaultGpen(window.location.href);
    // `pushUndo` 而不是 `history.clear()`：新建是**用户操作**，Ctrl+Z 应该能退回
    // （只有 mount 时读到存档才清历史，那次不是用户操作）。
    if (current) pushUndo(current);
    assign(writeToolbarState(fresh, defaultToolbarState()));
    status = "新建文档（未保存）";
  }

  /**
   * 「打开」/「打开最近文件」：从 gpenBinary 重新读 `gpen-main`。
   * 两个菜单项指向同一件事：本轮只存一份文档（多文档要协议级的文档目录），
   * 所以不做“文件选择器”这种假 UI。
   */
  async function openStored(): Promise<void> {
    const store = gpenStore;
    if (!store) return;
    try {
      const loaded = await store.load(GPEN_DOCUMENT_ID);
      const current = document;
      if (current) pushUndo(current);
      assign(loaded);
      status = "已从存储载入";
    } catch (error) {
      console.debug("[gpen] ignored rejection: gpen document openStored", error);
      status = "没有可打开的存档";
      return;
    }
  }

  /** 「保存副本」：把当前文档写到 `gpen-<时间戳>` 下，并切过去。 */
  async function saveCopy(): Promise<void> {
    const store = gpenStore;
    const current = document;
    if (!store || !current) return;
    const id = `gpen-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    try {
      await store.save(id, current);
      await store.commit();
      status = `副本已保存：${id}`;
    } catch (error) {
      console.debug("[gpen] ignored rejection: gpen document saveCopy", error);
      status = "保存副本失败";
      return;
    }
  }

  function readToolbar(): ToolbarStateT | undefined {
    return document ? readToolbarState(document) : undefined;
  }

  /**
   * 画笔 / 橡皮设置写入协议 `ToolbarState`（不可变文档，算一次编辑）。
   *
   * ⚠️ **必须丢弃“值没变”的写入**：`InputSlider` 在 `$effect` 里发 `onvalidvalue`，
   * 而文档一改就重渲滑条、重发同一个值——没有这层守卫就是一个
   * `effect_update_depth_exceeded` 死循环（实测过），而且每次聚焦滑条都会
   * 往 undo 里塞一条空记录。
   */
  function writeBrush(patch: Partial<BrushSettingsT>): void {
    const current = document;
    if (!current) return;
    // 基线是**生效值**（没有 toolbarState 时就是默认值），不是 undefined：
    // 否则面板一挂载、取色器把默认颜色回发一次，就会把整套默认 toolbarState
    // 写进文档（实测 352 → 720 字节）——打开设置面板不该改文档。
    const brush = ensureToolbarState(current).brush ?? undefined;
    const changed = changedFields(patch, brush);
    if (Object.keys(changed).length === 0) return;
    const next = writeBrushSettings(current, changed);
    pushUndo(current);
    assign(next);
  }

  function writeEraser(patch: Partial<EraserSettingsT>): void {
    const current = document;
    if (!current) return;
    const eraser = ensureToolbarState(current).eraser ?? undefined;
    const changed = changedFields(patch, eraser);
    if (Object.keys(changed).length === 0) return;
    const next = writeEraserSettings(current, changed);
    pushUndo(current);
    assign(next);
  }

  function mirrorToolId(tool: GpenToolId): void {
    // UI 真值仍是 `workspaceState.activeTool`，文档里只存镜像，不反向覆盖用户的选择。
    const current = document;
    if (!current) return;
    const state = ensureToolbarState(current);
    if (state.activeToolId === toolIdName(tool)) return;
    assign(writeToolbarState(current, Object.assign(state, { activeToolId: toolIdName(tool) })));
  }

  /** 恢复默认画笔 / 橡皮设置（设置面板的重置；算一次编辑）。 */
  function resetToolbar(): void {
    const current = document;
    if (!current) return;
    const defaults = defaultToolbarState();
    const state = ensureToolbarState(current);
    pushUndo(current);
    assign(
      writeToolbarState(
        current,
        Object.assign(state, { brush: defaults.brush, eraser: defaults.eraser }),
      ),
    );
  }

  /** 挂载时读存档；没有 / 坏了都退回已经设好的默认文档。 */
  async function loadStored(): Promise<void> {
    const store = gpenStore;
    if (!store) return;
    try {
      const loaded = await store.load(GPEN_DOCUMENT_ID);
      // 用户在 load 期间已经画过：不覆盖他的工作（见文件头第 2 条）。
      if (!edited) {
        document = loaded;
        // 历史里的是「默认文档 → ...」，不是用户的操作：清掉，undo 不该退回默认文档。
        history.clear();
        syncHistoryState();
      }
    } catch (error) {
      console.debug("[gpen] ignored rejection: gpen document load", error);
      // 失败只是没有存档可读，退回默认文档即可，无需向上传播。
      return;
    } finally {
      ready = true;
    }
  }

  function start(): void {
    // 先用默认文档把 UI 立起来（时间轴 / 图层视图要有真数据可渲染），
    // 读到存档再替换（见 `loadStored`）。
    document = createDefaultGpen(window.location.href);

    runtimeStorage = createRuntimeStorage<GpenKvRoot>({
      kvKey: GPEN_KV_KEY,
      storageKey: GPEN_KV_KEY,
    });
    gpenStore = createGpenBinaryStore({
      kv: runtimeStorage.kv,
      blob: runtimeStorage.blob,
      cache: true,
      // 自动保存间隔来自用户偏好（设置面板可改）。偏好是异步读的，所以这里先取
      // 当前值（默认 250ms），读盘落定后由下面的 `$effect` 重建 store 接管。
      debounceMs: preferencesState().autoSaveDebounceMs,
    });
    appliedDebounceMs = preferencesState().autoSaveDebounceMs;
    void loadStored();
  }

  function dispose(): void {
    // 先把挂起的写入刷盘，再停掉 store 与 storage。
    const store = gpenStore;
    gpenStore = undefined;
    if (store) {
      void store.commit().then(
        () => store.dispose(),
        (error) => {
          console.debug("[gpen] ignored rejection: gpen document commit on dispose", error);
          store.dispose();
        },
      );
    }
    const storage = runtimeStorage;
    runtimeStorage = undefined;
    if (storage?.close) {
      void Promise.resolve(storage.close()).catch((error) => {
        console.debug("[gpen] ignored rejection: gpen document storage close", error);
        return;
      });
    }
  }

  // 自动保存间隔是 `createGpenBinaryStore` 的构造参数，改了只能重建 store。
  // 重建前**必须先把旧 store 挂起的写入刷盘**，否则最后一次编辑会丢（见文件头第 3 条）。
  $effect(() => {
    const next = preferencesState().autoSaveDebounceMs;
    const storage = runtimeStorage;
    if (!ready || !storage || next === appliedDebounceMs) return;
    appliedDebounceMs = next;
    const previous = gpenStore;
    gpenStore = createGpenBinaryStore({
      kv: storage.kv,
      blob: storage.blob,
      cache: true,
      debounceMs: next,
    });
    if (!previous) return;
    void previous.commit().then(
      () => previous.dispose(),
      (error) => {
        console.debug("[gpen] ignored rejection: gpen document debounce rebuild", error);
        previous.dispose();
      },
    );
  });

  // 文档变化 → debounce 落盘。`ready` 之前不写：load 是异步的，
  // 不然默认文档会在 load 读到存档之前把它覆盖掉（见文件头第 1 条）。
  $effect(() => {
    const current = document;
    if (!ready || !current || !gpenStore) return;
    void gpenStore.save(GPEN_DOCUMENT_ID, current).catch((error) => {
      console.debug("[gpen] ignored rejection: gpen document save", error);
      return;
    });
  });

  return {
    get document() {
      return document;
    },
    get ready() {
      return ready;
    },
    get status() {
      return status;
    },
    get edited() {
      return edited;
    },
    get historyState() {
      return historyState;
    },
    get kv() {
      return runtimeStorage?.kv;
    },
    start,
    dispose,
    assign,
    pushUndo,
    undo,
    redo,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    commitStroke,
    commitErase,
    endEraseGesture,
    saveNow,
    clear,
    createNew,
    openStored,
    saveCopy,
    readToolbar,
    writeBrush,
    writeEraser,
    mirrorToolId,
    resetToolbar,
  };
}
