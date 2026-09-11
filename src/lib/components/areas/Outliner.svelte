<script lang="ts"></script>

<div class="blender-panel blender-panel-outliner" aria-label="Outliner">
	<div class="panel-heading"><span>场景集合</span><span class="heading-actions">⋯</span></div>
	<div class="collection-row"><span class="disclosure">⌄</span><span class="collection-icon">▰</span><span>Collection</span></div>
	<div class="scene-row"><span class="scene-icon">◈</span><span>Stroke</span><span class="row-meta">◉ ◉</span></div>
	<p class="placeholder-note">Collection 列表占位</p>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: 13px/1.35 system-ui, sans-serif;
	}

	.blender-panel-outliner {
		overflow: auto;
		padding: 8px;
		background: #292929;
		color: #e5e5e5;
	}

	.panel-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
		padding: 4px 5px;
		border-bottom: 1px solid #444;
		color: #f0f0f0;
		font-weight: 600;
	}

	.heading-actions {
		color: #999;
		font-size: 16px;
	}

	.collection-row,
	.scene-row {
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 26px;
		padding: 0 6px;
		border-radius: 3px;
	}

	.collection-row {
		background: #3d3d3d;
	}

	.scene-row {
		margin-left: 22px;
		color: #f3b35c;
	}

	.disclosure,
	.collection-icon {
		color: #bdbdbd;
	}

	.scene-icon {
		color: #ef786f;
	}

	.row-meta {
		margin-left: auto;
		color: #aaa;
		font-size: 11px;
	}

	.placeholder-note {
		margin: 14px 5px 0;
		color: #929292;
		font-size: 11px;
	}

	:global(.dockview-container .dv-groupview .blender-panel-outliner) {
		background: #292929;
	}
</style>
