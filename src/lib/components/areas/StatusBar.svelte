<script lang="ts"></script>

<div class="blender-panel blender-panel-statusbar" aria-label="状态栏">
	<span>平移</span><span class="divider">|</span><span>图层：Stroke</span><span class="divider">|</span><span>帧：1</span><span class="divider">|</span><span>绘画</span>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: 11px/1.2 var(--gpen-font-sans);
	}

	.blender-panel-statusbar {
		display: flex;
		align-items: center;
		gap: 1ch;
		overflow: hidden;
		padding: 0 1.5ch;
		background: #1f1f1f;
		color: #aaa;
		white-space: nowrap;
	}

	.divider {
		color: #555;
	}

	:global(.dockview-container .dv-groupview .blender-panel-statusbar) {
		background: #1f1f1f;
	}
</style>
