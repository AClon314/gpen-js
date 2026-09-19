<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-redo.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-undo.js';

	// 状态栏 = 撤销/重做入口 + 一行上下文提示 + 右端版本号。
	// 撤销/重做按钮的可用状态由 `historyState` 驱动（历史本身不是响应式的，
	// 见 lib/history.ts 与 docs/stroke.md），键盘快捷键在 GpenWorkspace 里。
	let {
		state = { undoDepth: 0, redoDepth: 0 },
		onUndo,
		onRedo
	}: {
		state?: { undoDepth: number; redoDepth: number };
		onUndo?: () => void;
		onRedo?: () => void;
	} = $props();

	const items = ['平移', '图层：Stroke', '帧：1', '绘画'];
</script>

<div class="blender-panel blender-panel-statusbar" aria-label="状态栏">
	{#if onUndo || onRedo}
		<span class="history" role="group" aria-label="编辑历史">
			<button
				class="gpen-panel-button history-button"
				type="button"
				aria-label="撤销（Ctrl+Z）"
				title="撤销（Ctrl+Z）"
				disabled={state.undoDepth === 0}
				onclick={() => onUndo?.()}
			>
				<sp-icon-undo></sp-icon-undo>
			</button>
			<button
				class="gpen-panel-button history-button"
				type="button"
				aria-label="重做（Ctrl+Shift+Z）"
				title="重做（Ctrl+Shift+Z）"
				disabled={state.redoDepth === 0}
				onclick={() => onRedo?.()}
			>
				<sp-icon-redo></sp-icon-redo>
			</button>
			<span class="history-depth" aria-live="polite">
				{state.undoDepth}
			</span>
		</span>
		<span class="divider" aria-hidden="true"></span>
	{/if}

	{#each items as item, index (item)}
		{#if index > 0}<span class="divider" aria-hidden="true"></span>{/if}
		<span>{item}</span>
	{/each}
	<span class="spacer"></span>
	<span class="version">gpen {__GPEN_VERSION__}</span>
</div>

<style>
	.blender-panel-statusbar {
		font-size: 11px;
		display: flex;
		align-items: center;
		gap: 1.25ch;
		overflow: hidden;
		padding: 0 1.5ch;
		background: var(--gpen-chrome-background);
		color: var(--gpen-panel-muted);
		white-space: nowrap;
	}

	.history {
		display: flex;
		align-items: center;
		gap: 0.25ch;
	}

	.history-button {
		width: 1.9lh;
		height: 1.9lh;
		padding: 0;
		color: inherit;
	}

	.history-button:hover:not(:disabled) {
		color: var(--gpen-panel-foreground);
	}

	.history-button :global(sp-icon-undo),
	.history-button :global(sp-icon-redo) {
		--mod-icon-size: 1.1lh;
	}

	.history-depth {
		min-width: 3ch;
		text-align: center;
		font-variant-numeric: tabular-nums;
		opacity: 0.8;
	}

	.divider {
		width: 1px;
		height: 1.2lh;
		background: var(--gpen-panel-border);
	}

	.spacer {
		flex: 1;
	}

	.version {
		opacity: 0.75;
	}
</style>
