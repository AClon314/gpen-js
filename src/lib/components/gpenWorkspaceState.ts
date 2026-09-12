import type { JsonValue, Storage } from "../bindings/storage/index.js";

export const GPEN_WORKSPACE_STATE_KEY = "gpen.workspaceState";
export const GPEN_UI_SCALE_KEY = "gpen.uiScale";

export const UI_SCALE_MIN = 0.5;
export const UI_SCALE_MAX = 2;
export const UI_SCALE_STEP = 0.25;
export const UI_SCALE_DEFAULT = 1;

export const TOOL_IDS = [
  "brush",
  "eraser",
  "fill",
  "lasso",
  "select",
  "picker",
  "transform",
  "more",
  "mouse",
] as const;

export type GpenToolId = (typeof TOOL_IDS)[number];

/** The JSON-safe layout returned by dockview.toJSON(). */
export type GpenPanelLayout = Record<string, JsonValue>;

/** Persisted top-left of the floating ball (CSS px, viewport coordinates). */
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
  collapsed: boolean;
  activeTool: GpenToolId;
  panelLayout: GpenPanelLayout | null;
  ballPosition: GpenBallPosition | null;
}

export type GpenWorkspaceStateSnapshot = GpenWorkspaceState;

export type GpenWorkspaceStatePatch = Partial<GpenWorkspaceState>;

export interface GpenWorkspaceStateStorage {
  load(): Promise<GpenWorkspaceStatePatch | undefined>;
  save(state: GpenWorkspaceStateSnapshot): Promise<void>;
}

export type GpenWorkspaceStorageRecord = {
  workspace: GpenWorkspaceStateSnapshot;
};

export function normalizeUiScale(value: number): number {
  const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
  return Number(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped)).toFixed(2));
}

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

export function normalizeGpenWorkspaceState(
  value: unknown,
  fallback: GpenWorkspaceState = createDefaultGpenWorkspaceState(),
): GpenWorkspaceState {
  const source = isRecord(value) ? value : {};
  const panelLayout = Object.prototype.hasOwnProperty.call(source, "panelLayout")
    ? normalizePanelLayout(source.panelLayout)
    : fallback.panelLayout;
  const ballPosition = Object.prototype.hasOwnProperty.call(source, "ballPosition")
    ? normalizeBallPosition(source.ballPosition)
    : fallback.ballPosition;

  return {
    version: 1,
    uiScale:
      typeof source.uiScale === "number" && Number.isFinite(source.uiScale)
        ? normalizeUiScale(source.uiScale)
        : fallback.uiScale,
    open: typeof source.open === "boolean" ? source.open : fallback.open,
    collapsed: typeof source.collapsed === "boolean" ? source.collapsed : fallback.collapsed,
    activeTool: isToolId(source.activeTool) ? source.activeTool : fallback.activeTool,
    panelLayout,
    ballPosition,
  };
}

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

/**
 * The current web adapter. It keeps the old uiScale key in sync so existing
 * users migrate without losing their setting. All component code talks to the
 * GpenWorkspaceStateStorage interface rather than localStorage directly.
 */
export function createLocalStorageGpenWorkspaceStateStorage(): GpenWorkspaceStateStorage {
  return {
    async load() {
      try {
        const local = globalThis.localStorage;
        const encodedState = local.getItem(GPEN_WORKSPACE_STATE_KEY);
        const legacyScale = local.getItem(GPEN_UI_SCALE_KEY);
        let parsed: GpenWorkspaceStatePatch | undefined;

        if (encodedState !== null) {
          const value: unknown = JSON.parse(encodedState);
          if (isRecord(value)) parsed = value as GpenWorkspaceStatePatch;
        }

        if (parsed && parsed.uiScale === undefined && legacyScale !== null) {
          const scale = Number(legacyScale);
          if (Number.isFinite(scale)) parsed = { ...parsed, uiScale: scale };
        }

        if (parsed) return parsed;
        if (legacyScale === null) return undefined;

        const scale = Number(legacyScale);
        return Number.isFinite(scale) ? { uiScale: scale } : undefined;
      } catch (error) {
        console.debug("[gpen] ignored rejection: workspace state localStorage load", error);
        return undefined;
      }
    },
    async save(state) {
      try {
        const local = globalThis.localStorage;
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

export function cloneGpenPanelLayout(value: unknown): GpenPanelLayout | null {
  return normalizePanelLayout(value);
}
