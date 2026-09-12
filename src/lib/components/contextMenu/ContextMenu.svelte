<script lang="ts">
	import { tick } from 'svelte';
	import {
		clampMenuPosition,
		close,
		menuState,
		type MenuItem
	} from './contextMenu.svelte.ts';

	function resolveLabel(item: MenuItem): string {
		const label = item.label;
		return typeof label === 'function' ? label() : (label ?? '');
	}

	function resolveDisabled(item: MenuItem): boolean {
		const disabled = item.disabled;
		return typeof disabled === 'function' ? disabled() : (disabled ?? false);
	}

	function run(item: MenuItem) {
		if (resolveDisabled(item)) return;
		close();
		item.action?.();
	}

	function handleItemKeydown(event: KeyboardEvent, item: MenuItem) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		run(item);
	}

	function preventContextMenu(event: MouseEvent) {
		event.preventDefault();
	}

	let root = $state<HTMLDivElement | undefined>(undefined);

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
			const firstEnabled = menu.querySelector<HTMLElement>(
				'.contextMenu-item:not([aria-disabled="true"])'
			);
			firstEnabled?.focus();
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
</script>

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
	>
		{#each menuState.items as item, index (index)}
			{#if item.separator}
				<hr class="contextMenu-separator" />
			{:else}
				{@const disabled = resolveDisabled(item)}
				<div
					role="menuitem"
					class="contextMenu-item"
					aria-disabled={disabled}
					tabindex={disabled ? -1 : 0}
					onclick={() => run(item)}
					onkeydown={(event) => handleItemKeydown(event, item)}
				>
					{resolveLabel(item)}
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.contextMenu {
		position: fixed;
		z-index: 2147483500;
		box-sizing: border-box;
		min-width: 20ch;
		padding: 0.35lh 0.35ch;
		border: 1px solid #b9c3d0;
		border-radius: 0.35lh;
		background: #fff;
		box-shadow: 0 0.75lh 2lh rgb(15 23 42 / 0.22);
		color: #1e293b;
		font: inherit;
		line-height: 1.35;
		user-select: none;
	}

	.contextMenu-item {
		all: unset;
		display: block;
		box-sizing: border-box;
		width: 100%;
		min-height: 2lh;
		padding: 0.35lh 0.75ch;
		border-radius: 0.2lh;
		color: inherit;
		font: inherit;
		line-height: 1.35;
		text-align: start;
		white-space: nowrap;
		cursor: pointer;
	}

	.contextMenu-item:hover,
	.contextMenu-item:focus-visible {
		background: #e9eef5;
		outline: none;
	}

	.contextMenu-item[aria-disabled='true'] {
		color: #94a3b8;
		cursor: default;
	}

	.contextMenu-separator {
		height: 1px;
		margin: 0.35lh 0.2ch;
		border: 0;
		background: #d7dde6;
	}
</style>
