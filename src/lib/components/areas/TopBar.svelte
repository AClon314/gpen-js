<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-down.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-close.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-full-screen-exit.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-full-screen.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-minimize.js';

	import { onDestroy, onMount } from 'svelte';
	import {
		UI_SCALE_MAX,
		UI_SCALE_MIN,
		UI_SCALE_STEP,
		type GpenWorkspaceState
	} from '../gpenWorkspaceState';
	import {
		close,
		contextMenu,
		menuState,
		openAt,
		registerMenuItems,
		type MenuItem
	} from '../contextMenu/contextMenu.svelte';

	// 标题栏 = 菜单行（应用菜单 + 工作区切换 + 界面缩放 + 关闭）+ 工具设置行。
	// 缩放 / 关闭这两个动作属于工作区外壳，由 GpenOverlay → GpenWorkspace 传进来，
	// 这样它们和菜单处在同一条视觉带上，而不是压在面板上的浮层。
	let {
		state,
		onChangeUiScale,
		onResetUiScale,
		onResetPanelLayout,
		onToggleImmersive,
		onMinimize,
		onClose
	}: {
		state?: GpenWorkspaceState;
		onChangeUiScale?: (delta: number) => void;
		onResetUiScale?: () => void;
		onResetPanelLayout?: () => void;
		onToggleImmersive?: () => void;
		onMinimize?: () => void;
		onClose?: () => void;
	} = $props();

	const menuItems = ['文件', '编辑', '渲染', '帮助', '切换', '实用工具', '设置'];
	const uiScale = $derived(state?.uiScale ?? 1);

	/**
	 * 窗口菜单改用和右键菜单同一套 `contextMenu`（不再是原生 `<select>`）：
	 * 菜单节点就是命令本身，与 `menus`/`commands` 分家的约定一致（handoff T1），
	 * 样式 / 键盘导航 / 深色 token 全部复用 `ContextMenu.svelte`，不再有
	 * 「选完复位 select.value」那种状态技巧。
	 */
	const WINDOW_MENU_ID = 'gpen-window-menu';

	function windowMenuItems(): MenuItem[] {
		return [
			{
				id: 'gpen.reset_panel_layout',
				label: '重置面板布局',
				order: 10,
				action: () => onResetPanelLayout?.()
			}
		];
	}

	function openWindowMenu(event: MouseEvent) {
		const anchor = event.currentTarget;
		if (!(anchor instanceof HTMLElement)) return;
		openAt(WINDOW_MENU_ID, anchor);
	}

	// 具名注册：provider 由注册表持有（`use:contextMenu` 只关联 DOM），
	// 所以菜单可以在别处枚举 / 被命令面板复用。
	onMount(() => registerMenuItems(WINDOW_MENU_ID, windowMenuItems));

	// 面板被关掉 / 重排时菜单可能还开着：卸载时顺手收起。
	onDestroy(() => {
		if (menuState.visible && menuState.id === WINDOW_MENU_ID) close();
	});
</script>

<div class="blender-panel blender-panel-menu" aria-label="菜单栏和工具设置">
	<div class="menu-row">
		<span class="app-mark" aria-hidden="true">✦</span>
		<nav class="menu-items" aria-label="主菜单">
			{#each menuItems as item}
				<button class="gpen-panel-button menu-item" type="button">{item}</button>
			{/each}
			<!-- 窗口：`use:contextMenu` 只把按钮关联到具名注册表（provider 由下面
			     `registerMenuItems` 持有），点击时按按钮矩形锚定菜单。 -->
			<button
				class="gpen-panel-button menu-item menu-window"
				type="button"
				aria-haspopup="menu"
				aria-label="窗口菜单"
				title="窗口菜单"
				use:contextMenu={WINDOW_MENU_ID}
				onclick={openWindowMenu}
			>窗口</button>
		</nav>

		<span class="title-bar-actions">
			<button class="gpen-pill workspace-switcher" type="button">2D Animation</button>

			<div class="gpen-pill ui-scale" role="group" aria-label="界面缩放">
				<button
					class="gpen-panel-button"
					type="button"
					aria-label="缩小界面"
					disabled={uiScale <= UI_SCALE_MIN}
					onclick={() => onChangeUiScale?.(-UI_SCALE_STEP)}
				>−</button>
				<button
					class="gpen-panel-button ui-scale-value"
					type="button"
					title="点击重置界面缩放"
					aria-label="当前界面缩放 {uiScale.toFixed(2)}，点击重置"
					onclick={() => onResetUiScale?.()}
				>{uiScale.toFixed(2)}×</button>
				<button
					class="gpen-panel-button"
					type="button"
					aria-label="放大界面"
					disabled={uiScale >= UI_SCALE_MAX}
					onclick={() => onChangeUiScale?.(UI_SCALE_STEP)}
				>+</button>
			</div>

			{#if onToggleImmersive}
				<button
					class="gpen-panel-button title-bar-button"
					type="button"
					aria-label={state?.immersive ? '退出沉浸模式' : '进入沉浸模式'}
					title={state?.immersive ? '退出沉浸模式（只留绘制面）' : '沉浸模式（隐藏面板，最大化绘制面）'}
					aria-pressed={state?.immersive ?? false}
					onclick={onToggleImmersive}
				>
					{#if state?.immersive}
						<sp-icon-full-screen-exit></sp-icon-full-screen-exit>
					{:else}
						<sp-icon-full-screen></sp-icon-full-screen>
					{/if}
				</button>
			{/if}

			{#if onMinimize}
				<button
					class="gpen-panel-button title-bar-button"
					type="button"
					aria-label="最小化 gpen（把网页交还给页面）"
					title="最小化（把指针交还给网页）"
					onclick={onMinimize}
				>
					<sp-icon-minimize></sp-icon-minimize>
				</button>
			{/if}

			{#if onClose}
				<button
					class="gpen-panel-button title-bar-button close-workspace"
					type="button"
					aria-label="关闭 gpen"
					title="关闭 gpen"
					onclick={onClose}
				>
					<sp-icon-close></sp-icon-close>
				</button>
			{/if}
		</span>
	</div>

	<div class="tool-settings" aria-label="工具设置">
		<button class="gpen-pill setting-tool" type="button">
			<sp-icon-brush></sp-icon-brush>
			<span>Airbrush</span>
			<sp-icon-chevron-down></sp-icon-chevron-down>
		</button>
		<span class="setting-label">画笔</span>
		<span class="divider" aria-hidden="true"></span>
		<span class="gpen-pill setting-field">尺寸 <strong>0.15 m</strong></span>
		<span class="gpen-pill setting-field">强度/力度 <strong>0.400</strong></span>
		<span class="divider" aria-hidden="true"></span>
		<span class="gpen-pill setting-field">高级</span>
		<span class="gpen-pill setting-field">笔画 ⌄</span>
		<span class="gpen-pill setting-field">游标 ⌄</span>
	</div>
</div>

<style>
	.blender-panel-menu {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--gpen-chrome-background);
	}

	.menu-row,
	.tool-settings {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	/* --- 菜单行 --- */

	.menu-row {
		height: 2.4lh;
		padding: 0 0.5ch 0 1ch;
		background: var(--gpen-chrome-background);
		border-bottom: 1px solid var(--gpen-panel-border);
	}

	.app-mark {
		margin-right: 1ch;
		color: var(--gpen-panel-accent);
		font-size: 1.1em;
	}

	.menu-items {
		display: flex;
		align-items: center;
		gap: 0.25ch;
		min-width: 0;
		overflow: hidden;
	}

	.menu-item {
		padding: 0.25lh 1ch;
		border-radius: var(--gpen-radius);
	}

	/* 菜单栏上的菜单按钮：与右键菜单同一套交互，只是永远显示自己的标签。
	 * 展开时给一点按下感（`aria-expanded` 由 ContextMenu 之外的状态驱动不了，
	 * 所以只用 :active / :focus-visible）。 */
	.menu-window:active {
		background: var(--gpen-panel-selection);
	}

	/* 菜单项贴在一起，焦点环外扩会和邻项重叠，所以画在内侧。 */
	.menu-item:focus-visible {
		outline-offset: -2px;
	}

	/* 右侧动作组：和菜单之间用自动外边距隔开，永远贴住标题栏右端。
	 * padding 里留出关闭按钮的位置——它在 overlay 层，不在这棵 DOM 里。 */
	.title-bar-actions {
		display: flex;
		align-items: center;
		gap: 0.75ch;
		margin-left: auto;
		padding-right: 2.25lh;
	}

	.workspace-switcher {
		height: 1.6lh;
		padding: 0 1.25ch;
		border-radius: 99px;
		color: var(--gpen-panel-muted);
		font-weight: 600;
	}

	.ui-scale {
		height: 1.6lh;
		padding: 0;
		overflow: hidden;
	}

	.ui-scale button {
		height: 100%;
		min-width: 2.25ch;
		padding: 0 0.5ch;
		border: 0;
		border-radius: 0;
		color: var(--gpen-panel-muted);
		font-size: 12px;
	}

	/* 比 `.ui-scale button` 多一个 class，才能压过它的 min-width。 */
	.ui-scale button.ui-scale-value {
		min-width: 5.5ch;
		font-variant-numeric: tabular-nums;
	}

	.title-bar-button {
		width: 1.6lh;
		height: 1.6lh;
		padding: 0;
		border-color: var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-muted);
	}

	.title-bar-button:hover:not(:disabled) {
		border-color: var(--gpen-panel-accent);
		color: var(--gpen-panel-accent);
	}

	.close-workspace:hover {
		border-color: var(--gpen-danger);
		background: color-mix(in srgb, var(--gpen-danger) 16%, transparent);
		color: var(--gpen-danger);
	}

	/* --- 工具设置行 --- */

	.tool-settings {
		gap: 0.75ch;
		height: 2.6lh;
		padding: 0 1.5ch;
		background: var(--gpen-chrome-background-subtle);
		overflow: hidden;
	}

	.setting-tool {
		padding-right: 0.75ch;
		font-weight: 600;
	}

	.setting-field strong {
		font-weight: 600;
		color: var(--gpen-panel-accent);
		font-variant-numeric: tabular-nums;
	}

	.setting-label {
		color: var(--gpen-panel-muted);
	}

	.divider {
		width: 1px;
		height: 1.4lh;
		margin: 0 0.5ch;
		background: var(--gpen-panel-border);
	}

</style>
