<script lang="ts">
	import { mount, onDestroy, onMount, unmount, type Component } from 'svelte';
	import 'dockview/dist/styles/dockview.css';
	import {
		createDockview,
		type CreateComponentOptions,
		type IContentRenderer
	} from 'dockview';
	import { MimeType, type GpenT } from 'gpen-protocol/flatbuffers';
	import { createDefaultGpen } from '../bindings/flatbuffers/defaults';
	import { buildLayerTree } from '../bindings/layers/layerAdapter';
	import type { UiLayerTree } from '../bindings/layers/types';
	import BlenderOutliner from './areas/Outliner.svelte';
	import BlenderProperties from './areas/Properties.svelte';
	import BlenderStatusBar from './areas/StatusBar.svelte';
	import BlenderTimeline from './areas/Timeline.svelte';
	import BlenderToolStrip from './areas/ToolStrip.svelte';
	import BlenderTopBar from './areas/TopBar.svelte';
	import BlenderViewport from './areas/Viewport.svelte';

	// oxlint-disable-next-line no-unassigned-vars
	let container: HTMLDivElement;
	let dockview: ReturnType<typeof createDockview> | undefined;
	let layerTree: UiLayerTree | undefined;
	let contextMenu: HTMLDivElement | undefined;

	const UI_SCALE_KEY = 'gpen.uiScale';
	const UI_SCALE_MIN = 0.5;
	const UI_SCALE_MAX = 2;
	const UI_SCALE_STEP = 0.25;
	const UI_SCALE_DEFAULT = 1;

	let uiScale = $state(UI_SCALE_DEFAULT);
	let storageReady = $state(false);

	function normalizeUiScale(value: number): number {
		const stepped = Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP;
		return Number(Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, stepped)).toFixed(2));
	}

	function changeUiScale(delta: number) {
		uiScale = normalizeUiScale(uiScale + delta);
	}

	function resetUiScale() {
		uiScale = UI_SCALE_DEFAULT;
	}

	// CSS `zoom` can differ or be unavailable in older browsers. It is scoped
	// to this document and is not synchronized between tabs; popout windows are
	// separate documents, so they are not affected by this workspace zoom.
	$effect(() => {
		if (!storageReady) return;
		try {
			localStorage.setItem(UI_SCALE_KEY, String(uiScale));
		} catch (e) {
			// localStorage may be unavailable in privacy-restricted contexts.
			console.debug("[gpen] ignored rejection: GpenWorkspace uiScale persist", e);
			return;
		}
	});

	const panelLabels: Record<string, string> = {
		menu: 'menu',
		tools: 'tools',
		viewport: 'viewport',
		timeline: 'timeline'
	};

	const panelComponents: Record<string, Component> = {
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


	function hideContextMenu() {
		contextMenu?.remove();
		contextMenu = undefined;
	}

	function addContextMenuItem(menu: HTMLDivElement, label: string, action: () => void) {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'gpen-context-menu-item';
		item.setAttribute('role', 'menuitem');
		item.textContent = label;
		item.addEventListener('click', () => {
			hideContextMenu();
			action();
		});
		menu.appendChild(item);
	}

	function addContextMenuSeparator(menu: HTMLDivElement) {
		const separator = document.createElement('div');
		separator.className = 'gpen-context-menu-separator';
		separator.setAttribute('role', 'separator');
		menu.appendChild(separator);
	}

	function showContextMenu(panelId: string, event: MouseEvent) {
		hideContextMenu();

		const menu = document.createElement('div');
		menu.className = 'gpen-context-menu';
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', '面板操作');

		addContextMenuSeparator(menu);
		addContextMenuItem(menu, '在新窗口打开', () => popoutPanel(panelId));
		addContextMenuItem(menu, '关闭', () => {
			const panel = dockview?.getPanel(panelId);
			if (panel) dockview?.removePanel(panel);
		});
		addContextMenuSeparator(menu);
		addContextMenuItem(menu, '浮动', () => {
			const panel = dockview?.getPanel(panelId);
			if (panel) dockview?.addFloatingGroup(panel);
		});

		contextMenu = menu;
		document.body.appendChild(menu);
		const margin = 8;
		const rect = menu.getBoundingClientRect();
		menu.style.left = `${Math.max(margin, Math.min(event.clientX, window.innerWidth - rect.width - margin))}px`;
		menu.style.top = `${Math.max(margin, Math.min(event.clientY, window.innerHeight - rect.height - margin))}px`;
	}

	function handleTabContextMenu(event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const tab = target.closest<HTMLElement>('.dv-tab');
		if (!tab || !container.contains(tab)) {
			hideContextMenu();
			return;
		}

		const panelId = tab.dataset.tabPanelId;
		if (!panelId) return;
		event.preventDefault();
		event.stopPropagation();
		showContextMenu(panelId, event);
	}

	function handleContextMenuKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') hideContextMenu();
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
						mountedComponent = mount(Component, { target: element });
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
		try {
			const storedValue = localStorage.getItem(UI_SCALE_KEY);
			if (storedValue !== null) {
				const storedScale = Number(storedValue);
				if (Number.isFinite(storedScale)) {
					uiScale = normalizeUiScale(storedScale);
				}
			}
			// oxlint-disable-next-line catch/must-return-or-throw -- 保留默认值并继续初始化
		} catch {
			// Keep the default when localStorage is unavailable or unreadable.
		}
		storageReady = true;

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
		dockview.layout(container.clientWidth, container.clientHeight);

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

		// Dockview groups have a 100px default minimum of their own. Relax only
		// the compact Blender chrome groups so the requested initial heights can
		// take effect without changing the panel constraints above.
		dockview.getPanel('menu')?.group.api.setConstraints({ minimumHeight: 28 });
		dockview.getPanel('timeline')?.group.api.setConstraints({ minimumHeight: 48 });
		dockview.getPanel('statusbar')?.group.api.setConstraints({ minimumHeight: 22 });
		dockview.getPanel('menu')?.group.api.setSize({ height: 58 });
		dockview.getPanel('timeline')?.group.api.setSize({ height: 180 });
		dockview.getPanel('statusbar')?.group.api.setSize({ height: 26 });

		container.addEventListener('contextmenu', handleTabContextMenu);
		document.addEventListener('click', hideContextMenu);
		document.addEventListener('keydown', handleContextMenuKeydown);
	});

	onDestroy(() => {
		container.removeEventListener('contextmenu', handleTabContextMenu);
		document.removeEventListener('click', hideContextMenu);
		document.removeEventListener('keydown', handleContextMenuKeydown);
		hideContextMenu();
		dockview?.dispose();
		dockview = undefined;
	});
</script>

<div
	bind:this={container}
	class="dockview-container"
	style="position: fixed; inset: 0;"
	style:zoom={uiScale}
>
	<div class="ui-scale-control" role="group" aria-label="界面缩放">
		<button
			type="button"
			aria-label="缩小界面"
			disabled={uiScale <= UI_SCALE_MIN}
			onclick={() => changeUiScale(-UI_SCALE_STEP)}
		>−</button>
		<output aria-label="当前界面缩放" aria-live="polite">{uiScale.toFixed(2)}×</output>
		<button
			type="button"
			aria-label="放大界面"
			disabled={uiScale >= UI_SCALE_MAX}
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
		--gpen-workspace-background: transparent;
		--gpen-panel-background: #ffffff;
		--gpen-panel-border: #cbd5e1;
		--gpen-panel-foreground: #1e293b;
		z-index: 0;
		overflow: hidden;
		background: var(--gpen-workspace-background);
		color: var(--gpen-panel-foreground);
		font: 13px/1.4 system-ui, sans-serif;
	}

	.ui-scale-control {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.35rem;
		background: rgb(255 255 255 / 0.94);
		box-shadow: 0 2px 8px rgb(15 23 42 / 0.12);
		color: var(--gpen-panel-foreground);
	}

	.ui-scale-control button {
		min-width: 1.75rem;
		height: 1.75rem;
		padding: 0 0.35rem;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.25rem;
		background: #fff;
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
		min-width: 3.5rem;
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

	:global(.gpen-context-menu) {
		position: fixed;
		z-index: 10000;
		min-width: 156px;
		padding: 4px;
		border: 1px solid #b9c3d0;
		border-radius: 4px;
		background: #fff;
		box-shadow: 0 6px 18px rgb(15 23 42 / 0.22);
		color: #1e293b;
		font: 13px/1.35 system-ui, sans-serif;
	}

	:global(.gpen-context-menu-item) {
		display: block;
		width: 100%;
		padding: 0.4rem 0.65rem;
		border: 0;
		border-radius: 3px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	:global(.gpen-context-menu-item:hover),
	:global(.gpen-context-menu-item:focus-visible) {
		background: #e9eef5;
		outline: none;
	}

	:global(.gpen-context-menu-separator) {
		height: 1px;
		margin: 4px 2px;
		background: #d7dde6;
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
		min-height: 2rem;
		padding: 0.5rem 0.75rem 0.75rem;
		color: #475569;
		background: var(--gpen-panel-background);
		overflow: auto;
	}

	:global(.gpen-placeholder-label) {
		display: grid;
		place-items: center;
		height: 100%;
		color: #64748b;
	}


	:global(.gpen-timeline-header) {
		margin-bottom: 0.5rem;
		font-weight: 600;
		color: #334155;
	}

	:global(.gpen-layer-list) {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	:global(.gpen-layer-row) {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.4rem;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		color: var(--gpen-panel-foreground);
	}

	:global(.gpen-layer-row-active) {
		border-color: var(--gpen-panel-border);
		background: #eef2ff;
	}

	:global(.gpen-layer-kind) {
		margin-left: auto;
		padding: 0 0.35rem;
		border-radius: 0.25rem;
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
		color: #4f46e5;
	}

	:global(.gpen-layer-empty) {
		color: #94a3b8;
	}

	/* dockview's own stylesheet (dockview/dist/styles/dockview.css) styles the
	 * core DOM (tabs, sashes, dock/drop overlays, groups). Only gpen-specific
	 * classes below need local rules. */
</style>
