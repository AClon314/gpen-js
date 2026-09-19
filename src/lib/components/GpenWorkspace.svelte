<script lang="ts">
	import { mount, onDestroy, onMount, unmount, type Component } from 'svelte';
	import 'dockview/dist/styles/dockview.css';
	// 必须在 dockview 自带样式之后引入：本文件把 `--dv-*` 映射到 `--gpen-*`。
	import '#lib/themes/dockview.css';
	// 所有 area 共用的外壳样式（容器盒 / 字体 / 图标尺寸 / 小控件状态）。
	import './areas/panel.css';
	import {
		createDockview,
		type CreateComponentOptions,
		type IContentRenderer,
		type SerializedDockview
	} from 'dockview';
	import { MimeType, type GpenT, type StrokeT } from 'gpen-protocol/flatbuffers';
	import { EraserMode, type BrushSettingsT, type EraserSettingsT, type ToolbarStateT } from 'gpen-protocol/flatbuffers';
	import { createDefaultGpen } from '../protocol/defaults';
	import { encodeGpen } from '../protocol/codec';
	import { createRuntimeUploadDownloadSelector } from '#lib/bindings/upDownloader';
	import {
		loadPreferences,
		preferences as preferencesState,
		resetPreferences,
		updatePreferences
	} from './gpenPreferencesState.svelte';
	import { buildLayerTree } from '../layers/layerAdapter';
	import {
		ensureDrawableActiveLayer,
		moveNodes,
		renameNode,
		setActiveNode,
		type MoveNodeOp
	} from '../layers/layerOps';
	import { appendStroke, createStroke, eraseHard, eraseSoft, eraseStrokes, type StrokePointInput } from '../layers/strokeOps';
	import { createEditHistory, type CommitOptions } from '../history';
	import {
		createGpenBinaryStore,
		createRuntimeStorage,
		type GpenBinaryStore,
		type GpenKvRoot,
		type HookedBlobBackend,
		type Storage
	} from '../bindings/storage/index';
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
		cloneGpenPanelLayout,
		createDefaultGpenWorkspaceState,
		normalizeUiScale,
		UI_SCALE_DEFAULT,
		type GpenPanelLayout,
		type GpenToolId,
		type GpenWorkspaceState
	} from './gpenWorkspaceState';
	import { readGpenViewportZoomFactor } from './gpenViewport';
	import {
		brushRadiusOf,
		defaultToolbarState,
		ensureToolbarState,
		eraserRadiusOf,
		readToolbarState,
		toolIdName,
		writeBrushSettings,
		writeEraserSettings,
		writeToolbarState
	} from './toolbarOps';
	import { observeViewport } from '#lib/visualViewport';
	import {
		menuState,
		open as openMenu,
		registerMenuItems,
		type MenuItem
	} from './contextMenu/contextMenu.svelte';
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

	// oxlint-disable-next-line no-unassigned-vars
	let container: HTMLDivElement;
	let dockview: ReturnType<typeof createDockview> | undefined;
	/// 文档是真相，图层树只是它的派生视图：移动/重命名都只改文档（layerOps），
	/// 再由文档重建树 —— 树里的 `children` 与协议的邻接向量永远不会脱节。
	let gpenDocument = $state.raw<GpenT | undefined>(undefined);
	const layerTree = $derived(gpenDocument ? buildLayerTree(gpenDocument) : undefined);
	/// 图层视图：Web 图层（element）或未来的 gpen 画布（canvas）。
	let layerView = $state<LayerView | undefined>(undefined);
	let infiniteCanvas: InfiniteCanvas | undefined;
	/// 视图旋转（度）。真值以后归图层模型；这里只驱动 DOM 投影。
	const hostViewState = $state({ rotation: 0 });

	// --- 文档写入 / 撤销 / 持久化 ------------------------------------------------
	/**
	 * 撤销预算：条目上限 + 总快照预算。文档快照是不可变引用，所以这里的
	 * 「预算」约束的是同时存活的文档份数（真正的内存压力），而不是数组长度。
	 */
	const UNDO_LIMIT = 50;
	const UNDO_BUDGET = 200;
	const GPEN_DOCUMENT_ID = 'gpen-main';
	const GPEN_SAVE_DEBOUNCE_MS = 250;
	// 工作区偏好与文档各用一份 KV 根：`createRuntimeStorage()` 每次都建一个独立的
	// 内存根，`submit()` 会整根写回同一个 IndexedDB key，共用根会互相覆盖命名空间。
	const GPEN_KV_KEY = 'gpen-root';
	/// 撤销/重做存的是不可变文档引用，所以快照本身不复制数据。环形缓冲 + 预算，
	/// 丢弃最旧历史时只推进 head，不搬数组（见 lib/history.ts）。
	const history = createEditHistory<GpenT>({
		limit: UNDO_LIMIT,
		maxEntries: UNDO_BUDGET
	});
	/// 让状态栏的撤销/重做按钮跟着历史深度变化（history 本身不是响应式的）。
	const historyState = $state({ undoDepth: 0, redoDepth: 0 });
	/// 用户是否动过文档：`load` 返回时据此决定要不要用存档覆盖默认文档。
	let documentEdited = false;
	/// 一次橡皮拖动开始时的文档：连续擦除用 `coalesceWith` 合成一条 undo。
	let eraseGestureStart: GpenT | undefined;
	let runtimeStorage: Storage<GpenKvRoot, HookedBlobBackend> | undefined;
	let gpenStore: GpenBinaryStore | undefined;
	/// load 结束后才允许落盘（否则默认文档会在 load 之前覆盖存储里的那份）。
	let documentReady = $state(false);
	let tabMenuPanelId: string | undefined;
	let disposeTabMenu: (() => void) | undefined;
	/// 命令注册 + 快捷键绑定 + 全局派发器的总 disposer（见 registerCommands）。
	let disposeCommands: (() => void) | undefined;
	let layoutSubscriptions: { dispose(): void }[] = [];
	let viewportResizeObserver: ResizeObserver | undefined;
	let removeViewportListeners: (() => void) | undefined;
	let layoutFrame: number | undefined;
	let applyDefaultSizes = false;
	let pendingRestore = false;
	let layoutDirty = false;
	let mounted = false;

	const STATUS_BAR_PANEL_ID = 'statusbar';
	const PREFERENCES_PANEL_ID = 'preferences';
	const PREFERENCES_WIDTH = 420;
	const PREFERENCES_HEIGHT = 520;
	/** 浮动面板与工作区边缘的最小间距（px）。 */
	const FLOAT_MARGIN = 16;

	/** 当前 `gpenStore` 使用的 debounce（构造参数，改了要重建 store）。 */
	let appliedDebounceMs = GPEN_SAVE_DEBOUNCE_MS;
	/// 落盘状态（设置面板只读诊断）。
	let storageStatus = $state('未保存');
	/// 导出走运行时选择器（monkey 宿主用 `GM_download`，普通网页用原生下载）。
	const upDownloader = createRuntimeUploadDownloadSelector();

	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	let externalZoomFactor = $state(1);
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

	function toggleImmersive() {
		workspaceState.immersive = !workspaceState.immersive;
	}

	function selectTool(tool: GpenToolId) {
		workspaceState.activeTool = tool;
		// 同步一份到协议 `ToolbarState.activeToolId`（handoff §6.1）：UI 真值仍是
		// `workspaceState.activeTool`，文档里只存镜像，不反向覆盖用户的选择。
		const current = gpenDocument;
		if (current) {
			const state = ensureToolbarState(current);
			if (state.activeToolId !== toolIdName(tool)) {
				gpenDocument = writeToolbarState(
					current,
					Object.assign(state, { activeToolId: toolIdName(tool) })
				);
			}
		}
	}

	/**
	 * 画笔 / 橡皮设置写入协议 `ToolbarState`（不可变文档，算一次编辑）。
	 *
	 * ⚠️ **必须丢弃“值没变”的写入**：`InputSlider` 在 `$effect` 里发 `onvalidvalue`，
	 * 而文档一改就重渲滑条、重发同一个值——没有这层守卫就是一个
	 * `effect_update_depth_exceeded` 死循环（实测过），而且每次聚焦滑条都会
	 * 往 undo 里塞一条空记录。
	 */
	function changeBrush(patch: Partial<BrushSettingsT>) {
		const current = gpenDocument;
		if (!current) return;
		// 基线是**生效值**（没有 toolbarState 时就是默认值），不是 undefined：
		// 否则面板一挂载、取色器把默认颜色回发一次，就会把整套默认 toolbarState
		// 写进文档（实测 352 → 720 字节）——打开设置面板不该改文档。
		const brush = ensureToolbarState(current).brush ?? undefined;
		const changed = changedFields(patch, brush);
		if (Object.keys(changed).length === 0) return;
		const next = writeBrushSettings(current, changed);
		pushUndo(current);
		assignDocument(next);
	}

	function changeEraser(patch: Partial<EraserSettingsT>) {
		const current = gpenDocument;
		if (!current) return;
		const eraser = ensureToolbarState(current).eraser ?? undefined;
		const changed = changedFields(patch, eraser);
		if (Object.keys(changed).length === 0) return;
		const next = writeEraserSettings(current, changed);
		pushUndo(current);
		assignDocument(next);
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
		document: GpenT | undefined;
		layerView: LayerView | undefined;
		onStroke: (points: StrokePointInput[]) => void;
		onErase: (point: { x: number; y: number }) => void;
		activeTool: GpenToolId;
		brush: BrushSettingsT | undefined;
		eraser: EraserSettingsT | undefined;
	}>({
		viewState: hostViewState,
		onRotate: rotateHostView,
		document: undefined,
		layerView: undefined,
		onStroke: commitStroke,
		onErase: commitErase,
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
		onChangeBrush: changeBrush,
		onChangeEraser: changeEraser,
		onChangePreferences: updatePreferences,
		onResetPreferences: resetPreferencesAndTool,
		onResetPanelLayout: resetPanelLayout,
		documentId: GPEN_DOCUMENT_ID,
		storageStatus: '未保存',
		onClearDocument: clearDocument
	});

	// 偏好 / 工具 / 布局三层 → 偏好面板 props。
	$effect(() => {
		preferencesProps.preferences = preferencesState();
		preferencesProps.uiScale = workspaceState.uiScale;
		const state = gpenDocument ? readToolbarState(gpenDocument) : undefined;
		preferencesProps.brush = state?.brush ?? undefined;
		preferencesProps.eraser = state?.eraser ?? undefined;
		preferencesProps.storageStatus = storageStatus;
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
		onChangeBrush: changeBrush,
		onChangeEraser: changeEraser
	});

	// 工具 + 协议 `ToolbarState` → 属性面板 props。
	$effect(() => {
		const state = gpenDocument ? readToolbarState(gpenDocument) : undefined;
		propertiesProps.brush = state?.brush ?? undefined;
		propertiesProps.eraser = state?.eraser ?? undefined;
		propertiesProps.activeTool = workspaceState.activeTool;
	});

	/** 当前文档的工具栏状态（没有就 `undefined`）。 */
	function toolbarState(): ToolbarStateT | undefined {
		return gpenDocument ? readToolbarState(gpenDocument) : undefined;
	}

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
		const state = gpenDocument ? readToolbarState(gpenDocument) : undefined;
		viewportProps.activeTool = workspaceState.activeTool;
		viewportProps.brush = state?.brush ?? undefined;
		viewportProps.eraser = state?.eraser ?? undefined;
	});

	// 自动保存间隔是 `createGpenBinaryStore` 的构造参数，改了只能重建 store。
	// 重建前**必须先把旧 store 挂起的写入刷盘**，否则最后一次编辑会丢。
	$effect(() => {
		const next = preferencesState().autoSaveDebounceMs;
		const storage = runtimeStorage;
		if (!documentReady || !storage || next === appliedDebounceMs) return;
		appliedDebounceMs = next;
		const previous = gpenStore;
		gpenStore = createGpenBinaryStore({
			kv: storage.kv,
			blob: storage.blob,
			cache: true,
			debounceMs: next
		});
		if (!previous) return;
		void previous.commit().then(
			() => previous.dispose(),
			(error) => {
				console.debug('[gpen] ignored rejection: GpenWorkspace debounce rebuild', error);
				previous.dispose();
			}
		);
	});

	// 文档变化 → debounce 落盘。`documentReady` 之前不写：load 是异步的，
	// 不然默认文档会在 load 读到存档之前把它覆盖掉。
	$effect(() => {
		const document = gpenDocument;
		if (!documentReady || !document || !gpenStore) return;
		void gpenStore.save(GPEN_DOCUMENT_ID, document).catch((error) => {
			console.debug('[gpen] ignored rejection: GpenWorkspace gpenBinary save', error);
			return;
		});
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
		assignDocument(setActiveNode(gpenDocument, key));
	}

	function renameLayerNode(key: TreeKey, name: string) {
		if (!gpenDocument) return;
		const current = gpenDocument;
		try {
			const next = renameNode(current, key, name);
			pushUndo(current);
			assignDocument(next);
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
			pushUndo(current);
			assignDocument(next);
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace moveNodes', error);
			return;
		}
	}

	// --- 写入 / 撤销 --------------------------------------------------------------

	/**
	 * 用户改动文档的统一入口：标记 `documentEdited` 并赋值。`gpenDocument` 是
	 * `$state.raw`，所以每次都是一次整体替换（不可变文档，见 layerOps / strokeOps）。
	 */
	function assignDocument(next: GpenT) {
		documentEdited = true;
		gpenDocument = next;
	}

	/** 提交前把当前文档推进历史（环形缓冲 + 预算），并清空重做栈。 */
	function pushUndo(previous: GpenT | undefined, options?: CommitOptions<GpenT>) {
		if (!previous) return;
		history.commit(previous, options);
		syncHistoryState();
	}

	function syncHistoryState() {
		historyState.undoDepth = history.undoDepth();
		historyState.redoDepth = history.redoDepth();
	}

	function undoDocument() {
		const current = gpenDocument;
		if (!current) return;
		const previous = history.undo(current);
		if (!previous) return;
		assignDocument(previous);
		syncHistoryState();
	}

	function redoDocument() {
		const current = gpenDocument;
		if (!current) return;
		const next = history.redo(current);
		if (!next) return;
		assignDocument(next);
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
	function commitStroke(points: StrokePointInput[]) {
		const current = gpenDocument;
		if (!current || points.length === 0) return;
		try {
			const state = ensureToolbarState(current);
			const brush = state.brush ?? undefined;
			const stroke = createStroke(points, {
				radius: brushRadiusOf(brush),
				opacity: brush?.drawStrength ?? undefined
			});
			const next = appendStroke(ensureDrawableActiveLayer(current), stroke);
			pushUndo(current);
			assignDocument(next);
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace commitStroke', error);
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
	function commitErase(point: { x: number; y: number }) {
		const current = gpenDocument;
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
		// 拖动中的连续擦除合成一条 undo：`coalesceWith` 用「本次拖动开始时的文档」
		// 替换刚推入的那条，所以 Ctrl+Z 一次退回拖动之前。
		const gestureStart = eraseGestureStart ?? current;
		eraseGestureStart = gestureStart;
		pushUndo(current, { coalesceWith: () => gestureStart });
		assignDocument(next);
	}

	/**
	 * 撤销 / 重做 / 重命名 / 保存都走命令注册表（`gpen.undo` …）：菜单栏显示
	 * 的快捷键就是这里绑定的同一串，不存在“菜单写了 Ctrl+S 但按了没反应”。
	 * 派发器只有一个（`installKeymapDispatcher`），并且会跳过文本框 / CodeMirror。
	 */
	function registerCommands() {
		const disposeCommands = registerWorkspaceCommands({
			undo: undoDocument,
			redo: redoDocument,
			canUndo: () => history.canUndo(),
			canRedo: () => history.canRedo(),
			renameActive: requestRenameActive,
			resetPanelLayout,
			toggleImmersive,
			immersive: () => workspaceState.immersive,
			toggleStatusBar,
			statusBarVisible: () => dockview?.getPanel(STATUS_BAR_PANEL_ID) !== undefined,
			save: () => void commitDocumentNow(),
			toggleFullscreen: () => void toggleFullscreen(),
			fullscreen: () => typeof document !== 'undefined' && document.fullscreenElement !== null,
			openPreferences,
			openAbout,
			newDocument,
			openDocument: () => void openStoredDocument(),
			openRecent: () => void openStoredDocument(),
			saveCopy: () => void saveCopy(),
			exportJson,
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

	/** 保存 = 立即刷盘（不等 debounce），失败只记日志。 */
	async function commitDocumentNow(): Promise<void> {
		const store = gpenStore;
		if (!store) return;
		try {
			await store.commit();
			storageStatus = '已保存';
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace explicit save', error);
			storageStatus = '保存失败';
			return;
		}
	}

	/**
	 * 清空当前文档（设置面板的「清空」）：回到默认文档，可 Ctrl+Z 退回。
	 * 不删存储里的 blob——下一次 debounce 落盘会把它覆盖成默认文档，语义更接近
	 * Blender 的「恢复默认」而不是「删除文件」。
	 */
	function clearDocument(): void {
		const current = gpenDocument;
		if (!current) return;
		pushUndo(current);
		assignDocument(createDefaultGpen(window.location.href));
	}

	/** 「新建」：新文档（可 Ctrl+Z 退回），并把工具栏设置带回默认值。 */
	function newDocument(): void {
		const current = gpenDocument;
		const fresh = createDefaultGpen(window.location.href);
		// `pushUndo` 而不是 `history.clear()`：新建是**用户操作**，Ctrl+Z 应该能退回
		// （只有 mount 时读到存档才清历史，那次不是用户操作）。
		if (current) pushUndo(current);
		assignDocument(writeToolbarState(fresh, defaultToolbarState()));
		documentEdited = true;
		storageStatus = '新建文档（未保存）';
	}

	/**
	 * 「打开」/「打开最近文件」：从 gpenBinary 重新读 `gpen-main`。
	 * 两个菜单项指向同一件事：本轮只存一份文档（多文档要协议级的文档目录），
	 * 所以不做“文件选择器”这种假 UI。
	 */
	async function openStoredDocument(): Promise<void> {
		const store = gpenStore;
		if (!store) return;
		try {
			const loaded = await store.load(GPEN_DOCUMENT_ID);
			const current = gpenDocument;
			if (current) pushUndo(current);
			assignDocument(loaded);
			documentEdited = true;
			storageStatus = '已从存储载入';
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace openStoredDocument', error);
			storageStatus = '没有可打开的存档';
			return;
		}
	}

	/** 「保存副本」：把当前文档写到 `gpen-<时间戳>` 下，并切过去。 */
	async function saveCopy(): Promise<void> {
		const store = gpenStore;
		const current = gpenDocument;
		if (!store || !current) return;
		const id = `gpen-${new Date().toISOString().replace(/[:.]/g, '-')}`;
		try {
			await store.save(id, current);
			await store.commit();
			storageStatus = `副本已保存：${id}`;
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace saveCopy', error);
			storageStatus = '保存副本失败';
			return;
		}
	}

	/** 「导出 JSON」：把文档编码成 FlatBuffer 后下载。 */
	function exportJson(): void {
		const current = gpenDocument;
		if (!current) return;
		try {
			const bytes = encodeGpen(current);
			const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
			void upDownloader.download(blob, `${GPEN_DOCUMENT_ID}.gpen.json`).catch((error: unknown) => {
				console.debug('[gpen] ignored rejection: GpenWorkspace exportJson', error);
				return;
			});
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace exportJson encode', error);
			return;
		}
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
		const reset = resetPreferences();
		const current = gpenDocument;
		if (!current) return;
		const defaults = defaultToolbarState();
		const state = ensureToolbarState(current);
		pushUndo(current);
		assignDocument(
			writeToolbarState(
				current,
				Object.assign(state, { brush: defaults.brush, eraser: defaults.eraser })
			)
		);
		// 主题 / 语言的重置由 `$effect` 同步到 DOM。
		void reset;
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
	 * 已存在就 `setActive()`（不开第二个）；不存在才 `addPanel` + `addFloatingGroup`
	 * （dockview 8.2 的 `addFloatingGroup(item, { position, width, height, dragHandle })`）。
	 * `dragHandle: 'titlebar'` 保留面板标题栏作为拖动手柄，所以它不进
	 * `:has(.blender-panel-...) { display: none }` 那组。
	 */
	function openPreferences(): void {
		const instance = dockview;
		if (!instance) return;
		const existing = instance.getPanel(PREFERENCES_PANEL_ID);
		if (existing) {
			existing.api.setActive();
			return;
		}
		const panel = instance.addPanel({
			id: PREFERENCES_PANEL_ID,
			component: PREFERENCES_PANEL_ID,
			title: '偏好设置',
			initialWidth: PREFERENCES_WIDTH,
			initialHeight: PREFERENCES_HEIGHT
		});
		if (!panel) return;
		// `position` 的类型是 `AnchorPosition`（四个角），**没有** `'center'`：
		// 传 `'center'` 会编译报错，运行时也会落回默认左上角。所以按容器尺寸自己算居中
		// 坐标（dockview 的 `floatingGroupBounds: 'boundedWithinViewport'` 会再夹一次）。
		const width = Math.min(PREFERENCES_WIDTH, Math.max(240, instance.width - 2 * FLOAT_MARGIN));
		const height = Math.min(PREFERENCES_HEIGHT, Math.max(200, instance.height - 2 * FLOAT_MARGIN));
		instance.addFloatingGroup(panel, {
			x: Math.max(FLOAT_MARGIN, Math.round((instance.width - width) / 2)),
			y: Math.max(FLOAT_MARGIN, Math.round((instance.height - height) / 2)),
			width,
			height,
			dragHandle: 'titlebar'
		});
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
		applyDefaultSizes = true;
		scheduleLayout();
	}

	/** 挂载时读存档；没有 / 坏了都退回已经设好的默认文档。 */
	async function loadStoredDocument() {
		const store = gpenStore;
		if (!store) return;
		try {
			const loaded = await store.load(GPEN_DOCUMENT_ID);
			// 用户在 load 期间已经画过：不覆盖他的工作。
			if (!documentEdited) {
				gpenDocument = loaded;
				// 历史里的是「默认文档 → ...」，不是用户的操作：清掉，undo 不该退回默认文档。
				history.clear();
				syncHistoryState();
			}
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace gpenBinary load', error);
			// 失败只是没有存档可读，退回默认文档即可，无需向上传播。
			return;
		} finally {
			documentReady = true;
		}
	}

	// 工作区铺满 overlay：可用尺寸就是父层的 padding box，所以 clientWidth /
	// clientHeight 可以直接用（overlay 不设内边距）。
	function measureViewport() {
		const parent = container.parentElement;
		viewportWidth = Math.max(0, parent?.clientWidth ?? window.innerWidth);
		viewportHeight = Math.max(0, parent?.clientHeight ?? window.innerHeight);
	}

	function layoutDockview() {
		if (!dockview) return;
		const width = layoutWidth ?? container.clientWidth;
		const height = layoutHeight ?? container.clientHeight;
		if (width <= 0 || height <= 0) return;
		dockview.layout(width, height);
	}

	function scheduleLayout() {
		if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
		layoutFrame = requestAnimationFrame(() => {
			layoutFrame = undefined;
			measureViewport();
			layoutDockview();
			// Both of these need a laid-out grid: dockview ignores size requests
			// made before the first layout pass (the grid falls back to each
			// group's minimum), and a restored layout applied before the container
			// has its real size gets its panel sizes redistributed — which is how
			// a stored layout ends up "growing" panels.
			if (pendingRestore) {
				pendingRestore = false;
				if (!restoreDockviewLayout()) {
					buildDefaultLayout();
					applyDefaultSizes = true;
					scheduleLayout();
					return;
				}
			}
			if (applyDefaultSizes) {
				applyDefaultSizes = false;
				resizeDefaultPanels();
			}
			// 尺寸落定后再落一次布局：`setSize` 之后的变更事件是在 dockview 还在
			// 100×100 时发出的，那一次会被 capture 的尺寸守卫挡掉。
			if (layoutDirty) captureDockviewLayout();
		});
	}

	/**
	 * `initialWidth` / `initialHeight` on addPanel only apply when the panel
	 * creates its group; panels that split an existing group keep the group
	 * minimum instead. Set every default size explicitly, once the grid exists.
	 */
	function resizeDefaultPanels() {
		dockview?.getPanel('menu')?.group.api.setSize({ height: 66 });
		dockview?.getPanel('tools')?.group.api.setSize({ width: 62 });
		dockview?.getPanel('outliner')?.group.api.setSize({ width: 300 });
		dockview?.getPanel('timeline')?.group.api.setSize({ height: 190 });
		dockview?.getPanel(STATUS_BAR_PANEL_ID)?.group.api.setSize({ height: 24 });
	}

	/** 低于这个尺寸的布局不是“用户的布局”，见 `captureDockviewLayout`。 */
	const MIN_LAYOUT_DIMENSION = 120;

	function captureDockviewLayout() {
		const instance = dockview;
		// 一个没有任何面板的布局不是“用户的布局”：它只会在重建的中途或渲染异常时
		// 出现，存下去就等于把工作区锁死成空白。
		if (!instance || instance.panels.length === 0) return;
		// 只有“按真实容器尺寸排过的布局”才值得存。刚挂载时 dockview 还停在它自己的
		// 默认尺寸（100×100），那时每个面板都卡在最小值；把这时的 toJSON() 存下来，
		// 下次还原就会被摊回真实尺寸 —— 面板越开越大就是这么来的。
		const width = layoutWidth;
		const height = layoutHeight;
		if (width === undefined || height === undefined) return;
		if (Math.abs(instance.width - width) > 1 || Math.abs(instance.height - height) > 1) return;
		const layout = cloneGpenPanelLayout(instance.toJSON());
		if (!layout) return;
		workspaceState.panelLayout = layout;
		layoutDirty = false;
	}

	/**
	 * 视口那一组是 overlay 上真正的“洞”：整组透明、且不接指针（见 themes/dockview.css
	 * 的 `.gpen-hole`）。以前只靠 `:has(.blender-panel-viewport)` 判断，面板内容一旦缺失
	 * （组件抛错、还没挂载），洞就会退回不透明的 chrome 底色——所以这里按面板 id 打标记。
	 * 面板的增删、激活、尺寸变化都会触发 dockview 的布局事件，所以这一处调用就够了
	 * （在 rAF 里再来一次是消融实验证伪掉的冗余：去掉后洞依然是透明的）。
	 */
	function markHoleGroup() {
		const instance = dockview;
		if (!instance) return;
		for (const group of instance.groups) {
			group.element.classList.toggle('gpen-hole', group.activePanel?.id === 'viewport');
		}
	}

	/** 存储里的布局是否是“按真实尺寸排过”的那份（老版本可能存过 100×100 的）。 */
	function isUsablePanelLayout(layout: GpenPanelLayout): boolean {
		const grid = (layout as { grid?: { width?: unknown; height?: unknown } }).grid;
		if (typeof grid !== 'object' || grid === null) return false;
		const { width, height } = grid;
		return (
			typeof width === 'number' &&
			typeof height === 'number' &&
			width >= MIN_LAYOUT_DIMENSION &&
			height >= MIN_LAYOUT_DIMENSION
		);
	}

	function restoreDockviewLayout(): boolean {
		const instance = dockview;
		const stored = workspaceState.panelLayout;
		if (!instance || !stored) return false;
		if (!isUsablePanelLayout(stored)) {
			// 坏布局直接丢掉，让调用方重建默认布局。
			workspaceState.panelLayout = null;
			return false;
		}
		try {
			instance.fromJSON(stored as unknown as SerializedDockview);
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace layout restore', error);
			workspaceState.panelLayout = null;
			return false;
		}
		// 存储里的布局可能是空的（见 captureDockviewLayout）：`fromJSON` 不会抛，
		// 但结果是一个没有面板的 workspace，所以这里当成恢复失败处理。
		if (instance.panels.length === 0) {
			instance.clear();
			workspaceState.panelLayout = null;
			return false;
		}
		return true;
	}

	/**
	 * Build outward from the viewport so every surrounding panel occupies its own
	 * dockview group and stays resizable. Sizes are CSS px at the workspace's own
	 * (unzoomed) scale: the tool strip is a rail, the right column is the
	 * layer/property work area, and the top / bottom strips are chrome whose
	 * height follows their content.
	 */
	function buildDefaultLayout() {
		if (!dockview) return;
		dockview.addPanel({
			id: 'viewport',
			component: 'viewport',
			title: '视口',
			minimumWidth: 240,
			minimumHeight: 160
		});
		dockview.addPanel({
			id: 'menu',
			component: 'menu',
			title: '菜单',
			position: { referencePanel: 'viewport', direction: 'above' },
			initialHeight: 66,
			minimumHeight: 28
		});
		dockview.addPanel({
			id: 'tools',
			component: 'tools',
			title: '工具',
			position: { referencePanel: 'viewport', direction: 'left' },
			initialWidth: 62,
			minimumWidth: 52
		});
		dockview.addPanel({
			id: 'timeline',
			component: 'timeline',
			title: '时间轴',
			position: { referencePanel: 'viewport', direction: 'below' },
			initialHeight: 190,
			minimumHeight: 48
		});
		dockview.addPanel({
			id: 'outliner',
			component: 'outliner',
			title: '场景集合',
			position: { referencePanel: 'viewport', direction: 'right' },
			initialWidth: 300,
			minimumWidth: 160
		});
		dockview.addPanel({
			id: 'properties',
			component: 'properties',
			title: '属性',
			position: { referencePanel: 'outliner', direction: 'below' },
			initialHeight: 320
		});
		dockview.addPanel({
			id: 'statusbar',
			component: 'statusbar',
			title: '状态栏',
			position: { referencePanel: 'timeline', direction: 'below' },
			initialHeight: 24,
			minimumHeight: 22
		});

		// Dockview groups have a 100px default minimum of their own. Relax the
		// chrome / rail groups so the requested initial sizes can take effect.
		dockview.getPanel('menu')?.group.api.setConstraints({ minimumHeight: 28 });
		dockview.getPanel('timeline')?.group.api.setConstraints({ minimumHeight: 48 });
		dockview.getPanel('statusbar')?.group.api.setConstraints({ minimumHeight: 22 });
		dockview.getPanel('tools')?.group.api.setConstraints({ minimumWidth: 52 });
	}

	/**
	 * Drop the persisted layout and rebuild the default one — the escape hatch
	 * for a workspace whose saved layout no longer matches the current panels.
	 */
	function resetPanelLayout() {
		const instance = dockview;
		if (!instance) return;
		workspaceState.panelLayout = null;
		instance.clear();
		buildDefaultLayout();
		// `clear()` + re-add happens before the next layout pass, so the explicit
		// sizes have to run on that pass (same as the first mount).
		applyDefaultSizes = true;
		scheduleLayout();
	}

	// CSS `zoom` has to counteract the external browser/pinch factor before the
	// user's uiScale is applied. The resulting formula is:
	//   effective workspace zoom = uiScale / (browser zoom × pinch zoom)
	// The container's unzoomed px box is enlarged by 1/effectiveZoom so its
	// visual box still exactly fills the absolute visual-viewport overlay.
	$effect(() => {
		const _zoom = workspaceZoom;
		if (!mounted) return;
		measureViewport();
		scheduleLayout();
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
		preferences: BlenderPreferences
	};

	// Open the owning panel in a separate browser window (like an OAuth popup).
	// dockview needs a popoutUrl so the new window can boot the same app; a
	// fragment marks which panel is being popped out.
	function popoutPanel(id: string) {
		const panel = dockview?.getPanel(id);
		if (!panel) return;
		const url = `${window.location.origin}${window.location.pathname}#popout-${id}`;
		try {
			void dockview?.addPopoutGroup(panel, { popoutUrl: url });
		} catch (e) {
			// Popout may be blocked (no window.open permission); ignore.
			console.debug("[gpen] ignored rejection: GpenWorkspace popoutPanel", e);
			return;
		}
	}


	const WORKSPACE_TAB_MENU_ID = 'gpen-workspace-tab';

	/**
	 * The tab DOM belongs to dockview, so it cannot use the Svelte action. The
	 * delegated `contextmenu` listener resolves the tab's panel id and opens this
	 * named registry entry programmatically instead.
	 */
	function tabMenuItems(): MenuItem[] {
		const panelId = tabMenuPanelId;
		if (panelId === undefined) return [];
		return [
			{ label: '在新窗口打开', order: 10, action: () => popoutPanel(panelId) },
			{
				label: '关闭',
				order: 20,
				action: () => {
					const panel = dockview?.getPanel(panelId);
					if (panel) dockview?.removePanel(panel);
				}
			},
			{ separator: true, order: 30 },
			{
				label: '浮动',
				order: 40,
				action: () => {
					const panel = dockview?.getPanel(panelId);
					if (panel) dockview?.addFloatingGroup(panel);
				}
			}
		];
	}

	function handleTabContextMenu(event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const tab = target.closest<HTMLElement>('.dv-tab');
		if (!tab || !container.contains(tab)) return;

		const panelId = tab.dataset.tabPanelId;
		if (!panelId) return;
		event.preventDefault();
		event.stopPropagation();
		tabMenuPanelId = panelId;
		openMenu(WORKSPACE_TAB_MENU_ID, event.clientX, event.clientY);
	}

	function createLayerList(): HTMLUListElement {
		const list = document.createElement('ul');
		list.className = 'gpen-layer-list';
		const layers = layerTree?.flattenedDrawOrder() ?? [];
		if (layers.length === 0) {
			const empty = document.createElement('li');
			empty.className = 'gpen-layer-empty';
			empty.textContent = '暂无图层';
			list.appendChild(empty);
			return list;
		}
		for (const layer of layers) {
			const li = document.createElement('li');
			li.className = `gpen-layer-row${layer.active ? ' gpen-layer-row-active' : ''}`;

			const label = document.createElement('span');
			label.className = 'gpen-layer-name';
			label.textContent = layer.name;
			li.appendChild(label);

			const isGpen = layer.layer?.mimeType === MimeType.MIME_TYPE_APPLICATION_GPEN;
			const badge = document.createElement('span');
			badge.className = `gpen-layer-kind gpen-layer-kind-${isGpen ? 'gpen' : 'html'}`;
			badge.textContent = isGpen ? 'gpen' : 'html';
			li.appendChild(badge);

			if (layer.active) {
				const active = document.createElement('span');
				active.className = 'gpen-layer-active';
				active.setAttribute('aria-hidden', 'true');
				active.textContent = '●';
				li.appendChild(active);
			}

			list.appendChild(li);
		}
		return list;
	}

	/**
	 * The menu panel hosts the whole title bar (menus, ui scale, close), and the
	 * tool strip owns the active tool, so both need callbacks. The other panels
	 * keep their own local state and are mounted without props.
	 */
	function componentProps(name: string): Record<string, unknown> | undefined {
		if (name === 'tools') return { state: workspaceState, onSelectTool: selectTool };
		if (name === 'viewport') return viewportProps;
		if (name === 'outliner') return outlinerProps;
		if (name === 'preferences') return preferencesProps;
		// 属性面板与设置面板共用同一套画笔 / 橡皮参数（真值在协议 `ToolbarState`），
		// 只是属性面板跟随当前工具、设置面板两套都显示。
		if (name === 'properties') return propertiesProps;
		if (name === 'statusbar') {
			return {
				state: historyState,
				onUndo: undoDocument,
				onRedo: redoDocument
			};
		}
		if (name === 'menu') {
			return {
				state: workspaceState,
				onChangeUiScale: changeUiScale,
				onResetUiScale: resetUiScale,
				onToggleImmersive: toggleImmersive,
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
							props: componentProps(name)
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
			element.appendChild(createLayerList());
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

		// Build a default document (webpage layer selected, tool/session + workspace
		// context) so the timeline/layer views have real data to render. Later the
		// document is wired to gpenBinary save/load; here it seeds the shell UI.
		gpenDocument = createDefaultGpen(window.location.href);

		// gpenBinary：文档落盘。load 异步，先用默认文档把 UI 立起来，读到存档再替换
		//（用户在 load 期间画过就不覆盖，见 loadStoredDocument）。
		runtimeStorage = createRuntimeStorage<GpenKvRoot>({
			kvKey: GPEN_KV_KEY,
			storageKey: GPEN_KV_KEY
		});
		gpenStore = createGpenBinaryStore({
			kv: runtimeStorage.kv,
			blob: runtimeStorage.blob,
			cache: true,
			// 自动保存间隔来自用户偏好（设置面板可改）。偏好是异步读的，所以这里先取
			// 当前值（默认 250ms），读盘落定后由下面的 `$effect` 重建 store 接管。
			debounceMs: preferencesState().autoSaveDebounceMs
		});
		appliedDebounceMs = preferencesState().autoSaveDebounceMs;
		void loadStoredDocument();

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
		const onLayoutEvent = () => {
			layoutDirty = true;
			markHoleGroup();
			captureDockviewLayout();
		};
		layoutSubscriptions = [
			dockview.onDidMutateLayout(onLayoutEvent),
			dockview.onDidLayoutChange(onLayoutEvent)
		];
		measureViewport();
		layoutDockview();

		// The stored layout is applied in the first animation-frame pass instead of
		// here: at this point the container has not been sized yet (the overlay is
		// positioned from `visualViewport` in an effect that has not run), so
		// dockview would fit the restored tree into a wrong dimension.
		pendingRestore = workspaceState.panelLayout !== null;
		if (!pendingRestore) {
			buildDefaultLayout();
			applyDefaultSizes = true;
		}
		captureDockviewLayout();

		disposeTabMenu = registerMenuItems(WORKSPACE_TAB_MENU_ID, tabMenuItems);
		container.addEventListener('contextmenu', handleTabContextMenu);
		// 捕获阶段：Esc 先收浮动面板，别让它直接关掉整个工作区。
		window.addEventListener('keydown', handleEscapePriority, { capture: true });
		disposeCommands = registerCommands();

		const onViewportChange = () => {
			updateExternalZoom();
			measureViewport();
			scheduleLayout();
		};
		removeViewportListeners = observeViewport(onViewportChange);

		const parent = container.parentElement;
		if (typeof ResizeObserver !== 'undefined' && parent) {
			viewportResizeObserver = new ResizeObserver(() => onViewportChange());
			viewportResizeObserver.observe(parent);
		}
		scheduleLayout();
	});

	onDestroy(() => {
		mounted = false;
		// 先恢复页面（旋转是 DOM 投影）再收相机 spacer。
		layerView?.restore();
		layerView = undefined;
		infiniteCanvas?.destroy();
		infiniteCanvas = undefined;
		if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
		removeViewportListeners?.();
		removeViewportListeners = undefined;
		viewportResizeObserver?.disconnect();
		viewportResizeObserver = undefined;
		for (const subscription of layoutSubscriptions) subscription.dispose();
		layoutSubscriptions = [];
		container.removeEventListener('contextmenu', handleTabContextMenu);
		window.removeEventListener('keydown', handleEscapePriority, { capture: true });
		disposeCommands?.();
		disposeCommands = undefined;
		disposeTabMenu?.();
		disposeTabMenu = undefined;
		dockview?.dispose();
		dockview = undefined;

		// 先把挂起的写入刷盘，再停掉 store 与 storage。
		const store = gpenStore;
		gpenStore = undefined;
		if (store) {
			void store.commit().then(
				() => store.dispose(),
				(error) => {
					console.debug('[gpen] ignored rejection: GpenWorkspace gpenBinary commit', error);
					store.dispose();
				}
			);
		}
		const storage = runtimeStorage;
		runtimeStorage = undefined;
		if (storage?.close) {
			void Promise.resolve(storage.close()).catch((error) => {
				console.debug('[gpen] ignored rejection: GpenWorkspace storage close', error);
				return;
			});
		}
	});
</script>

<div
	bind:this={container}
	class="dockview-container"
	class:minimized
	class:immersive={workspaceState.immersive}
	style:width={containerWidth}
	style:height={containerHeight}
	style:zoom={workspaceZoom}
></div>

<style>
	:global(html),
	:global(body) {
		margin: 0;
		min-width: 0;
		min-height: 0;
	}

	.dockview-container {
		/* The parent overlay is an unzoomed visual-viewport box. This child is
		 * absolute instead of fixed so its size remains tied to that box. */
		position: absolute;
		top: 0;
		left: 0;
		box-sizing: border-box;
		z-index: 0;
		overflow: hidden;
		/* 工作区铺满整个 overlay（没有外边距 / 圆角），面板一直贴到视口边缘。
		 * 容器本身不能有底色——视口那一格是真正的洞（宿主网页从那里透出来），
		 * 底色只能由各个面板自己画：`--dv-group-view-background-color` 指回 chrome
		 * 底色，只有视口那一组把它改回 transparent。 */
		background: var(--gpen-workspace-background);
		color: var(--gpen-panel-foreground);
		font-family: var(--gpen-font-sans);
		font-size: var(--gpen-font-size);
		line-height: var(--gpen-line-height);
		/* Leave the transparent viewport as a hit-test hole. Individual dockview
		 * chrome groups opt back in below, as do sashes and our scale controls. */
		pointer-events: none;
	}

	/* 最小化只是隐藏，不卸载：dockview 的实例、面板尺寸和浮动组都原样留着，
	 * 还原时不需要从存储里重建布局（那正是尺寸失真的来源）。
	 *
	 * 隐藏必须显式写到整棵子树：dockview 会给 `.dv-view` 挂一个 `visible` class，
	 * 而 Tailwind 的 `.visible` 工具类正好也是 `visibility: visible`，于是它把继承下来
	 * 的 hidden 顶掉了。组件样式不在 `@layer utilities` 里，所以这里能压过它。 */
	.dockview-container.minimized,
	.dockview-container.minimized :global(*) {
		visibility: hidden;
	}

	/* 沉浸模式：隐藏四周面板，视口洞 = 整个可视区。与 minimized 一样必须写到整棵子树
	 * （dockview 的 `.visible` 会顶掉继承的 hidden）。区别是语义与入口：沉浸模式保留
	 * 绘制面（T4 起由画布接管），只由 GpenOverlay 的退出按钮 / Esc 退出。 */
	.dockview-container.immersive,
	.dockview-container.immersive :global(*) {
		visibility: hidden;
	}

	/* 沉浸模式保留视口那一组（含画布）：chrome 全隐，但绘制面不能跟着消失。
	 * 注意洞仍只占它原来的 dockview 格位，不会铺满整个可视区（网格没变，
	 * 见 docs/stroke.md 的已知缺口）。 */
	.dockview-container.immersive :global(.dv-groupview.gpen-hole),
	.dockview-container.immersive :global(.dv-groupview.gpen-hole *) {
		visibility: visible;
	}

	/* dockview 的 shell 和 content 层不上色，由面板组件自己画表面。
	 * group 层保留 `--dv-group-view-background-color`（= chrome 底色）。 */
	:global(.dockview-container .dv-dockview),
	:global(.dockview-container .dv-content-container) {
		background-color: transparent;
	}

	/* T3: the overlay and workspace shell opt out of hit testing. Non-viewport
	 * groups, tabs, sashes, and controls opt back in, leaving the transparent
	 * viewport content available to the webpage for click/wheel/touch events.
	 * A child such as the viewport minimap may opt in without making the whole
	 * hole opaque. */
	:global(.dockview-container .dv-groupview) {
		pointer-events: auto;
	}

	/* 视口那一组的“洞”样式（`.gpen-hole`）在 themes/dockview.css 里，由
	 * markHoleGroup() 按面板 id 打标记——不依赖面板内容是否挂载成功。 */
	:global(.dockview-container .dv-sash),
	:global(.dockview-container .dv-resize-handle),
	:global(.dockview-container .dv-drop-target-container) {
		pointer-events: auto;
	}

	/* Chrome panels are not dockable work areas: their title bar would only
	 * repeat what the panel already shows, and the tool rail is too narrow for a
	 * title. Removing the strip keeps their full height for content; the tab
	 * context menu (float / popout / close) stays available on the other panels. */
	:global(.dockview-container .dv-groupview:has(.blender-panel-menu) > .dv-tabs-and-actions-container),
	:global(.dockview-container .dv-groupview:has(.blender-panel-statusbar) > .dv-tabs-and-actions-container),
	:global(.dockview-container .dv-groupview:has(.blender-panel-tools) > .dv-tabs-and-actions-container) {
		display: none;
	}

	:global(.gpen-workspace-content) {
		display: block;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	/* --- panel content --- */
	/* These classes are applied to elements created imperatively by dockview's
	 * createComponent (not Svelte-managed DOM), so they must be :global to
	 * match and to avoid false "unused selector" warnings. */
	:global(.gpen-workspace-placeholder) {
		position: relative;
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-height: 1.75lh;
		padding: 0.5lh 2ch 0.75lh;
		color: var(--gpen-panel-muted);
		background: var(--gpen-panel-background);
		overflow: auto;
	}

	:global(.gpen-placeholder-label) {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--gpen-panel-muted);
	}


	:global(.gpen-timeline-header) {
		margin-bottom: 0.5lh;
		font-weight: 600;
		color: var(--gpen-panel-foreground);
	}

	:global(.gpen-layer-list) {
		display: flex;
		flex-direction: column;
		gap: 0.15lh;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	:global(.gpen-layer-row) {
		display: flex;
		align-items: center;
		gap: 1ch;
		padding: 0.2lh 1ch;
		border: 1px solid transparent;
		border-radius: var(--gpen-radius);
		color: var(--gpen-panel-foreground);
	}

	:global(.gpen-layer-row-active) {
		border-color: var(--gpen-panel-border);
		background: var(--gpen-panel-selection);
	}

	:global(.gpen-layer-kind) {
		margin-left: auto;
		padding: 0 0.5ch;
		border-radius: var(--gpen-radius);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--gpen-panel-background);
	}

	:global(.gpen-layer-kind-gpen) {
		background: var(--gpen-panel-accent);
	}

	:global(.gpen-layer-kind-html) {
		background: var(--gpen-panel-muted);
	}

	:global(.gpen-layer-active) {
		font-size: 0.6rem;
		color: var(--gpen-panel-accent);
	}

	:global(.gpen-layer-empty) {
		color: var(--gpen-panel-muted);
	}

	/* dockview's own stylesheet (dockview/dist/styles/dockview.css) styles the
	 * core DOM (tabs, sashes, dock/drop overlays, groups). Only gpen-specific
	 * classes below need local rules. */
</style>
