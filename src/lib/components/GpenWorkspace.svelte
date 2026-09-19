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
	import { MimeType } from 'gpen-protocol/flatbuffers';
	import { createDefaultGpen } from '../protocol/defaults';
	import { buildLayerTree } from '../layers/layerAdapter';
	import type { UiLayerTree } from '../layers/types';
	import { applyInfiniteCanvas, guessWebLayer, type InfiniteCanvas } from '../canvas/index';
	import { createLayerView, type LayerView } from '../layers/layerView';
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
	import { observeViewport } from '#lib/visualViewport';
	import {
		open as openMenu,
		registerMenuItems,
		type MenuItem
	} from './contextMenu/contextMenu.svelte';
	import BlenderOutliner from './areas/Outliner.svelte';
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
	let layerTree: UiLayerTree | undefined;
	/// 图层视图：Web 图层（element）或未来的 gpen 画布（canvas）。
	let layerView = $state<LayerView | undefined>(undefined);
	let infiniteCanvas: InfiniteCanvas | undefined;
	/// 视图旋转（度）。真值以后归图层模型；这里只驱动 DOM 投影。
	const hostViewState = $state({ rotation: 0 });
	let tabMenuPanelId: string | undefined;
	let disposeTabMenu: (() => void) | undefined;
	let layoutSubscriptions: { dispose(): void }[] = [];
	let viewportResizeObserver: ResizeObserver | undefined;
	let removeViewportListeners: (() => void) | undefined;
	let layoutFrame: number | undefined;
	let applyDefaultSizes = false;
	let pendingRestore = false;
	let layoutDirty = false;
	let mounted = false;

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
	}

	function updateExternalZoom() {
		externalZoomFactor = readGpenViewportZoomFactor();
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
		dockview?.getPanel('statusbar')?.group.api.setSize({ height: 24 });
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
		statusbar: BlenderStatusBar
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
		if (name === 'viewport') return { viewState: hostViewState, onRotate: rotateHostView };
		if (name === 'menu') {
			return {
				state: workspaceState,
				onChangeUiScale: changeUiScale,
				onResetUiScale: resetUiScale,
				onResetPanelLayout: resetPanelLayout,
				onToggleImmersive: toggleImmersive,
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
		layerTree = buildLayerTree(createDefaultGpen(window.location.href));

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
		disposeTabMenu?.();
		disposeTabMenu = undefined;
		dockview?.dispose();
		dockview = undefined;
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
