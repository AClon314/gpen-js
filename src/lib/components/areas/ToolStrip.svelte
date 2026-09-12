<script lang="ts">
	import type { GpenToolId, GpenWorkspaceState } from '../gpenWorkspaceState';

	interface ToolDefinition {
		id: GpenToolId;
		icon: string;
		label: string;
	}

	let {
		state,
		onSelectTool
	}: {
		state: GpenWorkspaceState;
		onSelectTool: (tool: GpenToolId) => void;
	} = $props();

	const tools: ToolDefinition[] = [
		{ id: 'brush', icon: '✎', label: '画笔' },
		{ id: 'eraser', icon: '⌫', label: '橡皮' },
		{ id: 'fill', icon: '▱', label: '填充' },
		{ id: 'lasso', icon: '⌁', label: '套索' },
		{ id: 'select', icon: '✣', label: '选择' },
		{ id: 'picker', icon: '⊹', label: '吸管' },
		{ id: 'transform', icon: '⌖', label: '变换' },
		{ id: 'more', icon: '⋯', label: '更多工具' },
		{ id: 'mouse', icon: '↖', label: '[鼠标]' },
	];
</script>

<div class="blender-panel blender-panel-tools" aria-label="工具条">
	<div class="tool-buttons">
		{#each tools as tool (tool.id)}
			<button
				class:selected={state.activeTool === tool.id}
				type="button"
				title={tool.label}
				aria-label={tool.label}
				aria-pressed={state.activeTool === tool.id}
				onclick={() => onSelectTool(tool.id)}
			>{tool.icon}</button>
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
		font: 13px/1.2 var(--gpen-font-sans);
	}

	.blender-panel-tools {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75lh;
		overflow: auto;
		padding: 0.6lh 1ch;
		background: #303030;
		color: #eee;
	}

	.tool-buttons {
		display: grid;
		grid-template-columns: minmax(4.5ch, 10ch);
		gap: 0.5lh;
		width: 100%;
		max-width: 10ch;
	}

	.tool-buttons button {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		min-width: 4.5ch;
		padding: 0;
		border: 1px solid #505050;
		border-radius: 3px;
		background: #424242;
		color: #ddd;
		font-size: 18px;
		cursor: pointer;
	}

	.tool-buttons button:hover,
	.tool-buttons button:focus-visible,
	.tool-buttons button.selected {
		border-color: #6ea8e8;
		background: #5277a7;
		color: #fff;
		outline: none;
	}

	.tool-buttons button.selected {
		box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.22), 0 0 0 1px #9bc6f4;
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
