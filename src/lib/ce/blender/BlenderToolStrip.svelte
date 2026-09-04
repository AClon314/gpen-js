<script lang="ts">
	const tools = ['✎', '⌫', '▱', '⌁', '✣', '⊹', '⌖', '⋯'];
	const labels = ['画笔', '橡皮', '填充', '套索', '选择', '吸管', '变换', '更多工具'];
</script>

<div class="blender-panel blender-panel-tools" aria-label="工具条">
	<div class="tool-buttons">
		{#each tools as tool, index}
			<button type="button" title={labels[index]} aria-label={labels[index]}>{tool}</button>
		{/each}
	</div>
	<span class="tool-caption">tools</span>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: 13px/1.2 system-ui, sans-serif;
	}

	.blender-panel-tools {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		overflow: auto;
		padding: 9px 6px;
		background: #303030;
		color: #eee;
	}

	.tool-buttons {
		display: grid;
		grid-template-columns: minmax(28px, 64px);
		gap: 6px;
		width: 100%;
		max-width: 64px;
	}

	.tool-buttons button {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		min-width: 28px;
		padding: 0;
		border: 1px solid #505050;
		border-radius: 3px;
		background: #424242;
		color: #ddd;
		font-size: 18px;
		cursor: pointer;
	}

	.tool-buttons button:hover,
	.tool-buttons button:focus-visible {
		border-color: #6ea8e8;
		background: #5277a7;
		color: #fff;
		outline: none;
	}

	.tool-caption {
		color: #999;
		font-size: 11px;
		writing-mode: vertical-rl;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	:global(.dockview-container .dv-groupview .blender-panel-tools) {
		min-width: 0;
	}
</style>
