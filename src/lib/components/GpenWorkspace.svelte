<script lang="ts">
	import { mount, onDestroy, onMount, unmount, type Component } from 'svelte';
	import 'dockview/dist/styles/dockview.css';
	// 必须在 dockview 自带样式之后引入：本文件把 `--dv-*` 映射到 `--gpen-*`。
	import '#lib/themes/dockview.css';
	// 所有 area 共用的外壳样式（容器盒 / 字体 / 图标尺寸 / 小控件状态）。
	import './areas/panel.css';
	// 工作区外壳的全局样式（容器盒 / 洞 / 面板底 / 占位面板）。
	import './workspace.css';
	import {
		createDockview,
		type CreateComponentOptions,
		type IContentRenderer
	} from 'dockview';
	import { type StrokeT } from 'gpen-protocol/flatbuffers';
	import { type BrushSettingsT, type EraserSettingsT } from 'gpen-protocol/flatbuffers';
	import {
		loadPreferences,
		preferences as preferencesState,
		resetPreferences,
		updatePreferences
	} from './gpenPreferencesState.svelte';
	import { buildLayerTree } from '../layers/layerAdapter';
	import { moveNodes, renameNode, setActiveNode, type MoveNodeOp } from '../layers/layerOps';
	import { strokesOfDocument, type StrokePointInput } from '../layers/strokeOps';
	import {
		createGpenDocumentSession,
		GPEN_DOCUMENT_ID,
		type GpenDocumentSession
	} from './gpenDocumentSession.svelte';
	import type { UiLayerTree, UiLayerTreeNode } from '../layers/types';
	import type { TreeKey, TreeOp } from '../layers/tree/index.js';
	import { applyInfiniteCanvas, guessWebLayer, type InfiniteCanvas } from '../canvas/index';
	import { createLayerView, type LayerView } from '../layers/layerView';
	import { installKeymapDispatcher } from '#lib/commands/keymap';
	import {
		registerWorkspaceCommands,
		registerWorkspaceKeyBindings
	} from './workspaceCommands';
	import {
		createDefaultGpenWorkspaceState,
		normalizeUiScale,
		serializeGpenWorkspaceState,
		UI_SCALE_DEFAULT,
		type GpenToolId,
		type GpenWorkspaceState
	} from './gpenWorkspaceState';
	import { serializeGpenPreferences } from './gpenPreferences';
	import { readGpenViewportZoomFactor } from './gpenViewport';
	import { setWorkspaceZoomVariable } from './workspaceZoom';
	import { installSashZoomCorrection } from './workspaceSashZoom';
	import { installFloatingDragZoomCorrection } from './workspaceFloatingDrag';
	import { installFloatingResizeZoomCorrection } from './workspaceFloatingResize';
	import { centeredFloatingBounds } from './workspaceLayout.js';
	import {
		createPanelLayoutController,
		STATUS_BAR_PANEL_ID
	} from './workspacePanelLayout.js';
	import { observeViewport, pageOffset, viewportOffset, viewportSize, viewportZoom } from '#lib/visualViewport';
	import { codeAreaSourceIdOf, getCodeAreaSource, registerCodeAreaSource } from './codeArea/source';
	import { createWorkspaceTabMenu, WORKSPACE_TAB_MENU_ID } from './workspaceTabMenu.js';
	import { openCodeAreaPanel } from './codeArea/panels';
	import {
		createInternalStateSource,
		INTERNAL_STATE_SOURCE_ID
	} from './codeArea/internalState';
	import {
		menuState,
		open as openMenu,
		registerMenuItems,
		type MenuItem
	} from './contextMenu/contextMenu.svelte';
	import BlenderCodeArea from './areas/CodeArea.svelte';
	import BlenderOutliner from './areas/Outliner.svelte';
	import BlenderPreferences from './areas/Preferences.svelte';
	import BlenderProperties from './areas/Properties.svelte';
	import BlenderStatusBar from './areas/StatusBar.svelte';
	import BlenderTimeline from './areas/Timeline.svelte';
	import BlenderToolStrip from './areas/ToolStrip.svelte';
	import BlenderTopBar from './areas/TopBar.svelte';
	import BlenderViewport from './areas/Viewport.svelte';

	let {
		state: providedState,
		minimized = false,
		onClose,
		onMinimize
	}: {
		state?: GpenWorkspaceState;
		/** 最小化时工作区只是被隐藏，**不卸载**——dockview 实例和面板尺寸都留着，
		 * 否则每次还原都要拿存储里的布局重建，尺寸会被重新分摊而失真。 */
		minimized?: boolean;
		onClose?: () => void;
		onMinimize?: () => void;
	} = $props();
	let localState = $state(createDefaultGpenWorkspaceState());
	const workspaceState = $derived(providedState ?? localState);

	/**
	 * 文档会话（内存文档 / 撤销历史 / gpenBinary 落盘 / 笔画提交）在
	 * `gpenDocumentSession.svelte.ts`：这里只保留 UI 侧的读法与调用点。
	 * `gpenDocument` 是 `$derived`（只读）——改文档一律走 `session.assign()` 那套入口。
	 */
	const session: GpenDocumentSession = createGpenDocumentSession();
	const gpenDocument = $derived(session.document);

	// oxlint-disable-next-line no-unassigned-vars
	let container: HTMLDivElement;
	let dockview: ReturnType<typeof createDockview> | undefined;
	/// 图层树只是文档的派生视图：移动/重命名都只改文档（layerOps），
	/// 再由文档重建树 —— 树里的 `children` 与协议的邻接向量永远不会脱节。
	const layerTree = $derived(gpenDocument ? buildLayerTree(gpenDocument) : undefined);
	/// 图层视图：Web 图层（element）或未来的 gpen 画布（canvas）。
	let layerView = $state<LayerView | undefined>(undefined);
	let infiniteCanvas: InfiniteCanvas | undefined;
	/// 视图旋转（度）。真值以后归图层模型；这里只驱动 DOM 投影。
	const hostViewState = $state({ rotation: 0 });

	let disposeTabMenu: (() => void) | undefined;
	/// 命令注册 + 快捷键绑定 + 全局派发器的总 disposer（见 registerCommands）。
	let disposeCommands: (() => void) | undefined;
	/// 内置 CodeArea 调试源的注销函数（见 registerInternalStateSource）。
	let disposeCodeAreaSource: (() => void) | undefined;
	let layoutSubscriptions: { dispose(): void }[] = [];
	let viewportResizeObserver: ResizeObserver | undefined;
	/// sash 拖动 / 浮窗拖动的缩放修正（zoom ≠ 1 时，见 `workspaceSashZoom.ts` / `workspaceFloatingDrag.ts`）。
	let disposeSashZoom: (() => void) | undefined;
	let disposeFloatingDrag: (() => void) | undefined;
	/// 浮窗 resize 的缩放修正（zoom ≠ 1 时接管八个方向的手柄）。
	let disposeFloatingResize: (() => void) | undefined;
	let removeViewportListeners: (() => void) | undefined;
	let mounted = false;

	const PREFERENCES_PANEL_ID = 'preferences';
	/** CodeArea 的组件名（`panelComponents` 的键，也是 `addPanel` 的 `component`）。
	 * 一个组件服务所有数据源，区别在面板 id：`codearea:<sourceId>`。 */
	const CODE_AREA_COMPONENT = 'codearea';
	const PREFERENCES_WIDTH = 420;
	const PREFERENCES_HEIGHT = 520;
	/** 浮动面板与工作区边缘的最小间距（px）。 */
	const FLOAT_MARGIN = 16;

	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	let externalZoomFactor = $state(1);
	/** 可视区变化计数（scroll / pinch / resize）：只给调试树当订阅信号用。 */
	let viewportRevision = $state(0);
	const workspaceZoom = $derived(
		normalizeUiScale(workspaceState.uiScale) / externalZoomFactor
	);
	const layoutWidth = $derived(
		viewportWidth > 0 ? Math.max(1, Math.round(viewportWidth / workspaceZoom)) : undefined
	);
	const layoutHeight = $derived(
		viewportHeight > 0 ? Math.max(1, Math.round(viewportHeight / workspaceZoom)) : undefined
	);
	const containerWidth = $derived(layoutWidth === undefined ? '100%' : `${layoutWidth}px`);
	const containerHeight = $derived(layoutHeight === undefined ? '100%' : `${layoutHeight}px`);

	/**
	 * 面板布局策略（默认布局 / 还原 / 快照 / 约束 / 「洞」标记）在
	 * `workspacePanelLayout.ts`：这里只把 dockview 实例、工作区状态与容器尺寸交给它。
	 */
	const panelLayout = createPanelLayoutController({
		getDockview: () => dockview,
		getState: () => workspaceState,
		measure: measureViewport,
		getLayoutSize: () => ({ width: layoutWidth, height: layoutHeight }),
		getContainer: () => container,
		// 偏好设置是唯一「有首选尺寸」的浮窗；其余浮窗装不下时按当前尺寸缩。
		getFloatingPreferred: (panelId) =>
			panelId === PREFERENCES_PANEL_ID
				? { width: PREFERENCES_WIDTH, height: PREFERENCES_HEIGHT }
				: undefined,
		getFloatingMargin: () => FLOAT_MARGIN
	});

	function changeUiScale(delta: number) {
		workspaceState.uiScale = normalizeUiScale(workspaceState.uiScale + delta);
	}

	function resetUiScale() {
		workspaceState.uiScale = UI_SCALE_DEFAULT;
	}

	/** 视图旋转：不影响文档数据，只改图层视图的 DOM 投影。 */
	function rotateHostView(degrees: number) {
		const next = Math.round(degrees * 10) / 10;
		hostViewState.rotation = next;
		layerView?.setRotation(next);
	}

	function selectTool(tool: GpenToolId) {
		workspaceState.activeTool = tool;
		// 同步一份到协议 `ToolbarState.activeToolId`（handoff §6.1）：UI 真值仍是
		// `workspaceState.activeTool`，文档里只存镜像，不反向覆盖用户的选择。
		session.mirrorToolId(tool);
	}

	function updateExternalZoom() {
		externalZoomFactor = readGpenViewportZoomFactor();
	}

	/**
	 * dockview 用 `mount()` 起面板，props 只在 init 时传一次。这个对象是 `$state`
	 * 代理，所以之后对字段的赋值会推给子组件；Outliner 侧对应的是「受控三件套」
	 * （受控值优先、回调总是触发，见 docs/tree.md §3.4）。
	 */
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
		onActivate: (key) => activateLayerNode(key),
		onExpandedChange: (keys) => {
			outlinerProps.expandedKeys = keys;
		},
		onRename: (key, name) => renameLayerNode(key, name),
		onMove: (ops) => moveLayerNodes(ops),
		renameRequest: 0
	});

	/**
	 * 视口面板的 props：与 outlinerProps 同一套路（`$state` 代理跨 dockview
	 * `mount()` 同步）。画布需要文档（重绘）+ layerView（坐标映射）+ onStroke，
	 * 以及当前工具与画笔 / 橡皮参数（真值来自协议 `ToolbarState`）。
	 */	const viewportProps = $state<{
		viewState: { rotation: number };
		onRotate: (degrees: number) => void;
		document: GpenDocumentSession['document'];
		layerView: LayerView | undefined;
		onStroke: (points: StrokePointInput[]) => void;
		onErase: (point: { x: number; y: number }) => void;
		onEraseEnd: () => void;
		activeTool: GpenToolId;
		brush: BrushSettingsT | undefined;
		eraser: EraserSettingsT | undefined;
	}>({
		viewState: hostViewState,
		onRotate: rotateHostView,
		document: undefined,
		layerView: undefined,
		onStroke: (points: StrokePointInput[]) => session.commitStroke(points),
		onErase: (point: { x: number; y: number }) => session.commitErase(point),
		onEraseEnd: () => session.endEraseGesture(),
		activeTool: 'brush',
		brush: undefined,
		eraser: undefined
	});

	/**
	 * 偏好面板的 props。同样是 `$state` 代理（跨 dockview `mount()` 同步），
	 * 但里面**没有本地副本**：偏好层来自 `gpenPreferencesState`，工具层来自文档，
	 * 布局层来自 `workspaceState`，面板只读它们并把改动回调出去。
	 */
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
		onChangeUiScale: changeUiScale,
		onResetUiScale: resetUiScale,
		brush: undefined,
		eraser: undefined,
		onChangeBrush: (patch) => session.writeBrush(patch),
		onChangeEraser: (patch) => session.writeEraser(patch),
		onChangePreferences: updatePreferences,
		onResetPreferences: resetPreferencesAndTool,
		onResetPanelLayout: () => panelLayout.reset(),
		documentId: GPEN_DOCUMENT_ID,
		storageStatus: session.status,
		onClearDocument: () => session.clear()
	});

	// 偏好 / 工具 / 布局三层 → 偏好面板 props。
	$effect(() => {
		preferencesProps.preferences = preferencesState();
		preferencesProps.uiScale = workspaceState.uiScale;
		const state = session.readToolbar();
		preferencesProps.brush = state?.brush ?? undefined;
		preferencesProps.eraser = state?.eraser ?? undefined;
		preferencesProps.storageStatus = session.status;
	});

	/**
	 * 属性面板的 props：和 `viewportProps` / `preferencesProps` 一样是 `$state` 代理
	 * （`componentProps` 只在 `init()` 时求值一次，返回普通对象的话子组件永远看不到变化）。
	 */
	const propertiesProps = $state<{
		brush: BrushSettingsT | undefined;
		eraser: EraserSettingsT | undefined;
		activeTool: GpenToolId;
		onChangeBrush: (patch: Partial<BrushSettingsT>) => void;
		onChangeEraser: (patch: Partial<EraserSettingsT>) => void;
	}>({
		brush: undefined,
		eraser: undefined,
		activeTool: 'brush',
		onChangeBrush: (patch) => session.writeBrush(patch),
		onChangeEraser: (patch) => session.writeEraser(patch)
	});

	// 工具 + 协议 `ToolbarState` → 属性面板 props。
	$effect(() => {
		const state = session.readToolbar();
		propertiesProps.brush = state?.brush ?? undefined;
		propertiesProps.eraser = state?.eraser ?? undefined;
		propertiesProps.activeTool = workspaceState.activeTool;
	});

	let expandedInitialized = false;

	// 文档 → 子组件 props 的单向同步（树、active、首次的展开集合）。
	$effect(() => {
		const tree = layerTree;
		outlinerProps.tree = tree;
		outlinerProps.activeKey = tree?.active_node?.node_index;
		if (!expandedInitialized && tree) {
			expandedInitialized = true;
			outlinerProps.expandedKeys = groupKeys(tree.root);
		}
	});

	// 文档 / 图层视图 → 视口 props（画布重绘与坐标映射都靠它）。
	$effect(() => {
		viewportProps.document = gpenDocument;
		viewportProps.layerView = layerView;
	});

	// 当前工具与画笔 / 橡皮参数 → 视口 props（工具轨 / 设置面板改了要立即生效）。
	$effect(() => {
		const state = session.readToolbar();
		viewportProps.activeTool = workspaceState.activeTool;
		viewportProps.brush = state?.brush ?? undefined;
		viewportProps.eraser = state?.eraser ?? undefined;
	});

	function groupKeys(root: UiLayerTreeNode | null): Set<TreeKey> {
		const keys = new Set<TreeKey>();
		const visit = (node: UiLayerTreeNode): void => {
			if (node.children.length > 0) keys.add(node.node_index);
			for (const child of node.children) visit(child);
		};
		if (root) visit(root);
		return keys;
	}

	function activateLayerNode(key: TreeKey) {
		if (!gpenDocument || gpenDocument.activeNodeIndex === key) return;
		session.assign(setActiveNode(gpenDocument, key));
	}

	function renameLayerNode(key: TreeKey, name: string) {
		if (!gpenDocument) return;
		const current = gpenDocument;
		try {
			const next = renameNode(current, key, name);
			session.pushUndo(current);
			session.assign(next);
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace renameNode', error);
			return;
		}
	}

	/** `TreeOp`（UI 层，key 命名）→ `MoveNodeOp`（文档层，index 命名）。 */
	function moveLayerNodes(ops: TreeOp[]) {
		if (!gpenDocument || ops.length === 0) return;
		const current = gpenDocument;
		const moves: MoveNodeOp[] = ops.map((op) => {
			const move: MoveNodeOp = { nodeIndex: op.key, parentNodeIndex: op.parentKey };
			if (op.beforeKey !== undefined) move.beforeNodeIndex = op.beforeKey;
			return move;
		});
		try {
			const next = moveNodes(current, moves);
			session.pushUndo(current);
			session.assign(next);
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace moveNodes', error);
			return;
		}
	}

	/**
	 * 撤销 / 重做 / 重命名 / 保存都走命令注册表（`gpen.undo` …）：菜单栏显示
	 * 的快捷键就是这里绑定的同一串，不存在“菜单写了 Ctrl+S 但按了没反应”。
	 * 派发器只有一个（`installKeymapDispatcher`），并且会跳过文本框 / CodeMirror。
	 */
	function registerCommands() {
		const disposeCommands = registerWorkspaceCommands({
			undo: () => session.undo(),
			redo: () => session.redo(),
			canUndo: () => session.canUndo(),
			canRedo: () => session.canRedo(),
			renameActive: requestRenameActive,
			resetPanelLayout: () => panelLayout.reset(),
			toggleStatusBar,
			statusBarVisible: () => dockview?.getPanel(STATUS_BAR_PANEL_ID) !== undefined,
			save: () => void session.saveNow(),
			toggleFullscreen: () => void toggleFullscreen(),
			fullscreen: () => typeof document !== 'undefined' && document.fullscreenElement !== null,
			openPreferences,
			openAbout,
			newDocument: () => session.createNew(),
			openDocument: () => void session.openStored(),
			openRecent: () => void session.openStored(),
			saveCopy: () => void session.saveCopy(),
			openInternalJsonState: () => {
				const instance = dockview;
				if (instance) openCodeAreaPanel(instance, INTERNAL_STATE_SOURCE_ID);
			},
			closeWorkspace: () => onClose?.()
		});
		const disposeBindings = registerWorkspaceKeyBindings();
		const removeDispatcher = installKeymapDispatcher();
		return () => {
			disposeBindings();
			disposeCommands();
			removeDispatcher();
		};
	}

	/** 「重命名活动项」（F2 / 编辑菜单）：Outliner 自己决定对哪一行进编辑态。 */
	function requestRenameActive(): boolean {
		if (!gpenDocument) return false;
		outlinerProps.renameRequest += 1;
		return true;
	}

	/** 「关于」：只弹一条版本信息（没有模态框体系，用 alert 最诚实）。 */
	function openAbout(): void {
		if (typeof window === 'undefined') return;
		window.alert(
			`gpen ${__GPEN_VERSION__}\n\n` +
				'绘制在网页之上的 grease-pencil 画布。\n' +
				`文档：${GPEN_DOCUMENT_ID}`
		);
	}

	/** 恢复默认偏好 + 画笔 / 橡皮设置（设置面板的重置）。 */
	function resetPreferencesAndTool(): void {
		// 主题 / 语言的重置由 `$effect` 同步到 DOM。
		void resetPreferences();
		session.resetToolbar();
	}

	/**
	 * Escape 的优先级：菜单 > 浮动面板 > 工作区。
	 *
	 * 用**捕获阶段**（而不是冒泡）是为了不受注册顺序影响：`GpenOverlay` 的
	 * `<svelte:window onkeydown>` 与右键菜单的 `document` 监听都在冒泡阶段，
	 * 捕获阶段先到，所以这里能抢在“关工作区”之前把浮动的偏好面板收掉。
	 * 菜单开着时不插手（那一层由 `contextMenu.svelte.ts` 自己处理）。
	 */
	function handleEscapePriority(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || menuState.visible) return;
		const panel = dockview?.getPanel(PREFERENCES_PANEL_ID);
		if (!panel) return;
		event.preventDefault();
		event.stopPropagation();
		dockview?.removePanel(panel);
	}

	/**
	 * 打开偏好设置：幂等的**浮动** dockview 面板。
	 *
	 * ⚠️ 必须用 `addPanel({ floating: {...} })`，**不要**写成
	 * `addPanel({initialWidth, initialHeight})` + `addFloatingGroup(panel)`：前者会把面板
	 * 开进活动组、顺手 `setSize()` 那个组，**整个网格被重排一次且不会恢复**。
	 * 浮窗的几何（夹到容器内 + 居中）在 `workspaceLayout.ts` 里，有单测。
	 * 详细坑与实测数据见 `docs/preferences.md`。
	 */
	function openPreferences(): void {
		const instance = dockview;
		if (!instance) return;
		const existing = instance.getPanel(PREFERENCES_PANEL_ID);
		if (existing) {
			existing.api.setActive();
			return;
		}
		const bounds = centeredFloatingBounds(
			{ width: instance.width, height: instance.height },
			{ width: PREFERENCES_WIDTH, height: PREFERENCES_HEIGHT },
			FLOAT_MARGIN
		);
		instance.addPanel({
			id: PREFERENCES_PANEL_ID,
			component: PREFERENCES_PANEL_ID,
			title: '偏好设置',
			floating: { ...bounds, dragHandle: 'titlebar' }
		});
	}

	// 磨砂玻璃：容器 class 给 CSS 挂 filter（`:host` 选择器带不了后代组合子，
	// 所以 embed 目标也靠这个 class）；根属性只管 token，由 +layout 维护。
	$effect(() => {
		container.classList.toggle('gpen-blur', preferencesState().blur > 0);
	});

	/** tab 右键菜单 + timeline 占位面板的图层列表（见 `workspaceTabMenu.ts`）。 */
	const tabMenu = createWorkspaceTabMenu({
		getDockview: () => dockview,
		getLayerTree: () => layerTree,
		getContainer: () => container
	});

	/** 文档摘要：不是整篇文档（那可能几 MB），只给排查需要的计数与状态。 */
	function documentSummary(): Record<string, unknown> {
		const document = gpenDocument;
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
			redoDepth: session.historyState.redoDepth
		};
	}

	/**
	 * 实时视口 / 缩放读数：排查「菜单不跟着缩放」「sash 增量不对」时最先要看的就是这几个数。
	 *
	 * 内容刻意**完整**（含 `scrollX/scrollY`、`visualViewport` 平移量、overlay / 菜单 / spacer
	 * 的当前位置）：限频交给 CodeArea 的去抖，这里不藏数据。
	 */
	function viewportDebugSnapshot(): Record<string, unknown> {
		const size = viewportSize();
		const offset = viewportOffset();
		const page = pageOffset();
		const root = document.documentElement;
		return {
			// 订阅用：`observeViewport` 每次回调 +1，scroll / pinch / resize 都能推到这棵树。
			revision: viewportRevision,
			uiScale: normalizeUiScale(workspaceState.uiScale),
			externalZoom: externalZoomFactor,
			workspaceZoom,
			dpr: typeof window === 'undefined' ? 1 : window.devicePixelRatio,
			container: { width: layoutWidth ?? null, height: layoutHeight ?? null },
			measured: { width: viewportWidth, height: viewportHeight },
			visualViewport: {
				width: size.width,
				height: size.height,
				scale: viewportZoom(),
				offsetLeft: offset.x,
				offsetTop: offset.y,
				pageLeft: page.x,
				pageTop: page.y
			},
			window: {
				innerWidth: window.innerWidth,
				innerHeight: window.innerHeight,
				scrollX: window.scrollX,
				scrollY: window.scrollY
			},
			// spacer 相机的画布范围（`scrollHeight` 被撑到 20 万就是它，不是页面真实几何）。
			document: {
				scrollWidth: root.scrollWidth,
				scrollHeight: root.scrollHeight,
				clientWidth: root.clientWidth,
				clientHeight: root.clientHeight
			},
			// 一手几何：overlay（可见视口盒）、右键菜单、相机 spacer。
			elements: {
				overlay: elementDebugRect('.gpen-overlay'),
				menu: elementDebugRect('[data-context-menu-root]'),
				canvasSpace: elementDebugRect('[data-gpen-canvas-space]')
			}
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
				zoom: element.style.zoom
			},
			rect: {
				x: Math.round(rect.x),
				y: Math.round(rect.y),
				width: Math.round(rect.width),
				height: Math.round(rect.height)
			},
			offsetWidth: element.offsetWidth,
			offsetHeight: element.offsetHeight
		};
	}

	/**
	 * 内部 JSON 状态树（文件菜单「调试：内部 JSON 状态树」）的数据源。
	 *
	 * 同步部分只读内存（`$state` / 序列化函数）→ 在面板里是实时的；异步部分（gpenBinary
	 * 的 KV）走 `load()`，只在打开面板与点「刷新」时跑一次。高频值（scroll / pinch 平移）
	 * 会推动这棵树，限频靠 CodeArea 的去抖（250ms），不在数据层藏字段。
	 */
	function registerInternalStateSource(): () => void {
		return registerCodeAreaSource(
			createInternalStateSource({
				workspaceState: () => serializeGpenWorkspaceState(workspaceState),
				preferences: () => serializeGpenPreferences(preferencesState()),
				document: documentSummary,
				viewport: viewportDebugSnapshot,
				menu: () => ({ menuState }),
				gpenKv: () => session.kv
			})
		);
	}

	async function toggleFullscreen(): Promise<void> {
		if (typeof document === 'undefined') return;
		try {
			if (document.fullscreenElement === null) await document.documentElement.requestFullscreen();
			else await document.exitFullscreen();
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace toggleFullscreen', error);
			return;
		}
	}

	/**
	 * 显示 / 隐藏状态栏。重新 add 时必须重跑默认布局里的两步
	 * （`setConstraints({ minimumHeight: 22 })` 与显式高度），否则高度会回到
	 * dockview 的 100px 组最小值（handoff §7 的坑）。
	 */
	function toggleStatusBar(): void {
		const instance = dockview;
		if (!instance) return;
		const panel = instance.getPanel(STATUS_BAR_PANEL_ID);
		if (panel) {
			instance.removePanel(panel);
			return;
		}
		instance.addPanel({
			id: STATUS_BAR_PANEL_ID,
			component: STATUS_BAR_PANEL_ID,
			title: '状态栏',
			position: { referencePanel: 'timeline', direction: 'below' },
			initialHeight: 24,
			minimumHeight: 22
		});
		instance.getPanel(STATUS_BAR_PANEL_ID)?.group.api.setConstraints({ minimumHeight: 22 });
		panelLayout.applyDefaultSizesOnNextLayout();
		panelLayout.schedule();
	}

	// 工作区铺满 overlay：可用尺寸就是父层的 padding box，所以 clientWidth /
	// clientHeight 可以直接用（overlay 不设内边距）。
	function measureViewport() {
		const parent = container.parentElement;
		viewportWidth = Math.max(0, parent?.clientWidth ?? window.innerWidth);
		viewportHeight = Math.max(0, parent?.clientHeight ?? window.innerHeight);
	}

	// CSS `zoom` has to counteract the external browser/pinch factor before the
	// user's uiScale is applied. The resulting formula is:
	//   effective workspace zoom = uiScale / (browser zoom × pinch zoom)
	// The container's unzoomed px box is enlarged by 1/effectiveZoom so its
	// visual box still exactly fills the absolute visual-viewport overlay.
	$effect(() => {
		const zoom = workspaceZoom;
		// 右键菜单不在 dockview 子树里，拿不到那句 `style:zoom`：把缩放写到根元素上，
		// 菜单用 `zoom: var(--gpen-workspace-zoom, 1)` 跟上（见 workspaceZoom.ts）。
		setWorkspaceZoomVariable(zoom);
		if (!mounted) return;
		measureViewport();
		panelLayout.schedule();
	});

	const panelLabels: Record<string, string> = {
		menu: '菜单',
		tools: '工具',
		viewport: '视口',
		timeline: '时间轴'
	};

	const panelComponents: Record<string, Component<any>> = {
		menu: BlenderTopBar,
		tools: BlenderToolStrip,
		viewport: BlenderViewport,
		timeline: BlenderTimeline,
		outliner: BlenderOutliner,
		properties: BlenderProperties,
		statusbar: BlenderStatusBar,
		// 偏好设置：**浮动**面板，不进 `buildDefaultLayout`（否则默认布局变大，
		// 老用户存下的布局里也没有它）。
		preferences: BlenderPreferences,
		// CodeArea：一个组件服务所有数据源（面板 id 是 `codearea:<sourceId>`），
		// 默认当 viewport 组的 file tab 打开。见 `docs/code-area.md`。
		[CODE_AREA_COMPONENT]: BlenderCodeArea
	};

	/**
	 * The menu panel hosts the whole title bar (menus, ui scale, close), and the
	 * tool strip owns the active tool, so both need callbacks. The other panels
	 * keep their own local state and are mounted without props.
	 */
	function componentProps(name: string, id: string): Record<string, unknown> | undefined {
		if (name === 'tools') return { state: workspaceState, onSelectTool: selectTool };
		if (name === 'viewport') return viewportProps;
		if (name === 'outliner') return outlinerProps;
		if (name === 'preferences') return preferencesProps;
		// CodeArea 一个组件服务所有数据源：面板 id 里带着 sourceId，这里把它翻回数据源。
		if (name === CODE_AREA_COMPONENT) {
			const sourceId = codeAreaSourceIdOf(id);
			return { source: sourceId ? getCodeAreaSource(sourceId) : undefined };
		}
		// 属性面板与设置面板共用同一套画笔 / 橡皮参数（真值在协议 `ToolbarState`），
		// 只是属性面板跟随当前工具、设置面板两套都显示。
		if (name === 'properties') return propertiesProps;
		if (name === 'statusbar') {
			return {
				state: session.historyState,
				onUndo: () => session.undo(),
				onRedo: () => session.redo()
			};
		}
		if (name === 'menu') {
			return {
				state: workspaceState,
				onChangeUiScale: changeUiScale,
				onResetUiScale: resetUiScale,
				onOpenPreferences: openPreferences,
				onMinimize,
				onClose
			};
		}
		return undefined;
	}

	function createComponent({ id, name }: CreateComponentOptions): IContentRenderer {
		const Component = panelComponents[name];
		const element = document.createElement('div');

		if (Component) {
			element.className = 'gpen-workspace-content';
			let mountedComponent: Record<string, any> | undefined;

			return {
				element,
				init() {
					if (!mountedComponent) {
						mountedComponent = mount(Component, {
							target: element,
							props: componentProps(name, id)
						});
					}
				},
				dispose() {
					if (mountedComponent) {
						void unmount(mountedComponent);
						mountedComponent = undefined;
					}
				}
			};
		}

		// Keep a small fallback for panels added by future callers before they are
		// registered in panelComponents.
		element.className = 'gpen-workspace-placeholder';
		if (name === 'timeline') {
			const header = document.createElement('div');
			header.className = 'gpen-timeline-header';
			header.textContent = 'timeline · layers';
			element.appendChild(header);
			element.appendChild(tabMenu.createLayerList());
		} else {
			const label = document.createElement('span');
			label.className = 'gpen-placeholder-label';
			label.textContent = panelLabels[name] ?? id;
			element.appendChild(label);
		}

		return {
			element,
			init() {}
		};
	}

	onMount(() => {
		mounted = true;
		updateExternalZoom();
		measureViewport();

		// 内置调试源（文件菜单「调试：内部 JSON 状态树」）。注册表是命令式的，
		// 卸载时要注销，否则同一页面里重新挂载工作区会留下陈旧的数据源。
		disposeCodeAreaSource = registerInternalStateSource();

		// 文档会话：默认文档先把 UI 立起来，再异步读存档（语义守卫在
		// `gpenDocumentSession.svelte.ts` 的文件头）。
		session.start();

		// Guess the host web layer **once**, before the camera spacer exists: the
		// spacer is a body child with a huge area, and re-guessing later would use
		// the rotated AABB. (handoff §5 pit)
		const webLayer = guessWebLayer();
		// Camera: only an absolutely positioned spacer, no node reparenting.
		infiniteCanvas = applyInfiniteCanvas();
		layerView = createLayerView(
			webLayer ? { kind: 'element', element: webLayer } : { kind: 'canvas' }
		);
		if (hostViewState.rotation !== 0) layerView.setRotation(hostViewState.rotation);

		// dockview's tab context-menu hook is gated behind its optional
		// ContextMenu module in the free v8.2 build. Keep the same tab-only
		// interaction locally so the native browser menu is always suppressed.
		dockview = createDockview(container, {
			createComponent,
			defaultHeaderPosition: 'top',
			// Floating groups give dockview's "shift+click a tab to float it"
			// behaviour and the drag/drop overlay preview (the translucent block
			// shown while dragging a tab). Bounds keep floats inside the viewport.
			floatingGroupBounds: 'boundedWithinViewport',
			popoutUrl: `${window.location.origin}${window.location.pathname}`,
			theme: {
				name: 'gpen',
				// dockview 自带主题提供结构默认值（sash 尺寸、drop preview），
				// `gpen-dockview` 再把颜色 / 标题栏指回 --gpen-* token。
				className: 'dockview-theme-light gpen-dockview',
				colorScheme: 'light',
				tabGroupIndicator: 'none'
			}
		});
		// 结构变更（onDidMutateLayout）和尺寸变更（onDidLayoutChange，sash 拖动走这条）
		// 都要记下来：只订前者的话，用户拖过的面板宽度根本不会被持久化。
		const onLayoutEvent = () => panelLayout.handleLayoutEvent();
		layoutSubscriptions = [
			dockview.onDidMutateLayout(onLayoutEvent),
			dockview.onDidLayoutChange(onLayoutEvent)
		];
		measureViewport();
		panelLayout.layoutNow();
		panelLayout.restoreOrBuildDefault();

		disposeTabMenu = registerMenuItems(WORKSPACE_TAB_MENU_ID, tabMenu.items);
		container.addEventListener('contextmenu', tabMenu.handleContextMenu);
		// 捕获阶段：Esc 先收浮动面板，别让它直接关掉整个工作区。
		window.addEventListener('keydown', handleEscapePriority, { capture: true });
		disposeCommands = registerCommands();

		const onViewportChange = () => {
			updateExternalZoom();
			measureViewport();
			// 调试树（viewport 一节）靠它订阅 scroll / pinch / resize：`$state` 一变，
			// 面板里的 JSON 就重算；限频在 CodeArea 的去抖里。
			viewportRevision += 1;
			panelLayout.schedule();
		};
		removeViewportListeners = observeViewport(onViewportChange);
		disposeSashZoom = installSashZoomCorrection({
			container,
			getZoom: () => workspaceZoom
		}).dispose;
		disposeFloatingDrag = installFloatingDragZoomCorrection({
			container,
			getZoom: () => workspaceZoom,
			// 自己写的 left/top 也要进布局快照（`toJSON()` 读的就是它们）。
			onDragEnd: () => panelLayout.handleLayoutEvent()
		}).dispose;
		disposeFloatingResize = installFloatingResizeZoomCorrection({
			container,
			getZoom: () => workspaceZoom,
			// 同拖动：resize 后的 width/height 也要进布局快照。
			onResizeEnd: () => panelLayout.handleLayoutEvent()
		}).dispose;

		const parent = container.parentElement;
		if (typeof ResizeObserver !== 'undefined' && parent) {
			viewportResizeObserver = new ResizeObserver(() => onViewportChange());
			viewportResizeObserver.observe(parent);
		}
		panelLayout.schedule();
	});

	onDestroy(() => {
		mounted = false;
		// 先恢复页面（旋转是 DOM 投影）再收相机 spacer。
		layerView?.restore();
		layerView = undefined;
		infiniteCanvas?.destroy();
		infiniteCanvas = undefined;
		disposeSashZoom?.();
		disposeSashZoom = undefined;
		disposeFloatingDrag?.();
		disposeFloatingDrag = undefined;
		disposeFloatingResize?.();
		disposeFloatingResize = undefined;
		panelLayout.dispose();
		// 工作区没了就把缩放变量收回 1：菜单在别的页面（`/demo/menu`）还得按 1× 渲染。
		setWorkspaceZoomVariable(1);
		removeViewportListeners?.();
		removeViewportListeners = undefined;
		viewportResizeObserver?.disconnect();
		viewportResizeObserver = undefined;
		for (const subscription of layoutSubscriptions) subscription.dispose();
		layoutSubscriptions = [];
		container.removeEventListener('contextmenu', tabMenu.handleContextMenu);
		window.removeEventListener('keydown', handleEscapePriority, { capture: true });
		disposeCommands?.();
		disposeCommands = undefined;
		disposeCodeAreaSource?.();
		disposeCodeAreaSource = undefined;
		disposeTabMenu?.();
		disposeTabMenu = undefined;
		dockview?.dispose();
		dockview = undefined;

		session.dispose();
	});
</script>

<div
	bind:this={container}
	class="dockview-container"
	class:minimized
	style:width={containerWidth}
	style:height={containerHeight}
	style:zoom={workspaceZoom}
></div>
