<script lang="ts">
	// 状态栏 = 一行提示 + 右端版本号。所有项都是只读文本（真正的快捷键提示以后
	// 由工具上下文推导），所以这里不需要任何交互元素。
	const items = ['平移', '图层：Stroke', '帧：1', '绘画'];
</script>

<div class="blender-panel blender-panel-statusbar" aria-label="状态栏">
	{#each items as item, index (item)}
		{#if index > 0}<span class="divider" aria-hidden="true"></span>{/if}
		<span>{item}</span>
	{/each}
	<span class="spacer"></span>
	<span class="version">gpen {__GPEN_VERSION__}</span>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: 11px/var(--gpen-line-height) var(--gpen-font-sans);
	}

	.blender-panel-statusbar {
		display: flex;
		align-items: center;
		gap: 1.25ch;
		overflow: hidden;
		padding: 0 1.5ch;
		background: var(--gpen-chrome-background);
		color: var(--gpen-panel-muted);
		white-space: nowrap;
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
