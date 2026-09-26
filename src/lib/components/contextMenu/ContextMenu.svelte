<script lang="ts">
	import { tick } from 'svelte';
	import { executeCommand } from '#lib/commands/commands';
	import { preferences } from '../gpenPreferencesState.svelte';
	import {
		clampMenuPosition,
		close,
		menuState,
		type MenuItem
	} from './contextMenu.svelte.ts';
	import {
		formatKeyBind,
		isMenuSeparator,
		nextMenuIndex,
		resolveMenuChildren,
		resolveMenuKeyBind,
		resolveMenuDisabled,
		resolveMenuLabel,
		visibleMenuItems,
		type MenuNavigationKey
	} from './menuModel.ts';
	import { menuItemKeyIntent, menuNavigationKey, type MenuKeyIntent } from './menuKeyboard.ts';
	import { submenuFlip } from './menuPosition.ts';

	let root = $state<HTMLDivElement | undefined>(undefined);
	/** 当前"高亮路径"：祖先链上的下标。子菜单是否展开由它决定。 */
	let activePath = $state<number[]>([]);

	const items = $derived(visibleMenuItems(menuState.items));
	/** 磨砂玻璃（见 themes/blur.css）：菜单在工作区子树之外，所以自己带 class。 */
	const blurred = $derived(preferences().blur);

	function pathKey(path: readonly number[]): string {
		return path.join('.');
	}

	function renderChildren(item: MenuItem): MenuItem[] {
		return visibleMenuItems(resolveMenuChildren(item));
	}

	function isOnActivePath(path: readonly number[]): boolean {
		if (activePath.length <= path.length) return false;
		return path.every((value, index) => activePath[index] === value);
	}

	/** 兄弟列表：根节点是 `items`，其余按活动路径逐层下钻（只有展开的才在 DOM 里）。 */
	function siblingsOf(path: readonly number[]): MenuItem[] {
		if (path.length === 0) return items;
		let list: MenuItem[] = items;
		let item: MenuItem | undefined;
		for (const index of path) {
			item = list[index];
			if (!item) return [];
			list = renderChildren(item);
		}
		// 走完路径后 item 是父节点，list 是它的可见子节点。
		return item ? list : [];
	}

	function focusPath(path: readonly number[]): void {
		activePath = [...path];
		const element = root?.querySelector<HTMLElement>(`[data-menu-path="${pathKey(path)}"]`);
		element?.focus();
	}

	function focusFirstChild(path: readonly number[], children: MenuItem[]): void {
		const index = nextMenuIndex(children, -1, 'Home');
		if (index < 0) return;
		const target = [...path, index];
		// Set the path first so the submenu renders, then move DOM focus into it.
		activePath = target;
		void tick().then(() => {
			if (root) focusPath(target);
		});
	}

	function run(item: MenuItem): void {
		if (resolveMenuDisabled(item)) return;
		close();
		// 命令与菜单分家：节点要么引用命令 id（走注册表，`when`/`enabled` 已在
		// `resolveMenuDisabled` 里合并过），要么自带 action。两者都没有就是空项。
		if (item.command !== undefined) {
			executeCommand(item.command);
			return;
		}
		item.action?.();
	}

	function handleItemClick(event: MouseEvent, item: MenuItem, path: readonly number[]): void {
		if (event.button !== 0) return;
		const children = renderChildren(item);
		if (children.length > 0) {
			if (!isOnActivePath(path)) focusFirstChild(path, children);
			return;
		}
		run(item);
	}

	function handleItemHover(path: readonly number[], children: MenuItem[]): void {
		if (children.length > 0) {
			// Hovering a parent opens its submenu (point the active path at the
			// first child) without stealing DOM focus.
			const index = nextMenuIndex(children, -1, 'Home');
			if (index >= 0 && !isOnActivePath(path)) activePath = [...path, index];
			return;
		}
		// 悬停到更深一层的叶子时保持其祖先子菜单展开；悬停到别处则收起。
		if (activePath.length > path.length) activePath = [...path];
	}

	function handleItemKeydown(
		event: KeyboardEvent,
		item: MenuItem,
		path: readonly number[],
		hasChildren: boolean
	): void {
		const intent = menuItemKeyIntent(event.key, hasChildren, path.length);
		if (intent === undefined) return;
		event.preventDefault();
		runMenuKeyIntent(intent, item, path);
	}

	/** 执行键盘意图：组件只保留 DOM 焦点移动，索引计算都在纯函数里。 */
	function runMenuKeyIntent(intent: MenuKeyIntent, item: MenuItem, path: readonly number[]): void {
		if (intent.kind === 'move') {
			moveToSibling(path, intent.key);
			return;
		}
		if (intent.kind === 'leave') {
			focusPath(path.slice(0, -1));
			return;
		}
		// activate / enter 都先进入子菜单；activate 在没有子菜单时才执行命令。
		const children = renderChildren(item);
		if (intent.kind === 'enter' || children.length > 0) {
			focusFirstChild(path, children);
			return;
		}
		run(item);
	}

	/** 上下 / Home / End：在同一层兄弟里移动焦点。 */
	function moveToSibling(path: readonly number[], key: MenuNavigationKey): void {
		const parent = path.slice(0, -1);
		const next = nextMenuIndex(siblingsOf(parent), path[path.length - 1] ?? -1, key);
		if (next >= 0) focusPath([...parent, next]);
	}

	function handleRootKeydown(event: KeyboardEvent): void {
		// Item keydown bubbles here; the root only owns the keys when it (not an
		// item) is the focused element.
		if (event.target !== root) return;
		const key = menuNavigationKey(event.key);
		if (key === undefined) return;
		event.preventDefault();
		const next = nextMenuIndex(items, -1, key);
		if (next >= 0) focusPath([next]);
	}

	function preventContextMenu(event: MouseEvent) {
		event.preventDefault();
	}

	// The root is created after open() changes the state. Wait for its first
	// layout before clamping and focusing, so programmatic and native opens use
	// exactly the same positioning and focus path.
	$effect(() => {
		const menu = root;
		const visible = menuState.visible;
		const openVersion = menuState.openVersion;
		if (!menu || !visible) return;

		void tick().then(() => {
			if (!menuState.visible || menuState.openVersion !== openVersion || root !== menu) return;
			// 量**视觉**尺寸：菜单吃 `zoom`，`offsetWidth` 是局部 px（zoom=2 时只有一半），
			// 拿它夹取会让菜单挂到视口外面。
			const rect = menu.getBoundingClientRect();
			clampMenuPosition(rect.width, rect.height);
			const first = nextMenuIndex(items, -1, 'Home');
			if (first >= 0) focusPath([first]);
			else menu.focus();
		});
	});

	// Getter-based labels can change the menu's width while it is open. Keep the
	// edge clamp valid without making the registry itself reactive.
	$effect(() => {
		const menu = root;
		if (!menu || typeof ResizeObserver === 'undefined') return;

		const observer = new ResizeObserver(() => {
			if (menuState.visible && root === menu) {
				const rect = menu.getBoundingClientRect();
				clampMenuPosition(rect.width, rect.height);
			}
		});
		observer.observe(menu);
		return () => observer.disconnect();
	});

	// Submenus are positioned by CSS; flip them back inside the viewport once
	// their real size is known (the active path is the only thing that changes
	// which submenus exist).
	$effect(() => {
		const menu = root;
		const path = activePath;
		if (!menu) return;

		void tick().then(() => {
			if (root !== menu) return;
			const viewport = { width: window.innerWidth, height: window.innerHeight };
			for (const submenu of menu.querySelectorAll<HTMLElement>('[data-menu-submenu]')) {
				submenu.style.removeProperty('left');
				submenu.style.removeProperty('right');
				submenu.style.removeProperty('top');
				submenu.style.removeProperty('bottom');
				const flip = submenuFlip(submenu.getBoundingClientRect(), viewport);
				if (flip.horizontal) {
					submenu.style.left = 'auto';
					submenu.style.right = '100%';
				}
				if (flip.vertical) {
					submenu.style.top = 'auto';
					submenu.style.bottom = '-0.35lh';
				}
			}
			void path;
		});
	});
</script>

{#snippet menuList(list: MenuItem[], path: number[])}
	{#each list as item, index (index)}
		{@const itemPath = [...path, index]}
		{#if isMenuSeparator(item)}
			<hr class="contextMenu-separator" />
		{:else}
			{@const disabled = resolveMenuDisabled(item)}
			{@const children = renderChildren(item)}
			{@const hasChildren = children.length > 0}
			{@const keyBind = formatKeyBind(resolveMenuKeyBind(item))}
			{@const title = typeof item.title === 'string' ? item.title : undefined}
			<!-- 子菜单是 menuitem 的**兄弟**而不是子孙：否则父项的 accessible name
			     会把整棵子菜单的文字都吞进去（a11y 与测试定位都会被污染）。
			     灰掉的项靠 `title` 说明原因（handoff：不许留“点了没反应”）。 -->
			<div class="contextMenu-row">
				<div
					role="menuitem"
					class="contextMenu-item"
					class:has-submenu={hasChildren}
					data-menu-path={pathKey(itemPath)}
					aria-disabled={disabled}
					aria-haspopup={hasChildren ? 'menu' : undefined}
					title={title}
					tabindex={disabled ? -1 : 0}
					onclick={(event) => handleItemClick(event, item, itemPath)}
					onmouseenter={() => handleItemHover(itemPath, children)}
					onkeydown={(event) => handleItemKeydown(event, item, itemPath, hasChildren)}
				>
					<span class="contextMenu-label">{resolveMenuLabel(item)}</span>
					{#if keyBind}<kbd class="contextMenu-keybind">{keyBind}</kbd>{/if}
					{#if hasChildren}<span class="contextMenu-chevron" aria-hidden="true">›</span>{/if}
				</div>
				{#if hasChildren && isOnActivePath(itemPath)}
					<div class="contextMenu-submenu" data-menu-submenu>
						{@render menuList(children, itemPath)}
					</div>
				{/if}
			</div>
		{/if}
	{/each}
{/snippet}

{#if menuState.visible}
	<!-- 定位壳：`position: fixed` + 原始 client 坐标，**不吃 zoom**。
	     `zoom` 会把它自己声明的 left/top 一起放大，所以坐标与缩放必须分在两层
	     （见 workspaceZoom.ts 的实测）。z-index 也留在壳上。 -->
	<div class="contextMenu-anchor" style:left={`${menuState.x}px`} style:top={`${menuState.y}px`}>
		<div
			bind:this={root}
			data-context-menu-root
			class="contextMenu"
			class:gpen-blur={blurred}
			role="menu"
			aria-label="上下文菜单"
			tabindex="-1"
			oncontextmenu={preventContextMenu}
			onkeydown={handleRootKeydown}
		>
			{@render menuList(items, [])}
		</div>
	</div>
{/if}

<style>
	.contextMenu-anchor {
		/* 只负责定位：fixed + 原始 client 坐标，z-index 高于工作区 overlay。 */
		position: fixed;
		z-index: 2147483500;
	}

	.contextMenu {
		/* 跟工作区 chrome 同一套缩放（uiScale / 抵消 pinch）：变量由 GpenWorkspace 写在
		 * 根元素上；工作区没开时回落到 1（见 components/workspaceZoom.ts）。 */
		zoom: var(--gpen-workspace-zoom, 1);
		box-sizing: border-box;
		min-width: 20ch;
		padding: 0.35lh 0.35ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.35lh;
		background: var(--gpen-panel-background);
		box-shadow: var(--gpen-panel-shadow);
		color: var(--gpen-panel-foreground);
		font: var(--gpen-font-size) / var(--gpen-line-height) var(--gpen-font-sans);
		user-select: none;
	}

	.contextMenu-row {
		position: relative;
	}

	.contextMenu-item {
		all: unset;
		display: flex;
		align-items: center;
		gap: 1.5ch;
		box-sizing: border-box;
		width: 100%;
		min-height: 2lh;
		padding: 0.35lh 0.75ch;
		border-radius: 0.2lh;
		color: inherit;
		font: inherit;
		line-height: var(--gpen-line-height);
		text-align: start;
		white-space: nowrap;
		cursor: pointer;
	}

	.contextMenu-item:hover,
	.contextMenu-item:focus-visible {
		background: var(--gpen-panel-background-hover);
		outline: none;
	}

	.contextMenu-item[aria-disabled='true'] {
		color: var(--gpen-panel-muted);
		cursor: default;
	}

	.contextMenu-label {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.contextMenu-keybind {
		flex: 0 0 auto;
		color: var(--gpen-panel-muted);
		font: var(--gpen-font-size) / var(--gpen-line-height) var(--gpen-font-mono);
	}

	.contextMenu-chevron {
		flex: 0 0 auto;
		color: var(--gpen-panel-muted);
	}

	.contextMenu-submenu {
		position: absolute;
		top: -0.35lh;
		left: 100%;
		box-sizing: border-box;
		min-width: 20ch;
		padding: 0.35lh 0.35ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.35lh;
		background: var(--gpen-panel-background);
		box-shadow: var(--gpen-panel-shadow);
		color: var(--gpen-panel-foreground);
	}

	.contextMenu-separator {
		height: 1px;
		margin: 0.35lh 0.2ch;
		border: 0;
		background: var(--gpen-panel-border);
	}
</style>
