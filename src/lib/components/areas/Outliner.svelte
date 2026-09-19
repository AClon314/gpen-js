<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-layers.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-lock.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-star.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-visibility.js';

	// 图层树的静态占位：真实数据来自 gpen-protocol 的 nodes/layers/groups
	// （见 docs/tree.md）。这里只把行样式、缩进和行内操作按钮的形状定下来。
	interface OutlinerRow {
		id: string;
		name: string;
		kind: 'collection' | 'layer';
		depth: number;
		active?: boolean;
	}

	const rows: OutlinerRow[] = [
		{ id: 'collection', name: 'Collection', kind: 'collection', depth: 0 },
		{ id: 'stroke', name: 'Stroke', kind: 'layer', depth: 1, active: true },
		{ id: 'fills', name: 'Fills', kind: 'layer', depth: 1 },
		{ id: 'lines', name: 'Lines', kind: 'layer', depth: 1 }
	];
</script>

<div class="blender-panel blender-panel-outliner" aria-label="场景集合">
	<ul class="outliner-tree">
		{#each rows as row (row.id)}
			<li
				class="outliner-row"
				class:active={row.active}
				class:collection={row.kind === 'collection'}
				style:padding-left={`calc(${row.depth} * 2ch + 1.25ch)`}
			>
				<span class="disclosure" aria-hidden="true">{row.kind === 'collection' ? '⌄' : ''}</span>
				<span class="row-icon" aria-hidden="true">
					{#if row.kind === 'collection'}
						<sp-icon-layers></sp-icon-layers>
					{:else}
						<span class="layer-dot" class:active={row.active}></span>
					{/if}
				</span>
				<span class="row-name">{row.name}</span>
				<span class="row-actions">
					<button class="gpen-panel-button row-action-button" type="button" aria-label="切换可见性" title="切换可见性">
						<sp-icon-visibility></sp-icon-visibility>
					</button>
					<button class="gpen-panel-button row-action-button" type="button" aria-label="标记收藏" title="标记收藏">
						<sp-icon-star></sp-icon-star>
					</button>
					<button class="gpen-panel-button row-action-button" type="button" aria-label="锁定图层" title="锁定图层">
						<sp-icon-lock></sp-icon-lock>
					</button>
				</span>
			</li>
		{/each}
	</ul>
</div>

<style>
	.blender-panel-outliner {
		overflow: auto;
		padding: 0.6lh 0.75ch 0.75lh;
	}

	.outliner-tree {
		display: flex;
		flex-direction: column;
		gap: 0.15lh;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.outliner-row {
		display: flex;
		align-items: center;
		gap: 0.75ch;
		min-height: 2lh;
		padding-right: 1ch;
		border: 1px solid transparent;
		border-radius: var(--gpen-radius);
		color: var(--gpen-panel-foreground);
	}

	.outliner-row:hover {
		background: var(--gpen-panel-background-hover);
	}

	.outliner-row.collection {
		font-weight: 600;
	}

	.outliner-row.active {
		border-color: color-mix(in srgb, var(--gpen-panel-accent) 45%, transparent);
		background: var(--gpen-panel-selection);
	}

	.disclosure {
		width: 1ch;
		color: var(--gpen-panel-muted);
		font-size: 11px;
		text-align: center;
	}

	.row-icon {
		display: grid;
		place-items: center;
		width: 2ch;
		color: var(--gpen-panel-muted);
	}

	.layer-dot {
		width: 0.7ch;
		height: 0.7ch;
		border-radius: 50%;
		background: var(--gpen-panel-muted);
	}

	.layer-dot.active {
		background: var(--gpen-panel-accent);
	}

	.row-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-actions {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 0.25ch;
		margin-left: auto;
		opacity: 0.65;
	}

	.outliner-row:hover .row-actions,
	.outliner-row.active .row-actions {
		opacity: 1;
	}

	.row-action-button {
		width: 2lh;
		height: 2lh;
		padding: 0;
	}

	.row-action-button:hover:not(:disabled) {
		color: var(--gpen-panel-accent);
	}

</style>
