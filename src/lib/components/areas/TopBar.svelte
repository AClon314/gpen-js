<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-down.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-close.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-minimize.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js';

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
		TOUCH_OPT_OUT_ATTRIBUTE
	} from '../contextMenu/contextMenu.svelte';
	import { GPEN_MENU_BAR, GPEN_MENU_IDS, menuProvider } from '../menuBar';

	// 标题栏 = 菜单行（应用菜单 + 工作区切换 + 界面缩放 + 关闭）+ 工具设置行。
	// 缩放 / 关闭这两个动作属于工作区外壳，由 GpenOverlay → GpenWorkspace 传进来，
	// 这样它们和菜单处在同一条视觉带上，而不是压在面板上的浮层。
	let {
		state,
		onChangeUiScale,
		onResetUiScale,
		onMinimize,
		onClose,
		onOpenPreferences
	}: {
		state?: GpenWorkspaceState;
		onChangeUiScale?: (delta: number) => void;
		onResetUiScale?: () => void;
		onMinimize?: () => void;
		onClose?: () => void;
		onOpenPreferences?: () => void;
	} = $props();

	const uiScale = $derived(state?.uiScale ?? 1);

	/** 菜单栏按钮的触屏豁免属性：同一个写法的单一来源（见 `contextMenu.svelte.ts`）。 */
	const TOUCH_OPT_OUT = { [TOUCH_OPT_OUT_ATTRIBUTE]: '' };

	/**
	 * 每个菜单一个具名注册表（`registerMenuItems`），按钮只关联名字 + 在点击时用
	 * 按钮矩形锚定菜单（`openAt`）——和上一轮「窗口」菜单完全同一套，只是现在
	 * 菜单内容来自 `menuBar.ts` 的命令 id 列表。
	 *
	 * 卸载时逐个 `dispose()`：面板被关掉 / 重排时不能留下悬空注册表。
	 */
	const menuDisposers: (() => void)[] = [];

	onMount(() => {
		for (const { id } of GPEN_MENU_BAR) {
			const provider = menuProvider(id);
			if (provider) menuDisposers.push(registerMenuItems(id, provider));
		}
		// 齿轮按钮用的是同一个「偏好设置」命令，但菜单 id 独立（与其它菜单平级）。
		const settingsProvider = menuProvider(GPEN_MENU_IDS.settings);
		if (settingsProvider) menuDisposers.push(registerMenuItems(GPEN_MENU_IDS.settings, settingsProvider));
	});

	function openMenuFromButton(event: MouseEvent, id: string) {
		const anchor = event.currentTarget;
		if (!(anchor instanceof HTMLElement)) return;
		openAt(id, anchor);
	}

	// 面板被关掉 / 重排时菜单可能还开着：卸载时顺手收起。
	onDestroy(() => {
		for (const dispose of menuDisposers) dispose();
		menuDisposers.length = 0;
		const openId = menuState.id;
		if (menuState.visible && openId !== null && isGpenMenu(openId)) close();
	});

	function isGpenMenu(id: string): boolean {
		return id.startsWith('gpen-');
	}
</script>

<div class="blender-panel blender-panel-menu" aria-label="菜单栏和工具设置">
	<!--
		菜单栏按钮：`use:contextMenu` 只把按钮关联到具名注册表（provider 由
		`registerMenuItems` 持有），点击时按按钮矩形锚定菜单（`openAt`）。

		每个按钮都带 `TOUCH_OPT_OUT_ATTRIBUTE`：它们是「点一下开菜单」的普通按钮，
		不该被当成触屏长按目标——长按定时器会吞掉浏览器自己的 click
		（见 `contextMenu.svelte.ts` 里的注释）。右键照旧。
	-->
	{#snippet menuButton(id: string, label: string)}
		<button
			class="gpen-panel-button menu-item"
			type="button"
			aria-haspopup="menu"
			aria-label={`${label}菜单`}
			title={`${label}菜单`}
			use:contextMenu={id}
			{...TOUCH_OPT_OUT}
			onclick={(event) => openMenuFromButton(event, id)}
		>{label}</button>
	{/snippet}

	<div class="menu-row">
		<span class="app-mark" aria-hidden="true">✦</span>
		<nav class="menu-items" aria-label="主菜单">
			{#each GPEN_MENU_BAR as menu (menu.id)}
				{@render menuButton(menu.id, menu.label)}
			{/each}
			<!-- 齿轮只放图标，类名 / 标题 / 内容都不同，所以不走上面的 snippet。 -->
			<button
				class="gpen-panel-button menu-item menu-settings"
				type="button"
				aria-haspopup="menu"
				aria-label="设置菜单"
				title="偏好设置"
				use:contextMenu={GPEN_MENU_IDS.settings}
				{...TOUCH_OPT_OUT}
				onclick={(event) => openMenuFromButton(event, GPEN_MENU_IDS.settings)}
			>
				<sp-icon-settings></sp-icon-settings>
			</button>
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
					aria-label="隐藏面板"
					title="隐藏面板（把整个工作区收起来）"
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

	/* 顶部两条带（菜单行 / 工具设置行）都是**横向滚动的单行**：窄容器里装不下就滑，
	   而不是被 `overflow: hidden` 裁掉——裁掉的结果是「看得见标签、点下去打在别处」。
	   两条带各自的高度（2.4lh / 2.6lh）不能变，所以滚动条要隐掉；
	   `touch-action: pan-x` 让顶部带上的滑动只用来翻菜单 / 字段，不会把宿主网页滚走。 */
	.menu-items,
	.tool-settings {
		overflow-x: auto;
		overflow-y: hidden;
		overscroll-behavior-x: contain;
		touch-action: pan-x;
		scrollbar-width: none;
	}

	.menu-items::-webkit-scrollbar,
	.tool-settings::-webkit-scrollbar {
		display: none;
	}

	/* 滚动容器里的项不缩：宽度不够时滑动，而不是把标签 / 字段挤成一团。 */
	.menu-items > *,
	.tool-settings > * {
		flex: 0 0 auto;
		white-space: nowrap;
	}

	/* --- 菜单行 --- */

	.menu-row {
		height: 2.4lh;
		padding: 0 0.5ch 0 1ch;
		background: var(--gpen-chrome-background);
		border-bottom: 1px solid var(--gpen-panel-border);
		/* 菜单行自己当查询容器：dockview 面板可以被拖窄（宽窗口里也会有窄菜单行），
		   所以让位规则按**行**宽度算，不是按窗口宽度。 */
		container-type: inline-size;
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
	}

	.menu-item {
		padding: 0.25lh 1ch;
		border-radius: var(--gpen-radius);
	}

	/* 菜单栏上的菜单按钮：与右键菜单同一套交互，只是永远显示自己的标签。
	 * 展开时给一点按下感（`aria-expanded` 由 ContextMenu 之外的状态驱动不了，
	 * 所以只用 :active / :focus-visible）。 */
	.menu-item:active {
		background: var(--gpen-panel-selection);
	}

	/* 齿轮按钮只放图标，用 2.4lh 方形对齐其它菜单项的文字高度。 */
	.menu-settings {
		display: inline-grid;
		place-items: center;
		width: 2.4lh;
		height: 1.9lh;
		padding: 0;
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
		flex: 0 0 auto;
		gap: 0.75ch;
		margin-left: auto;
		padding-right: 2.25lh;
	}

	/* 窄容器：依次让出「装饰性 / 别处也有」的动作，把宽度还给菜单。
	   工作区名只是个标签（没有 onclick）；界面缩放在偏好设置里有同一项。
	   最小化 / 关闭是外壳控件，任何宽度都留在原位。
	   阈值按实测档位定（本行 1ch ≈ 7.4px）：一行菜单的自然宽度 = 8 个菜单 367px
	   + 完整动作组 ≈ 620px（84ch），去掉工作区名后 ≈ 460px（62ch）。 */
	@container (max-width: 84ch) {
		.workspace-switcher {
			display: none;
		}
	}

	@container (max-width: 62ch) {
		.ui-scale {
			display: none;
		}
	}

	/* 最窄一档（≈ iPhone 竖屏）：标签两侧的留白再收一点。实测 360px 容器下
	   可视菜单 5 → 6 个、滚动距离 142 → 91px；8 个菜单仍然要滑才看得全。 */
	@container (max-width: 52ch) {
		.menu-item {
			padding-inline: 0.5ch;
		}
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
