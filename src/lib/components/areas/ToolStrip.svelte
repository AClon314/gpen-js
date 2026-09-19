<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-color-fill.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-erase.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-eyedropper.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-lasso-select.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-more.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-move.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-selection.js';

	import type { GpenToolId, GpenWorkspaceState } from '../gpenWorkspaceState';

	interface ToolDefinition {
		id: GpenToolId;
		tag: string;
		label: string;
	}

	// 工具图标用 Spectrum workflow 图标：和取色器同一套视觉语言，
	// 比 ✎ / ⌁ / ✣ 这类混排字形稳定得多（都是 24 格线性图，同一粗细）。
	let {
		state,
		onSelectTool
	}: {
		state: GpenWorkspaceState;
		onSelectTool: (tool: GpenToolId) => void;
	} = $props();

	const tools: ToolDefinition[] = [
		{ id: 'brush', tag: 'sp-icon-brush', label: '画笔' },
		{ id: 'eraser', tag: 'sp-icon-erase', label: '橡皮' },
		{ id: 'fill', tag: 'sp-icon-color-fill', label: '填充' },
		{ id: 'lasso', tag: 'sp-icon-lasso-select', label: '套索' },
		{ id: 'select', tag: 'sp-icon-selection', label: '选择' },
		{ id: 'picker', tag: 'sp-icon-eyedropper', label: '吸管' },
		{ id: 'transform', tag: 'sp-icon-move', label: '变换' },
		{ id: 'more', tag: 'sp-icon-more', label: '更多工具' }
	];
</script>

<div class="blender-panel blender-panel-tools" aria-label="工具条">
	<div class="tool-buttons" role="toolbar" aria-orientation="vertical" aria-label="绘图工具">
		{#each tools as tool (tool.id)}
			<button
				class:selected={state.activeTool === tool.id}
				type="button"
				title={tool.label}
				aria-label={tool.label}
				aria-pressed={state.activeTool === tool.id}
				onclick={() => onSelectTool(tool.id)}
			>
				<svelte:element this={tool.tag} />
			</button>
		{/each}
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

	.blender-panel-tools {
		display: flex;
		flex-direction: column;
		align-items: center;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0.6lh 0;
		background: var(--gpen-chrome-background-subtle);
	}

	.tool-buttons {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4lh;
	}

	.tool-buttons button {
		display: grid;
		place-items: center;
		width: 2.4lh;
		height: 2.4lh;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--gpen-radius);
		background: transparent;
		color: var(--gpen-panel-muted);
		cursor: pointer;
	}

	.tool-buttons button:hover {
		background: var(--gpen-panel-background-hover);
		color: var(--gpen-panel-foreground);
	}

	.tool-buttons button.selected {
		border-color: var(--gpen-panel-accent);
		background: var(--gpen-panel-selection);
		color: var(--gpen-panel-accent);
	}

	.tool-buttons button:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 1px;
	}

	.blender-panel-tools :global(sp-icon-brush),
	.blender-panel-tools :global(sp-icon-erase),
	.blender-panel-tools :global(sp-icon-color-fill),
	.blender-panel-tools :global(sp-icon-lasso-select),
	.blender-panel-tools :global(sp-icon-selection),
	.blender-panel-tools :global(sp-icon-eyedropper),
	.blender-panel-tools :global(sp-icon-move),
	.blender-panel-tools :global(sp-icon-more) {
		--mod-icon-size: 1.5lh;
		color: inherit;
	}

	:global(.dockview-container .dv-groupview .blender-panel-tools) {
		min-width: 0;
	}
</style>
