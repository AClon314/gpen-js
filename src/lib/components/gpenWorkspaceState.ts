import type { JsonValue, Storage } from "../bindings/storage/index.js";
import {
  createRuntimeStorage,
  type HookedBlobBackend,
  type RuntimeStorageOptions,
} from "../bindings/storage/index.js";

/** 旧版 localStorage 里整份工作区状态的 key。 */
export const GPEN_WORKSPACE_STATE_KEY = "gpen.workspaceState";
/** 旧版 localStorage 里 uiScale 的 key。 */
export const GPEN_UI_SCALE_KEY = "gpen.uiScale";

/** uiScale 下限。 */
export const UI_SCALE_MIN = 0.5;
/** uiScale 上限。 */
export const UI_SCALE_MAX = 2;
/** uiScale 的步进（归一化时对齐到它）。 */
export const UI_SCALE_STEP = 0.25;
/** uiScale 默认值（1 = 不缩放）。 */
export const UI_SCALE_DEFAULT = 1;

/**
 * Tools shown in the rail: drawing tools plus `page`, which gives the pointer
 * back to the host page (the drawing surface leaves hit testing). Hiding the
 * whole workspace is the title bar's minimize action (see `collapsed`).
 */
export const TOOL_IDS = [
  "brush",
  "eraser",
  "fill",
  "lasso",
  "select",
  "picker",
  "transform",
  "more",
  "page",
] as const;

/** 工具栏可选的工具 id。 */
export type GpenToolId = (typeof TOOL_IDS)[number];

/** The JSON-safe layout returned by dockview.toJSON(). */
export type GpenPanelLayout = Record<string, JsonValue>;

/**
 * Persisted top-left of the floating ball (CSS px, **visual-viewport** coordinates).
 *
 * 视觉视口坐标 = 相对 `visualViewport` 左上角，也就是用户看到的位置。手机 pinch 放大后
 * 布局视口不变、只有视觉视口变，所以存"看到的位置"才能让球在缩放/平移后依然贴边
 * （DOM 侧的坐标换算在 `gestures/draggable.ts` 里，`anchor: 'page'`）。
 */
export type GpenBallPosition = { x: number; y: number };

/**
 * All UI state that belongs to one workspace instance.
 *
 * Keep this object JSON-serializable: a future runtime/KV storage adapter can
 * persist it without knowing anything about Svelte or dockview instances.
 */
export interface GpenWorkspaceState {
  [key: string]: JsonValue;
  version: 1;
  uiScale: number;
  open: boolean;
  /** 最小化：整个工作区收走，只剩「显示面板 / 关闭」两个浮起按钮。 */
  collapsed: boolean;
  activeTool: GpenToolId;
  panelLayout: GpenPanelLayout | null;
  ballPosition: GpenBallPosition | null;
}

/** 落盘用的工作区状态（与 `GpenWorkspaceState` 同形）。 */
export type GpenWorkspaceStateSnapshot = GpenWorkspaceState;

/** 部分工作区状态（恢复 / 迁移时用）。 */
export type GpenWorkspaceStatePatch = Partial<GpenWorkspaceState>;

/** 工作区状态的存储适配器接口。 */
export interface GpenWorkspaceStateStorage {
  load(): Promise<GpenWorkspaceStatePatch | undefined>;
  save(state: GpenWorkspaceStateSnapshot): Promise<void>;
  /** 释放后端持有资源（IndexedDB 连接等）；localStorage 适配器是 no-op。 */
  close?(): void | Promise<void>;
}

/** KV 里存的工作区记录（`{ workspace }`）。 */
export type GpenWorkspaceStorageRecord = {
  workspace: GpenWorkspaceStateSnapshot;
};

/** 把 uiScale 对齐到步进并夹进上下限。 */
export function normalizeUiScale(value: number): number {
  const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Number(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped)).toFixed(2));
}

/** 默认工作区状态（未打开、无布局、无浮窗位置）。 */
export function createDefaultGpenWorkspaceState(): GpenWorkspaceState {
  return {
    version: 1,
    uiScale: UI_SCALE_DEFAULT,
    open: false,
    collapsed: false,
    activeTool: "brush",
    panelLayout: null,
    ballPosition: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isToolId(value: unknown): value is GpenToolId {
  return typeof value === "string" && (TOOL_IDS as readonly string[]).includes(value);
}

function cloneJsonValue(value: unknown): JsonValue | undefined {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return undefined;
    return JSON.parse(encoded) as JsonValue;
  } catch (error) {
    console.debug("[gpen] ignored rejection: workspace state JSON clone", error);
    return undefined;
  }
}

function normalizePanelLayout(value: unknown): GpenPanelLayout | null {
  if (!isRecord(value)) return null;
  const cloned = cloneJsonValue(value);
  return isRecord(cloned) ? (cloned as GpenPanelLayout) : null;
}

function normalizeBallPosition(value: unknown): GpenBallPosition | null {
  if (!isRecord(value)) return null;
  const { x, y } = value;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/** 有限数才接受，否则用 `fallback`（接受时归一化到位权 / 上下限）。 */
function normalizeUiScaleField(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? normalizeUiScale(value) : fallback;
}

/** 布尔字段的容错读取。 */
function normalizeBooleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** `panelLayout`：字段存在才解析（存在但非法 → `null`）；缺失用 `fallback`。 */
function normalizePanelLayoutField(
  source: Record<string, unknown>,
  fallback: GpenPanelLayout | null,
): GpenPanelLayout | null {
  return Object.prototype.hasOwnProperty.call(source, "panelLayout")
    ? normalizePanelLayout(source.panelLayout)
    : fallback;
}

/** `ballPosition`：字段存在才解析（存在但非法 → `null`）；缺失用 `fallback`。 */
function normalizeBallPositionField(
  source: Record<string, unknown>,
  fallback: GpenBallPosition | null,
): GpenBallPosition | null {
  return Object.prototype.hasOwnProperty.call(source, "ballPosition")
    ? normalizeBallPosition(source.ballPosition)
    : fallback;
}

/** 用容错规则把未知值归一化成一棵合法工作区状态。 */
export function normalizeGpenWorkspaceState(
  value: unknown,
  fallback: GpenWorkspaceState = createDefaultGpenWorkspaceState(),
): GpenWorkspaceState {
  const source = isRecord(value) ? value : {};
  return {
    version: 1,
    uiScale: normalizeUiScaleField(source.uiScale, fallback.uiScale),
    open: normalizeBooleanField(source.open, fallback.open),
    collapsed: normalizeBooleanField(source.collapsed, fallback.collapsed),
    activeTool: isToolId(source.activeTool) ? source.activeTool : fallback.activeTool,
    panelLayout: normalizePanelLayoutField(source, fallback.panelLayout),
    ballPosition: normalizeBallPositionField(source, fallback.ballPosition),
  };
}

/** 写出前做一次归一化，保证落盘值合法。 */
export function serializeGpenWorkspaceState(state: GpenWorkspaceState): GpenWorkspaceStateSnapshot {
  return {
    version: 1,
    uiScale: normalizeUiScale(state.uiScale),
    open: state.open,
    collapsed: state.collapsed,
    activeTool: state.activeTool,
    panelLayout: normalizePanelLayout(state.panelLayout),
    ballPosition: normalizeBallPosition(state.ballPosition),
  };
}

/** 旧版 `gpen.workspaceState` 的 JSON 解析：非对象（数组 / 标量）→ `undefined`。 */
function parseLegacyWorkspaceState(encoded: string): GpenWorkspaceStatePatch | undefined {
  // 解析抛错由调用方的 catch 处理（与旧实现同一个日志出口），这里不吞。
  const value: unknown = JSON.parse(encoded);
  return isRecord(value) ? (value as GpenWorkspaceStatePatch) : undefined;
}

/** 旧版 `gpen.uiScale` 字符串的数值解析：缺失 / 非有限数 → `undefined`。 */
function readLegacyUiScale(local: { getItem(key: string): string | null }): number | undefined {
  const raw = local.getItem(GPEN_UI_SCALE_KEY);
  if (raw === null) return undefined;
  const scale = Number(raw);
  return Number.isFinite(scale) ? scale : undefined;
}

/**
 * 读取旧版 localStorage 里的工作区偏好。
 *
 * 旧实现把整个 state 写在 `gpen.workspaceState`（JSON），更早的版本只有一个
 * `gpen.uiScale` 字符串。两者都读，后者作为前者的缺省补充；`gpen.workspaceState`
 * 存在但 JSON 非法时整次读取放弃（与旧实现一致）。
 */
export function readLegacyLocalStorageGpenWorkspaceStatePatch():
  | GpenWorkspaceStatePatch
  | undefined {
  try {
    const local = globalThis.localStorage;
    if (!local) return undefined;
    const encodedState = local.getItem(GPEN_WORKSPACE_STATE_KEY);
    const scale = readLegacyUiScale(local);
    const parsed = encodedState === null ? undefined : parseLegacyWorkspaceState(encodedState);
    if (parsed) {
      return parsed.uiScale === undefined && scale !== undefined
        ? { ...parsed, uiScale: scale }
        : parsed;
    }
    return scale === undefined ? undefined : { uiScale: scale };
  } catch (error) {
    console.debug("[gpen] ignored rejection: workspace state localStorage load", error);
    return undefined;
  }
}

/**
 * 旧版适配器：直接读写 localStorage（含旧 key）。
 *
 * 现在只作为两件事存在：新 RuntimeStorage 适配器的**迁移来源**，以及
 * IndexedDB 不可用时的兼容边界。
 */
export function createLocalStorageGpenWorkspaceStateStorage(): GpenWorkspaceStateStorage {
  return {
    async load() {
      return readLegacyLocalStorageGpenWorkspaceStatePatch();
    },
    async save(state) {
      try {
        const local = globalThis.localStorage;
        if (!local) return;
        const snapshot = serializeGpenWorkspaceState(state);
        local.setItem(GPEN_WORKSPACE_STATE_KEY, JSON.stringify(snapshot));
        // Compatibility with the pre-state-object implementation.
        local.setItem(GPEN_UI_SCALE_KEY, String(snapshot.uiScale));
      } catch (error) {
        console.debug("[gpen] ignored rejection: workspace state localStorage save", error);
        return;
      }
    },
  };
}

/**
 * Adapter seam for createRuntimeStorage()/createKvStorage(). A caller can
 * inject any storage object with the common KV shape without changing the UI.
 */
export function createKvGpenWorkspaceStateStorage(
  storage: Pick<Storage<GpenWorkspaceStorageRecord>, "kv">,
): GpenWorkspaceStateStorage {
  return {
    async load() {
      return await storage.kv.get.workspace;
    },
    async save(state) {
      await storage.kv.set.workspace(serializeGpenWorkspaceState(state));
      await storage.kv.submit();
    },
  };
}

/** 深拷贝一份 dockview 布局（无效值返回 null）。 */
export function cloneGpenPanelLayout(value: unknown): GpenPanelLayout | null {
  return normalizePanelLayout(value);
}

/**
 * 把主 KV 适配器包一层：首次读取时把旧 localStorage 数据迁移过去。
 *
 * 迁移只发生一次（KV 里有 `workspace` 就完全忽略旧 key），旧 key 保留不删
 * ——它们是迁移来源，不是当前事实来源。`legacy` 可注入，便于单测。
 */
export function createMigratingGpenWorkspaceStateStorage(
  storage: GpenWorkspaceStateStorage,
  legacy: GpenWorkspaceStateStorage = createLocalStorageGpenWorkspaceStateStorage(),
): GpenWorkspaceStateStorage {
  return {
    async load() {
      const stored = await storage.load();
      if (stored) return stored;

      const old = await legacy.load();
      if (!old) return undefined;

      const migrated = normalizeGpenWorkspaceState(old);
      try {
        await storage.save(migrated);
      } catch (error) {
        console.debug("[gpen] ignored rejection: workspace state migration", error);
        return migrated;
      }
      return migrated;
    },
    async save(state) {
      await storage.save(state);
    },
    close() {
      return storage.close?.();
    },
  };
}

/**
 * 工作区偏好的默认后端：`createRuntimeStorage()` 的 KV 分区。
 *
 * monkey / vscode / WebExtension 宿主走各自的 KV（不再直连 localStorage）；
 * 普通网页退到 IndexedDB。IndexedDB 不可用时（加载抛错）自动回落到旧
 * localStorage 适配器，旧 key 继续可读可写。
 */
export function createRuntimeGpenWorkspaceStateStorage(
  options: RuntimeStorageOptions<GpenWorkspaceStorageRecord> = {},
): GpenWorkspaceStateStorage {
  const legacy = createLocalStorageGpenWorkspaceStateStorage();
  const runtime = createRuntimeWorkspaceStorage(options);
  let kv = runtime.kv;

  return {
    async load() {
      if (kv) {
        try {
          return await kv.load();
        } catch (error) {
          console.debug("[gpen] ignored rejection: workspace state kv load", error);
          kv = undefined;
          return await legacy.load();
        }
      }
      return await legacy.load();
    },
    async save(state) {
      if (kv) {
        try {
          await kv.save(state);
          return;
        } catch (error) {
          console.debug("[gpen] ignored rejection: workspace state kv save", error);
          kv = undefined;
          await legacy.save(state);
          return;
        }
      }
      await legacy.save(state);
    },
    close() {
      const closing = kv?.close?.();
      void runtime.storage?.close?.();
      return closing;
    },
  };
}

/** Create the runtime KV adapter, degraded to "no KV" when creation fails. */
function createRuntimeWorkspaceStorage(
  options: RuntimeStorageOptions<GpenWorkspaceStorageRecord>,
): {
  storage?: Storage<GpenWorkspaceStorageRecord, HookedBlobBackend>;
  kv?: GpenWorkspaceStateStorage;
} {
  try {
    const storage = createRuntimeStorage<GpenWorkspaceStorageRecord>(options);
    return {
      storage,
      kv: createMigratingGpenWorkspaceStateStorage(
        createKvGpenWorkspaceStateStorage(storage),
        createLocalStorageGpenWorkspaceStateStorage(),
      ),
    };
  } catch (error) {
    console.debug("[gpen] ignored rejection: workspace state runtime storage", error);
    return {};
  }
}
