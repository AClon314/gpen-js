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
				<button type="button">{item}</button>
			{/each}
			<!-- 窗口：用原生 select 承载「执行一次的菜单命令」，<option> 就是命令本身。
			     不做 value 绑定——选完就复位，没有需要保持的状态。 -->
			<select class="menu-select" aria-label="窗口菜单" title="窗口菜单" onchange={runWindowCommand}>
				<option value="">窗口</option>
				<option value={WINDOW_RESET_LAYOUT}>重置面板布局</option>
			</select>
		</nav>

		<span class="title-bar-actions">
			<button class="workspace-switcher" type="button">2D Animation</button>

			<div class="ui-scale" role="group" aria-label="界面缩放">
				<button
					type="button"
					aria-label="缩小界面"
					disabled={uiScale <= UI_SCALE_MIN}
					onclick={() => onChangeUiScale?.(-UI_SCALE_STEP)}
				>−</button>
				<button
					class="ui-scale-value"
					type="button"
					title="点击重置界面缩放"
					aria-label="当前界面缩放 {uiScale.toFixed(2)}，点击重置"
					onclick={() => onResetUiScale?.()}
				>{uiScale.toFixed(2)}×</button>
				<button
					type="button"
					aria-label="放大界面"
					disabled={uiScale >= UI_SCALE_MAX}
					onclick={() => onChangeUiScale?.(UI_SCALE_STEP)}
				>+</button>
			</div>

			{#if onMinimize}
				<button
					class="title-bar-button"
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
					class="title-bar-button close-workspace"
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
		<button class="setting-tool" type="button">
			<sp-icon-brush></sp-icon-brush>
			<span>Airbrush</span>
			<sp-icon-chevron-down></sp-icon-chevron-down>
		</button>
		<span class="setting-label">画笔</span>
		<span class="divider" aria-hidden="true"></span>
		<span class="setting-field">尺寸 <strong>0.15 m</strong></span>
		<span class="setting-field">强度/力度 <strong>0.400</strong></span>
		<span class="divider" aria-hidden="true"></span>
		<span class="setting-field">高级</span>
		<span class="setting-field">笔画 ⌄</span>
		<span class="setting-field">游标 ⌄</span>
	</div>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: var(--gpen-font-size)/var(--gpen-line-height) var(--gpen-font-sans);
	}

	.blender-panel-menu {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--gpen-chrome-background);
		color: var(--gpen-panel-foreground);
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

	.menu-items button,
	.menu-items .menu-select {
		padding: 0.25lh 1ch;
		border: 0;
		border-radius: var(--gpen-radius);
		background: transparent;
		color: inherit;
		font: inherit;
		white-space: nowrap;
		cursor: pointer;
	}

	.menu-items button:hover,
	.menu-items .menu-select:hover {
		background: var(--gpen-panel-background-hover);
	}

	/* 原生下拉：保留浏览器自带的箭头，让“这里是菜单”一眼可见；只把边框/底色
	 * 压成和旁边的菜单按钮一样。`color-scheme: light dark` 让弹出的列表跟着
	 * 系统配色走（dockview 在根上把 color-scheme 固定成了 light）。 */
	.menu-items .menu-select {
		box-sizing: border-box;
		height: 1.9lh;
		/* Tailwind preflight / forms 把 select 的 appearance 清成了 none，
		 * 这里改回 auto：保留浏览器自带的箭头，也不必自己画一个假的。 */
		appearance: auto;
		padding-right: 0.5ch;
		border: 0;
		border-radius: var(--gpen-radius);
		background-color: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		color-scheme: light dark;
	}

	.menu-items button:focus-visible {
		background: var(--gpen-panel-background-hover);
		outline: 2px solid var(--gpen-panel-accent);
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
		border: 1px solid var(--gpen-panel-border);
		border-radius: 99px;
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-muted);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}

	.workspace-switcher:hover {
		background: var(--gpen-panel-background-hover);
		color: var(--gpen-panel-foreground);
	}

	.ui-scale {
		display: flex;
		align-items: center;
		height: 1.6lh;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background-raised);
		overflow: hidden;
	}

	.ui-scale button {
		height: 100%;
		min-width: 2.25ch;
		padding: 0 0.5ch;
		border: 0;
		background: transparent;
		color: var(--gpen-panel-muted);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}

	.ui-scale button:hover:not(:disabled) {
		background: var(--gpen-panel-background-hover);
		color: var(--gpen-panel-foreground);
	}

	.ui-scale button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	/* 比 `.ui-scale button` 多一个 class，才能压过它的 min-width。 */
	.ui-scale button.ui-scale-value {
		min-width: 5.5ch;
		font-variant-numeric: tabular-nums;
	}

	.title-bar-button {
		display: grid;
		place-items: center;
		width: 1.6lh;
		height: 1.6lh;
		padding: 0;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-muted);
		cursor: pointer;
	}

	.title-bar-button:hover {
		border-color: var(--gpen-panel-accent);
		background: var(--gpen-panel-background-hover);
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

	.setting-tool,
	.setting-field {
		display: inline-flex;
		align-items: center;
		gap: 0.75ch;
		height: 1.7lh;
		padding: 0 1ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-foreground);
		white-space: nowrap;
	}

	.setting-tool {
		padding-right: 0.75ch;
		font-weight: 600;
		cursor: pointer;
	}

	.setting-tool:hover {
		background: var(--gpen-panel-background-hover);
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

	.blender-panel-menu sp-icon-brush,
	.blender-panel-menu sp-icon-chevron-down,
	.blender-panel-menu sp-icon-minimize,
	.blender-panel-menu sp-icon-close {
		--mod-icon-size: 1.15em;
		color: inherit;
	}
</style>
