<script lang="ts">
	import { mount, onDestroy, onMount, unmount, type Component } from 'svelte';
	import 'dockview/dist/styles/dockview.css';
	// 必须在 dockview 自带样式之后引入：本文件把 `--dv-*` 映射到 `--gpen-*`。
	import '#lib/themes/dockview.css';
	// 所有 area 共用的外壳样式（容器盒 / 字体 / 图标尺寸 / 小控件状态）。
	import '../areas/panel.css';
	// 工作区外壳的全局样式（容器盒 / 洞 / 面板底 / 占位面板）。
	import './workspace.css';
	import {
		createDockview,
		type CreateComponentOptions,
		type IContentRenderer
	} from 'dockview';
	import {
		preferences as preferencesState,
		resetPreferences
	} from '../gpenPreferencesState.svelte';
	import { buildLayerTree } from '../../layers/layerAdapter';
	import { moveNodes, renameNode, setActiveNode, type MoveNodeOp } from '../../layers/layerOps';
	import {
		createGpenDocumentSession,
		GPEN_DOCUMENT_ID,
		type GpenDocumentSession
	} from '../gpenDocumentSession.svelte';
	import type { TreeKey, TreeOp } from '../../layers/tree/index.js';
	import { applyInfiniteCanvas, type InfiniteCanvas } from '../../scenel/index';
	import { guessWebLayer } from '../../layers/web';
	import { createLayerView, type LayerView } from '../../layers/layerView';
	import { installKeymapDispatcher } from '#lib/commands/keymap';
	import {
		registerWorkspaceCommands,
		registerWorkspaceKeyBindings
	} from '../workspaceCommands';
	import {
		createDefaultGpenWorkspaceState,
		normalizeUiScale,
		UI_SCALE_DEFAULT,
		type GpenToolId,
		type GpenWorkspaceState
	} from '../gpenWorkspaceState';
	import { readGpenViewportZoomFactor } from '../gpenViewport';
	import { setWorkspaceZoomVariable } from '../workspaceZoom';
	import { centeredFloatingBounds } from './workspaceLayout.js';
	import {
		createPanelLayoutController,
		STATUS_BAR_PANEL_ID
	} from './workspacePanelLayout.js';
	import { registerCodeAreaSource } from '../codeArea/source';
	import { createWorkspaceTabMenu } from './workspaceTabMenu.js';
	import { openCodeAreaPanel } from '../codeArea/panels';
	import { INTERNAL_STATE_SOURCE_ID } from '../codeArea/internalState';
	import { menuState } from '../contextMenu/contextMenu.svelte';
	import { createWorkspaceProps, CODE_AREA_COMPONENT } from './workspaceProps.svelte';
	import { createWorkspaceDebugSource } from './workspaceDebug';
	import { createWorkspaceEffects, type WorkspaceEffects } from './workspaceEffects';
	import BlenderCodeArea from '../areas/CodeArea.svelte';
	import BlenderOutliner from '../areas/Outliner.svelte';
	import BlenderPreferences from '../areas/Preferences.svelte';
	import BlenderProperties from '../areas/Properties.svelte';
	import BlenderStatusBar from '../areas/StatusBar.svelte';
	import BlenderTimeline from '../areas/Timeline.svelte';
	import BlenderToolStrip from '../areas/ToolStrip.svelte';
	import BlenderTopBar from '../areas/TopBar.svelte';
	import BlenderViewport from '../areas/Viewport.svelte';

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

	/// 内置 CodeArea 调试源的注销函数（见 registerInternalStateSource）。
	let disposeCodeAreaSource: (() => void) | undefined;
	let layoutSubscriptions: { dispose(): void }[] = [];
	/// 挂载期订阅 / 监听的登记句柄（见 `workspaceEffects.ts`）。
	let workspaceEffects: WorkspaceEffects | undefined;
	let mounted = false;

	const PREFERENCES_PANEL_ID = 'preferences';
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
	 * 面板 props 及其「状态 → props」同步在 `workspaceProps.svelte.ts`（那里是全套
	 * `$state` 代理与 `$effect`）；组件只保留注册进 dockview 的 `componentProps`。
	 * 依赖按 getter 注入：`$derived` 变量按值传进来会冻结成调用时的快照。
	 */
	const panelProps = createWorkspaceProps({
		session,
		hostViewState,
		rotateHostView,
		selectTool,
		changeUiScale,
		resetUiScale,
		resetPreferencesAndTool,
		resetPanelLayout: () => panelLayout.reset(),
		openPreferences,
		onMinimize: () => onMinimize?.(),
		onClose: () => onClose?.(),
		getWorkspaceState: () => workspaceState,
		getLayerTree: () => layerTree,
		getDocument: () => gpenDocument,
		getLayerView: () => layerView,
		activateLayerNode,
		renameLayerNode,
		moveLayerNodes
	});

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
		panelProps.outlinerProps.renameRequest += 1;
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
	 * 详细坑与实测数据见 `src/lib/components/README-preferences.md`。
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

	/**
	 * 内部 JSON 状态树（文件菜单「调试：内部 JSON 状态树」）的数据源；读取器在
	 * `workspaceDebug.ts`。注册表是命令式的，卸载时要注销（见 onDestroy）。
	 */
	function registerInternalStateSource(): () => void {
		return registerCodeAreaSource(
			createWorkspaceDebugSource({
				session,
				getDocument: () => gpenDocument,
				getWorkspaceState: () => workspaceState,
				getLayout: () => ({ width: layoutWidth, height: layoutHeight }),
				getZoom: () => ({ external: externalZoomFactor, workspace: workspaceZoom }),
				getViewport: () => ({
					width: viewportWidth,
					height: viewportHeight,
					revision: viewportRevision
				})
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

	/** 视口（scroll / pinch / resize）变化：刷新缩放读数与布局（见 `workspaceEffects.ts`）。 */
	function onViewportChange(): void {
		updateExternalZoom();
		measureViewport();
		// 调试树（viewport 一节）靠它订阅 scroll / pinch / resize：`$state` 一变，
		// 面板里的 JSON 就重算；限频在 CodeArea 的去抖里。
		viewportRevision += 1;
		panelLayout.schedule();
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
		// 默认当 viewport 组的 file tab 打开。见 `src/lib/components/codeArea/README.md`。
		[CODE_AREA_COMPONENT]: BlenderCodeArea
	};

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
							props: panelProps.componentProps(name, id)
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

		// tab 菜单 / 命令 / 视口监听 / 缩放修正：登记与注销成对，见 workspaceEffects.ts。
		workspaceEffects = createWorkspaceEffects({
			container,
			tabMenu,
			handleEscapePriority,
			registerCommands,
			getZoom: () => workspaceZoom,
			onViewportChange,
			onLayoutChange: () => panelLayout.handleLayoutEvent()
		});
		workspaceEffects.start();
		panelLayout.schedule();
	});

	onDestroy(() => {
		mounted = false;
		// 先恢复页面（旋转是 DOM 投影）再收相机 spacer。
		layerView?.restore();
		layerView = undefined;
		infiniteCanvas?.destroy();
		infiniteCanvas = undefined;
		// 挂载期订阅 / 监听（tab 菜单、命令、缩放修正、视口监听）的对称注销。
		workspaceEffects?.dispose();
		workspaceEffects = undefined;
		panelLayout.dispose();
		// 工作区没了就把缩放变量收回 1：菜单在别的页面（`/demo/menu`）还得按 1× 渲染。
		setWorkspaceZoomVariable(1);
		for (const subscription of layoutSubscriptions) subscription.dispose();
		layoutSubscriptions = [];
		disposeCodeAreaSource?.();
		disposeCodeAreaSource = undefined;
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
