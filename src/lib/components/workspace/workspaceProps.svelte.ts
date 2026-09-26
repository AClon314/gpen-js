/**
 * 工作区各 dockview 面板的 props 工厂。
 *
 * dockview 用 `mount()` 起面板，props 只在 `init()` 时求值一次；面板要持续跟随
 * 文档 / 偏好 / 工作区状态，就得拿到**稳定的 `$state` 代理对象**，之后由 `$effect`
 * 往字段上赋值（受控值优先、回调总是触发，见 src/lib/layers/tree/README.md §3.4）。
 *
 * 这一块从 `GpenWorkspace.svelte` 搬出来（那个文件逼近 1000 行）：props 的定义与
 * 「状态 → props」的同步都在这里，组件只保留注册进 dockview 的 `componentProps`。
 * 依赖全部通过 getter 注入（`getWorkspaceState` / `getLayerTree` / …）——`$derived`
 * 变量按值传进来会冻结成调用时的快照，必须按 getter 读才保持响应式。
 *
 * 按面板拆成几个小工厂（每个 ≤ 60 NLOC，见 repowise 门禁）：一个工厂同时拥有
 * 「props 初值」与「它的同步 `$effect`」，改一个面板只看一处。
 */
import type { BrushSettingsT, EraserSettingsT } from "gpen-protocol/flatbuffers";
import type { GpenToolId, GpenWorkspaceState } from "../gpenWorkspaceState";
import { UI_SCALE_DEFAULT } from "../gpenWorkspaceState";
import type { GpenDocumentSession } from "../gpenDocumentSession.svelte";
import { GPEN_DOCUMENT_ID } from "../gpenDocumentSession.svelte";
import { preferences as preferencesState, updatePreferences } from "../gpenPreferencesState.svelte";
import { codeAreaSourceIdOf, getCodeAreaSource } from "../codeArea/source";
import type { LayerView } from "../../layers/layerView";
import type { StrokePointInput } from "../../layers/strokeOps";
import type { UiLayerTree, UiLayerTreeNode } from "../../layers/types";
import type { TreeKey, TreeOp } from "../../layers/tree/index.js";

/** CodeArea 的组件名（`panelComponents` 的键，也是 `addPanel` 的 `component`）。
 * 一个组件服务所有数据源，区别在面板 id：`codearea:<sourceId>`。 */
export const CODE_AREA_COMPONENT = "codearea";

/** `createWorkspaceProps` 需要的组件能力；全是 getter / 转发，不持有组件状态。 */
export interface WorkspacePropsDeps {
  session: GpenDocumentSession;
  hostViewState: { rotation: number };
  rotateHostView(degrees: number): void;
  selectTool(tool: GpenToolId): void;
  changeUiScale(delta: number): void;
  resetUiScale(): void;
  resetPreferencesAndTool(): void;
  resetPanelLayout(): void;
  openPreferences(): void;
  onMinimize?: () => void;
  onClose?: () => void;
  getWorkspaceState(): GpenWorkspaceState;
  getLayerTree(): UiLayerTree | undefined;
  getDocument(): GpenDocumentSession["document"];
  getLayerView(): LayerView | undefined;
  activateLayerNode(key: TreeKey): void;
  renameLayerNode(key: TreeKey, name: string): void;
  moveLayerNodes(ops: TreeOp[]): void;
}

/** 首次展开集合：所有有子节点的图层（文档重建时只取一次）。 */
function groupKeys(root: UiLayerTreeNode | null): Set<TreeKey> {
  const keys = new Set<TreeKey>();
  const visit = (node: UiLayerTreeNode): void => {
    if (node.children.length > 0) keys.add(node.node_index);
    for (const child of node.children) visit(child);
  };
  if (root) visit(root);
  return keys;
}

/**
 * 图层树的 props：受控三件套（受控值优先、回调总是触发，见 src/lib/layers/tree/README.md §3.4）。
 * 首次拿到树时把有子节点的项都展开。
 */
function createOutlinerProps(deps: WorkspacePropsDeps) {
  const outlinerProps = $state<{
    tree: UiLayerTree | undefined;
    selectedKeys: ReadonlySet<TreeKey>;
    activeKey: TreeKey | undefined;
    expandedKeys: ReadonlySet<TreeKey>;
    onSelectionChange: (keys: Set<TreeKey>) => void;
    onActivate: (key: TreeKey) => void;
    onExpandedChange: (keys: Set<TreeKey>) => void;
    onRename: (key: TreeKey, name: string) => void;
    onMove: (ops: TreeOp[]) => void;
    /** 「重命名活动项」请求号（F2 / 菜单）；Outliner 只读它。 */
    renameRequest: number;
  }>({
    tree: undefined,
    selectedKeys: new Set<TreeKey>(),
    activeKey: undefined,
    expandedKeys: new Set<TreeKey>(),
    onSelectionChange: (keys) => {
      outlinerProps.selectedKeys = keys;
    },
    onActivate: (key) => deps.activateLayerNode(key),
    onExpandedChange: (keys) => {
      outlinerProps.expandedKeys = keys;
    },
    onRename: (key, name) => deps.renameLayerNode(key, name),
    onMove: (ops) => deps.moveLayerNodes(ops),
    renameRequest: 0,
  });

  let expandedInitialized = false;

  // 文档 → 树 / active / 首次展开集合（`$state` 代理跨 dockview `mount()` 同步）。
  $effect(() => {
    const tree = deps.getLayerTree();
    outlinerProps.tree = tree;
    outlinerProps.activeKey = tree?.active_node?.node_index;
    if (!expandedInitialized && tree) {
      expandedInitialized = true;
      outlinerProps.expandedKeys = groupKeys(tree.root);
    }
  });

  return outlinerProps;
}

/**
 * 视口面板的 props：画布需要文档（重绘）+ layerView（坐标映射）+ onStroke，
 * 以及当前工具与画笔 / 橡皮参数（真值来自协议 `ToolbarState`）。
 */
function createViewportProps(deps: WorkspacePropsDeps) {
  const { session } = deps;
  const viewportProps = $state<{
    viewState: { rotation: number };
    onRotate: (degrees: number) => void;
    document: GpenDocumentSession["document"];
    layerView: LayerView | undefined;
    onStroke: (points: StrokePointInput[]) => void;
    onErase: (point: { x: number; y: number }) => void;
    onEraseEnd: () => void;
    activeTool: GpenToolId;
    brush: BrushSettingsT | undefined;
    eraser: EraserSettingsT | undefined;
  }>({
    viewState: deps.hostViewState,
    onRotate: deps.rotateHostView,
    document: undefined,
    layerView: undefined,
    onStroke: (points: StrokePointInput[]) => session.commitStroke(points),
    onErase: (point: { x: number; y: number }) => session.commitErase(point),
    onEraseEnd: () => session.endEraseGesture(),
    activeTool: "brush",
    brush: undefined,
    eraser: undefined,
  });

  // 文档 / 图层视图 → 画布重绘与坐标映射。
  $effect(() => {
    viewportProps.document = deps.getDocument();
    viewportProps.layerView = deps.getLayerView();
  });

  // 当前工具与画笔 / 橡皮参数（工具轨 / 设置面板改了要立即生效）。
  $effect(() => {
    const toolbar = session.readToolbar();
    viewportProps.activeTool = deps.getWorkspaceState().activeTool;
    viewportProps.brush = toolbar?.brush ?? undefined;
    viewportProps.eraser = toolbar?.eraser ?? undefined;
  });

  return viewportProps;
}

/**
 * 偏好面板的 props：里面**没有本地副本**——偏好层来自 `gpenPreferencesState`，
 * 工具层来自文档，布局层来自 `workspaceState`，面板只读它们并把改动回调出去。
 */
function createPreferencesProps(deps: WorkspacePropsDeps) {
  const { session } = deps;
  const preferencesProps = $state<{
    preferences: ReturnType<typeof preferencesState>;
    uiScale: number;
    onChangeUiScale: (delta: number) => void;
    onResetUiScale: () => void;
    brush: BrushSettingsT | undefined;
    eraser: EraserSettingsT | undefined;
    onChangeBrush: (patch: Partial<BrushSettingsT>) => void;
    onChangeEraser: (patch: Partial<EraserSettingsT>) => void;
    onChangePreferences: typeof updatePreferences;
    onResetPreferences: () => void;
    onResetPanelLayout: () => void;
    documentId: string;
    storageStatus: string;
    onClearDocument: () => void;
  }>({
    preferences: preferencesState(),
    uiScale: UI_SCALE_DEFAULT,
    onChangeUiScale: deps.changeUiScale,
    onResetUiScale: deps.resetUiScale,
    brush: undefined,
    eraser: undefined,
    onChangeBrush: (patch) => session.writeBrush(patch),
    onChangeEraser: (patch) => session.writeEraser(patch),
    onChangePreferences: updatePreferences,
    onResetPreferences: deps.resetPreferencesAndTool,
    onResetPanelLayout: () => deps.resetPanelLayout(),
    documentId: GPEN_DOCUMENT_ID,
    storageStatus: session.status,
    onClearDocument: () => session.clear(),
  });

  // 偏好 / 工具 / 布局三层 → 偏好面板 props。
  $effect(() => {
    preferencesProps.preferences = preferencesState();
    preferencesProps.uiScale = deps.getWorkspaceState().uiScale;
    const toolbar = session.readToolbar();
    preferencesProps.brush = toolbar?.brush ?? undefined;
    preferencesProps.eraser = toolbar?.eraser ?? undefined;
    preferencesProps.storageStatus = session.status;
  });

  return preferencesProps;
}

/**
 * 属性面板的 props：与设置面板共用同一套画笔 / 橡皮参数（真值在协议 `ToolbarState`），
 * 只是属性面板跟随当前工具。
 */
function createPropertiesProps(deps: WorkspacePropsDeps) {
  const { session } = deps;
  const propertiesProps = $state<{
    brush: BrushSettingsT | undefined;
    eraser: EraserSettingsT | undefined;
    activeTool: GpenToolId;
    onChangeBrush: (patch: Partial<BrushSettingsT>) => void;
    onChangeEraser: (patch: Partial<EraserSettingsT>) => void;
  }>({
    brush: undefined,
    eraser: undefined,
    activeTool: "brush",
    onChangeBrush: (patch) => session.writeBrush(patch),
    onChangeEraser: (patch) => session.writeEraser(patch),
  });

  // 工具 + 协议 `ToolbarState` → 属性面板 props。
  $effect(() => {
    const toolbar = session.readToolbar();
    propertiesProps.brush = toolbar?.brush ?? undefined;
    propertiesProps.eraser = toolbar?.eraser ?? undefined;
    propertiesProps.activeTool = deps.getWorkspaceState().activeTool;
  });

  return propertiesProps;
}

type OutlinerProps = ReturnType<typeof createOutlinerProps>;
type ViewportProps = ReturnType<typeof createViewportProps>;
type PreferencesProps = ReturnType<typeof createPreferencesProps>;
type PropertiesProps = ReturnType<typeof createPropertiesProps>;

interface WorkspacePropsBundle {
  outlinerProps: OutlinerProps;
  viewportProps: ViewportProps;
  preferencesProps: PreferencesProps;
  propertiesProps: PropertiesProps;
}

/**
 * The menu panel hosts the whole title bar (menus, ui scale, close), and the
 * tool strip owns the active tool, so both need callbacks. The other panels
 * keep their own local state and are mounted without props.
 */
function componentProps(
  deps: WorkspacePropsDeps,
  bundle: WorkspacePropsBundle,
  name: string,
  id: string,
): Record<string, unknown> | undefined {
  if (name === "tools") {
    return { state: deps.getWorkspaceState(), onSelectTool: deps.selectTool };
  }
  if (name === "viewport") return bundle.viewportProps;
  if (name === "outliner") return bundle.outlinerProps;
  if (name === "preferences") return bundle.preferencesProps;
  // CodeArea 一个组件服务所有数据源：面板 id 里带着 sourceId，这里把它翻回数据源。
  if (name === CODE_AREA_COMPONENT) {
    const sourceId = codeAreaSourceIdOf(id);
    return { source: sourceId ? getCodeAreaSource(sourceId) : undefined };
  }
  // 属性面板与设置面板共用同一套画笔 / 橡皮参数（真值在协议 `ToolbarState`）。
  if (name === "properties") return bundle.propertiesProps;
  if (name === "statusbar") {
    return {
      state: deps.session.historyState,
      onUndo: () => deps.session.undo(),
      onRedo: () => deps.session.redo(),
    };
  }
  if (name === "menu") {
    return {
      state: deps.getWorkspaceState(),
      onChangeUiScale: deps.changeUiScale,
      onResetUiScale: deps.resetUiScale,
      onOpenPreferences: deps.openPreferences,
      onMinimize: deps.onMinimize,
      onClose: deps.onClose,
    };
  }
  return undefined;
}

/** 组装四个面板的 props 代理 + `createComponent` 用的 `componentProps`。 */
export function createWorkspaceProps(deps: WorkspacePropsDeps) {
  const bundle: WorkspacePropsBundle = {
    outlinerProps: createOutlinerProps(deps),
    viewportProps: createViewportProps(deps),
    preferencesProps: createPreferencesProps(deps),
    propertiesProps: createPropertiesProps(deps),
  };
  return {
    outlinerProps: bundle.outlinerProps,
    componentProps: (name: string, id: string) => componentProps(deps, bundle, name, id),
  };
}
