/**
 * 内置调试源的读取器（文件菜单「调试：内部 JSON 状态树」）。
 *
 * 从 `GpenWorkspace.svelte` 搬出来的：摘要与视口读数都是「只读内存里的 `$state`」，
 * 放在这里让组件只保留一行注册。所有值经 getter 注入，保证读到的仍是实时的
 * `$state`（见 `workspaceProps.svelte.ts` 的同一条理由）。
 *
 * 高频值（scroll / pinch 平移）会推动这棵树，限频靠 CodeArea 的去抖（250ms），
 * 不在数据层藏字段。
 */
import { preferences as preferencesState } from "../gpenPreferencesState.svelte";
import { serializeGpenPreferences } from "../gpenPreferences";
import { normalizeUiScale, serializeGpenWorkspaceState } from "../gpenWorkspaceState";
import type { GpenWorkspaceState } from "../gpenWorkspaceState";
import type { GpenDocumentSession } from "../gpenDocumentSession.svelte";
import type { GpenT } from "gpen-protocol/flatbuffers";
import { menuState } from "../contextMenu/contextMenu.svelte";
import { createInternalStateSource } from "../codeArea/internalState";
import type { CodeAreaSource } from "../codeArea/source";
import { pageOffset, viewportOffset, viewportSize, viewportZoom } from "#lib/visualViewport";
import { strokesOfDocument } from "../../layers/strokeOps";
import { GPEN_DOCUMENT_ID } from "../gpenDocumentSession.svelte";

/** `createWorkspaceDebugSource` 需要的组件读数（全部按 getter 注入）。 */
export interface WorkspaceDebugDeps {
  session: GpenDocumentSession;
  getDocument(): GpenT | undefined;
  getWorkspaceState(): GpenWorkspaceState;
  getLayout(): { width: number | undefined; height: number | undefined };
  getZoom(): { external: number; workspace: number };
  getViewport(): { width: number; height: number; revision: number };
}

/** 文档摘要：不是整篇文档（那可能几 MB），只给排查需要的计数与状态。 */
function documentSummary(deps: WorkspaceDebugDeps): Record<string, unknown> {
  const { session } = deps;
  const document = deps.getDocument();
  return {
    id: GPEN_DOCUMENT_ID,
    edited: session.edited,
    ready: session.ready,
    storageStatus: session.status,
    nodes: document?.nodes?.length ?? 0,
    layers: document?.layers?.length ?? 0,
    groups: document?.groups?.length ?? 0,
    strokes: document ? strokesOfDocument(document).length : 0,
    undoDepth: session.historyState.undoDepth,
    redoDepth: session.historyState.redoDepth,
  };
}

/**
 * 实时视口 / 缩放读数：排查「菜单不跟着缩放」「sash 增量不对」时最先要看的就是这几个数。
 *
 * 内容刻意**完整**（含 `scrollX/scrollY`、`visualViewport` 平移量、overlay / 菜单 / spacer
 * 的当前位置）：限频交给 CodeArea 的去抖，这里不藏数据。
 */
function viewportDebugSnapshot(deps: WorkspaceDebugDeps): Record<string, unknown> {
  const size = viewportSize();
  const offset = viewportOffset();
  const page = pageOffset();
  const root = document.documentElement;
  const layout = deps.getLayout();
  const zoom = deps.getZoom();
  const viewport = deps.getViewport();
  return {
    // 订阅用：`observeViewport` 每次回调 +1，scroll / pinch / resize 都能推到这棵树。
    revision: viewport.revision,
    uiScale: normalizeUiScale(deps.getWorkspaceState().uiScale),
    externalZoom: zoom.external,
    workspaceZoom: zoom.workspace,
    dpr: typeof window === "undefined" ? 1 : window.devicePixelRatio,
    container: { width: layout.width ?? null, height: layout.height ?? null },
    measured: { width: viewport.width, height: viewport.height },
    visualViewport: {
      width: size.width,
      height: size.height,
      scale: viewportZoom(),
      offsetLeft: offset.x,
      offsetTop: offset.y,
      pageLeft: page.x,
      pageTop: page.y,
    },
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    // spacer 相机的画布范围（`scrollHeight` 被撑到 20 万就是它，不是页面真实几何）。
    document: {
      scrollWidth: root.scrollWidth,
      scrollHeight: root.scrollHeight,
      clientWidth: root.clientWidth,
      clientHeight: root.clientHeight,
    },
    // 一手几何：overlay（可见视口盒）、右键菜单、相机 spacer。
    elements: {
      overlay: elementDebugRect(".gpen-overlay"),
      menu: elementDebugRect("[data-context-menu-root]"),
      canvasSpace: elementDebugRect("[data-gpen-canvas-space]"),
    },
  };
}

/** 元素的 inline 定位 + 视觉矩形（`zoom` 下 inline px 与 rect 会不一，正是要看的点）。 */
function elementDebugRect(selector: string): Record<string, unknown> | null {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    style: {
      top: element.style.top,
      left: element.style.left,
      width: element.style.width,
      height: element.style.height,
      zoom: element.style.zoom,
    },
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    offsetWidth: element.offsetWidth,
    offsetHeight: element.offsetHeight,
  };
}

/** 内部 JSON 状态树的数据源（同步部分读内存；KV 走 `load()`）。 */
export function createWorkspaceDebugSource(deps: WorkspaceDebugDeps): CodeAreaSource {
  return createInternalStateSource({
    workspaceState: () => serializeGpenWorkspaceState(deps.getWorkspaceState()),
    preferences: () => serializeGpenPreferences(preferencesState()),
    document: () => documentSummary(deps),
    viewport: () => viewportDebugSnapshot(deps),
    menu: () => ({ menuState }),
    gpenKv: () => deps.session.kv,
  });
}
