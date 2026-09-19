<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-down.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-close.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-minimize.js';

	import {
		UI_SCALE_MAX,
		UI_SCALE_MIN,
		UI_SCALE_STEP,
		type GpenWorkspaceState
	} from '../gpenWorkspaceState';

	// 标题栏 = 菜单行（应用菜单 + 工作区切换 + 界面缩放 + 关闭）+ 工具设置行。
	// 缩放 / 关闭这两个动作属于工作区外壳，由 GpenOverlay → GpenWorkspace 传进来，
	// 这样它们和菜单处在同一条视觉带上，而不是压在面板上的浮层。
	let {
		state,
		onChangeUiScale,
		onResetUiScale,
		onResetPanelLayout,
		onMinimize,
		onClose
	}: {
		state?: GpenWorkspaceState;
		onChangeUiScale?: (delta: number) => void;
		onResetUiScale?: () => void;
		onResetPanelLayout?: () => void;
		onMinimize?: () => void;
		onClose?: () => void;
	} = $props();

	const menuItems = ['文件', '编辑', '渲染', '帮助', '切换', '实用工具', '设置'];
	const uiScale = $derived(state?.uiScale ?? 1);

	// 窗口菜单是原生 `<select>`：这些是“执行一次”的命令，不是可保持状态的选项，所以
	// 选完立刻把控件复位（否则同一个命令第二次选不触发 change）。
	// 这也是布局的记忆点——panelLayout 存在 localStorage 里，改过默认布局后要在这里重置。
	const WINDOW_RESET_LAYOUT = 'reset-panel-layout';

	function runWindowCommand(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const command = select.value;
		// 命令执行完立刻复位到占位项，下一次才能再选同一条命令。
		select.value = '';
		if (command === WINDOW_RESET_LAYOUT) onResetPanelLayout?.();
	}
</script>

<div class="blender-panel blender-panel-menu" aria-label="菜单栏和工具设置">
	<div class="menu-row">
		<span class="app-mark" aria-hidden="true">✦</span>
		<nav class="menu-items" aria-label="主菜单">
			{#each menuItems as item}
				<button class="gpen-panel-button menu-item" type="button">{item}</button>
			{/each}
			<!-- 窗口：用原生 select 承载「执行一次的菜单命令」，<option> 就是命令本身。
			     不做 value 绑定——选完就复位，没有需要保持的状态。 -->
			<select class="menu-select" aria-label="窗口菜单" title="窗口菜单" onchange={runWindowCommand}>
				<option value="">窗口</option>
				<option value={WINDOW_RESET_LAYOUT}>重置面板布局</option>
			</select>
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

	.menu-item,
	.menu-items .menu-select {
		padding: 0.25lh 1ch;
		border-radius: var(--gpen-radius);
	}

	.menu-items .menu-select:hover {
		background: var(--gpen-panel-background-hover);
	}

	/* 原生下拉：保留浏览器自带的箭头，让“这里是菜单”一眼可见；只把边框/底色
	 * 压成和旁边的菜单按钮一样。`color-scheme: light dark` 让弹出的列表跟着
	 * 系统配色走（dockview 在根上把 color-scheme 固定成了 light）。 */
	.menu-items .menu-select {
		box-sizing: border-box;
		/* 宽度按占位项（"窗口"）给，不要跟着最宽的 <option> 撑开。 */
		width: 7ch;
		height: 1.9lh;
		/* Tailwind preflight / forms 把 select 的 appearance 清成了 none 并画了自己的箭头；
		 * 这里改回 auto 用浏览器自带的箭头，同时关掉那个背景箭头（否则会出现两个箭头）。 */
		appearance: auto;
		background-image: none;
		background-color: transparent;
		border: 0;
		padding: 0 0 0 1ch;
		color: inherit;
		font: inherit;
		cursor: pointer;
		/* 弹出的列表跟着系统配色走（dockview 在根上把 color-scheme 固定成了 light）。 */
		color-scheme: light dark;
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
