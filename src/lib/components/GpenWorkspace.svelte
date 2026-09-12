<script lang="ts">
	import { mount, onDestroy, onMount, unmount, type Component } from 'svelte';
	import 'dockview/dist/styles/dockview.css';
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
	import {
		cloneGpenPanelLayout,
		createDefaultGpenWorkspaceState,
		normalizeUiScale,
		UI_SCALE_DEFAULT,
		UI_SCALE_MAX,
		UI_SCALE_MIN,
		UI_SCALE_STEP,
		type GpenToolId,
		type GpenWorkspaceState
	} from './gpenWorkspaceState';
	import { readGpenViewportZoomFactor } from './gpenViewport';
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

	let { state: providedState }: { state?: GpenWorkspaceState } = $props();
	let localState = $state(createDefaultGpenWorkspaceState());
	const workspaceState = $derived(providedState ?? localState);

	// oxlint-disable-next-line no-unassigned-vars
	let container: HTMLDivElement;
	let dockview: ReturnType<typeof createDockview> | undefined;
	let layerTree: UiLayerTree | undefined;
	let tabMenuPanelId: string | undefined;
	let disposeTabMenu: (() => void) | undefined;
	let layoutSubscription: { dispose(): void } | undefined;
	let viewportResizeObserver: ResizeObserver | undefined;
	let removeViewportListeners: (() => void) | undefined;
	let layoutFrame: number | undefined;
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

	function selectTool(tool: GpenToolId) {
		workspaceState.activeTool = tool;
		if (tool === 'mouse') {
			// Removing the workspace from hit testing is what gives the webpage
			// pointer, touch, and keyboard control. Blur avoids leaving a toolbar
			// button as the soft-keyboard/focus owner.
			workspaceState.collapsed = true;
			const active = document.activeElement;
			if (active instanceof HTMLElement) active.blur();
		} else {
			workspaceState.collapsed = false;
		}
	}

	function updateExternalZoom() {
		externalZoomFactor = readGpenViewportZoomFactor();
	}

	function measureViewport() {
		const parent = container.parentElement;
		const width = parent?.clientWidth ?? window.innerWidth;
		const height = parent?.clientHeight ?? window.innerHeight;
		viewportWidth = Math.max(0, width);
		viewportHeight = Math.max(0, height);
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
		});
	}

	function captureDockviewLayout() {
		const layout = cloneGpenPanelLayout(dockview?.toJSON());
		if (layout) workspaceState.panelLayout = layout;
	}

	function restoreDockviewLayout(): boolean {
		if (!dockview || !workspaceState.panelLayout) return false;
		try {
			dockview.fromJSON(workspaceState.panelLayout as unknown as SerializedDockview);
			return true;
		} catch (error) {
			console.debug('[gpen] ignored rejection: GpenWorkspace layout restore', error);
			workspaceState.panelLayout = null;
			return false;
		}
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
		menu: 'menu',
		tools: 'tools',
		viewport: 'viewport',
		timeline: 'timeline'
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
						const props =
							name === 'tools'
								? { state: workspaceState, onSelectTool: selectTool }
								: undefined;
						mountedComponent = mount(Component, { target: element, props });
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
				className: 'dockview-theme-light',
				colorScheme: 'light',
				tabGroupIndicator: 'none'
			}
		});
		layoutSubscription = dockview.onDidMutateLayout(() => captureDockviewLayout());
		measureViewport();
		layoutDockview();

		const restoredLayout = restoreDockviewLayout();
		if (!restoredLayout) {
				// Build outward from the viewport so every surrounding panel occupies its
			// own dockview group and remains resizable by the user.
			// Panels resize freely like Blender. dockview still needs a small
			// non-zero minimum so the grid never collapses to a zero-size panel on
			// first layout; the values are small enough to keep resizing unconstrained.
			dockview.addPanel({
				id: 'viewport',
				component: 'viewport',
				title: 'viewport',
				minimumWidth: 240,
				minimumHeight: 160
			});
			dockview.addPanel({
				id: 'menu',
				component: 'menu',
				title: 'menu',
				position: { referencePanel: 'viewport', direction: 'above' },
				initialHeight: 42,
				minimumHeight: 28
			});
			dockview.addPanel({
				id: 'tools',
				component: 'tools',
				title: 'tools',
				position: { referencePanel: 'viewport', direction: 'left' },
				initialWidth: 208,
				minimumWidth: 96
			});
			dockview.addPanel({
				id: 'timeline',
				component: 'timeline',
				title: 'timeline',
				position: { referencePanel: 'viewport', direction: 'below' },
				initialHeight: 180,
				minimumHeight: 48
			});
			dockview.addPanel({
				id: 'outliner',
				component: 'outliner',
				title: 'outliner',
				position: { referencePanel: 'viewport', direction: 'right' },
				initialWidth: 280,
				minimumWidth: 160
			});
			dockview.addPanel({
				id: 'properties',
				component: 'properties',
				title: 'properties',
				position: { referencePanel: 'outliner', direction: 'below' },
				initialHeight: 300
			});
			dockview.addPanel({
				id: 'statusbar',
				component: 'statusbar',
				title: 'statusbar',
				position: { referencePanel: 'timeline', direction: 'below' },
				initialHeight: 26,
				minimumHeight: 22
			});
		}

		// Dockview groups have a 100px default minimum of their own. Relax only
		// the compact Blender chrome groups so the requested initial heights can
		// take effect without changing the panel constraints above.
		dockview.getPanel('menu')?.group.api.setConstraints({ minimumHeight: 28 });
		dockview.getPanel('timeline')?.group.api.setConstraints({ minimumHeight: 48 });
		dockview.getPanel('statusbar')?.group.api.setConstraints({ minimumHeight: 22 });
		dockview.getPanel('menu')?.group.api.setSize({ height: 58 });
		dockview.getPanel('timeline')?.group.api.setSize({ height: 180 });
		dockview.getPanel('statusbar')?.group.api.setSize({ height: 26 });
		captureDockviewLayout();

		disposeTabMenu = registerMenuItems(WORKSPACE_TAB_MENU_ID, tabMenuItems);
		container.addEventListener('contextmenu', handleTabContextMenu);

		const onViewportChange = () => {
			updateExternalZoom();
			measureViewport();
			scheduleLayout();
		};
		window.addEventListener('resize', onViewportChange, { passive: true });
		window.addEventListener('scroll', onViewportChange, { passive: true });
		window.visualViewport?.addEventListener('resize', onViewportChange, { passive: true });
		window.visualViewport?.addEventListener('scroll', onViewportChange, { passive: true });
		removeViewportListeners = () => {
			window.removeEventListener('resize', onViewportChange);
			window.removeEventListener('scroll', onViewportChange);
			window.visualViewport?.removeEventListener('resize', onViewportChange);
			window.visualViewport?.removeEventListener('scroll', onViewportChange);
		};

		const parent = container.parentElement;
		if (typeof ResizeObserver !== 'undefined' && parent) {
			viewportResizeObserver = new ResizeObserver(() => onViewportChange());
			viewportResizeObserver.observe(parent);
		}
		scheduleLayout();
	});

	onDestroy(() => {
		mounted = false;
		if (layoutFrame !== undefined) cancelAnimationFrame(layoutFrame);
		removeViewportListeners?.();
		removeViewportListeners = undefined;
		viewportResizeObserver?.disconnect();
		viewportResizeObserver = undefined;
		layoutSubscription?.dispose();
		layoutSubscription = undefined;
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
	style:width={containerWidth}
	style:height={containerHeight}
	style:zoom={workspaceZoom}
>
	<div class="ui-scale-control" role="group" aria-label="界面缩放">
		<button
			type="button"
			aria-label="缩小界面"
			disabled={workspaceState.uiScale <= UI_SCALE_MIN}
			onclick={() => changeUiScale(-UI_SCALE_STEP)}
		>−</button>
		<output aria-label="当前界面缩放" aria-live="polite">{workspaceState.uiScale.toFixed(2)}×</output>
		<button
			type="button"
			aria-label="放大界面"
			disabled={workspaceState.uiScale >= UI_SCALE_MAX}
			onclick={() => changeUiScale(UI_SCALE_STEP)}
		>+</button>
		<button type="button" aria-label="重置界面缩放" onclick={resetUiScale}>重置</button>
	</div>
</div>

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
		/* 这四个变量与 app.css :root 的全局 token 值一致，直接用全局值。 */
		z-index: 0;
		overflow: hidden;
		background: var(--gpen-workspace-background);
		color: var(--gpen-panel-foreground);
		font-family: var(--gpen-font-sans);
		font-size: var(--gpen-font-size);
		line-height: var(--gpen-line-height);
		/* Leave the transparent viewport as a hit-test hole. Individual dockview
		 * chrome groups opt back in below, as do sashes and our scale controls. */
		pointer-events: none;
	}

	.ui-scale-control {
		position: absolute;
		top: 0.5lh;
		right: 1.25ch;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 0.5ch;
		padding: 0.25lh 0.5ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.35rem;
		background: rgb(255 255 255 / 0.94);
		box-shadow: 0 2px 8px rgb(15 23 42 / 0.12);
		color: var(--gpen-panel-foreground);
	}

	.ui-scale-control button {
		min-width: 4.25ch;
		height: 1.5lh;
		padding: 0 1ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.ui-scale-control button:hover:not(:disabled) {
		background: #e9eef5;
	}

	.ui-scale-control button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.ui-scale-control output {
		min-width: 8.5ch;
		font-variant-numeric: tabular-nums;
		text-align: center;
	}

	/* Dockview paints its shell and groups with theme variables by default. Keep
	 * those layers transparent so only the panel components paint their own
	 * surfaces; the viewport can then reveal the page gradient underneath. */
	:global(.dockview-container .dv-dockview),
	:global(.dockview-container .dv-groupview),
	:global(.dockview-container .dv-content-container) {
		background-color: transparent;
	}

	/* T3: the overlay and workspace shell opt out of hit testing. Non-viewport
	 * groups, tabs, sashes, and controls opt back in, leaving the transparent
	 * viewport content available to the webpage for click/wheel/touch events.
	 * A child such as the axis gizmo may opt in without making the whole hole
	 * opaque. */
	:global(.dockview-container .dv-groupview) {
		pointer-events: auto;
	}

	:global(.dockview-container .dv-groupview:has(.blender-panel-viewport)) {
		pointer-events: none;
	}

	:global(.dockview-container .dv-groupview:has(.blender-panel-viewport) > .dv-tabs-and-actions-container),
	:global(.dockview-container .dv-groupview:has(.blender-panel-viewport) .axis-gizmo),
	:global(.dockview-container .dv-sash),
	:global(.dockview-container .dv-resize-handle),
	:global(.dockview-container .dv-drop-target-container),
	.ui-scale-control {
		pointer-events: auto;
	}

	/* The menu and status bar are chrome rather than dockable work areas. Keep
	 * their compact requested heights usable by removing only those two tab
	 * strips; the remaining panels retain their tab title bars for context menus. */
	:global(.dockview-container .dv-groupview:has(.blender-panel-menu) > .dv-tabs-and-actions-container),
	:global(.dockview-container .dv-groupview:has(.blender-panel-statusbar) > .dv-tabs-and-actions-container) {
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
		color: #475569;
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
		color: #334155;
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
		background: #eef2ff;
	}

	:global(.gpen-layer-kind) {
		margin-left: auto;
		padding: 0 0.5ch;
		border-radius: var(--gpen-radius);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: #fff;
	}

	:global(.gpen-layer-kind-gpen) {
		background: #7c3aed;
	}

	:global(.gpen-layer-kind-html) {
		background: #0ea5e9;
	}

	:global(.gpen-layer-active) {
		font-size: 0.6rem;
		color: var(--gpen-panel-accent);
	}

	:global(.gpen-layer-empty) {
		color: #94a3b8;
	}

	/* dockview's own stylesheet (dockview/dist/styles/dockview.css) styles the
	 * core DOM (tabs, sashes, dock/drop overlays, groups). Only gpen-specific
	 * classes below need local rules. */
</style>
