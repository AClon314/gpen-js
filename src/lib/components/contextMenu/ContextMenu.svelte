<script lang="ts">
	import { tick } from 'svelte';
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
		resolveMenuDisabled,
		resolveMenuLabel,
		visibleMenuItems,
		type MenuNavigationKey
	} from './menuModel.ts';

	const MENU_MARGIN_PX = 8;

	let root = $state<HTMLDivElement | undefined>(undefined);
	/** 当前"高亮路径"：祖先链上的下标。子菜单是否展开由它决定。 */
	let activePath = $state<number[]>([]);

	const items = $derived(visibleMenuItems(menuState.items));

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
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			if (hasChildren) focusFirstChild(path, renderChildren(item));
			else run(item);
			return;
		}

		if (
			event.key === 'ArrowDown' ||
			event.key === 'ArrowUp' ||
			event.key === 'Home' ||
			event.key === 'End'
		) {
			event.preventDefault();
			const siblings = siblingsOf(path.slice(0, -1));
			const current = path[path.length - 1] ?? -1;
			const next = nextMenuIndex(siblings, current, event.key as MenuNavigationKey);
			if (next >= 0) focusPath([...path.slice(0, -1), next]);
			return;
		}

		if (event.key === 'ArrowRight' && hasChildren) {
			event.preventDefault();
			focusFirstChild(path, renderChildren(item));
			return;
		}

		if (event.key === 'ArrowLeft' && path.length > 1) {
			event.preventDefault();
			focusPath(path.slice(0, -1));
		}
	}

	function handleRootKeydown(event: KeyboardEvent): void {
		// Item keydown bubbles here; the root only owns the keys when it (not an
		// item) is the focused element.
		if (event.target !== root) return;
		if (
			event.key !== 'ArrowDown' &&
			event.key !== 'ArrowUp' &&
			event.key !== 'Home' &&
			event.key !== 'End'
		)
			return;
		event.preventDefault();
		const next = nextMenuIndex(items, -1, event.key);
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
			clampMenuPosition(menu.offsetWidth, menu.offsetHeight);
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
				clampMenuPosition(menu.offsetWidth, menu.offsetHeight);
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
			for (const submenu of menu.querySelectorAll<HTMLElement>('[data-menu-submenu]')) {
				submenu.style.removeProperty('left');
				submenu.style.removeProperty('right');
				submenu.style.removeProperty('top');
				submenu.style.removeProperty('bottom');
				const rect = submenu.getBoundingClientRect();
				if (rect.right > window.innerWidth - MENU_MARGIN_PX) {
					submenu.style.left = 'auto';
					submenu.style.right = '100%';
				}
				if (rect.bottom > window.innerHeight - MENU_MARGIN_PX) {
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
			{@const keyBind = formatKeyBind(item.keyBind)}
			<!-- 子菜单是 menuitem 的**兄弟**而不是子孙：否则父项的 accessible name
			     会把整棵子菜单的文字都吞进去（a11y 与测试定位都会被污染）。 -->
			<div class="contextMenu-row">
				<div
					role="menuitem"
					class="contextMenu-item"
					class:has-submenu={hasChildren}
					data-menu-path={pathKey(itemPath)}
					aria-disabled={disabled}
					aria-haspopup={hasChildren ? 'menu' : undefined}
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
	<div
		bind:this={root}
		data-context-menu-root
		class="contextMenu"
		role="menu"
		aria-label="上下文菜单"
		tabindex="-1"
		style:left={`${menuState.x}px`}
		style:top={`${menuState.y}px`}
		oncontextmenu={preventContextMenu}
		onkeydown={handleRootKeydown}
	>
		{@render menuList(items, [])}
	</div>
{/if}

<style>
	.contextMenu {
		position: fixed;
		z-index: 2147483500;
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
