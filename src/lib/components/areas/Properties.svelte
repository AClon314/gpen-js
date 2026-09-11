<script lang="ts"></script>

<div class="blender-panel blender-panel-properties" aria-label="属性">
	<div class="properties-heading"><span class="properties-icon">⚙</span><span>属性 / 画笔</span></div>
	<section class="property-card">
		<h2>笔刷设置</h2>
		<div class="property-row"><span>半径</span><strong>0.15 m</strong></div>
		<div class="property-row"><span>强度</span><strong>0.400</strong></div>
	</section>
	<section class="property-card collapsed"><h2>颜色</h2><span>›</span></section>
	<p class="placeholder-note">属性面板占位</p>
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

	.blender-panel-properties {
		overflow: auto;
		padding: 9px;
		background: #292929;
		color: #e5e5e5;
	}

	.properties-heading {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
		color: #ededed;
		font-weight: 600;
	}

	.properties-icon {
		color: #77b7ed;
		font-size: 17px;
	}

	.property-card {
		margin-bottom: 7px;
		padding: 8px;
		border: 1px solid #444;
		border-radius: 3px;
		background: #343434;
	}

	.property-card h2 {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 600;
	}

	.property-row {
		display: flex;
		justify-content: space-between;
		padding: 4px 0;
		border-top: 1px solid #444;
		color: #b9b9b9;
	}

	.property-row strong {
		color: #f0f0f0;
		font-weight: 500;
	}

	.property-card.collapsed {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 9px 8px;
	}

	.property-card.collapsed h2 {
		margin: 0;
	}

	.placeholder-note {
		margin: 12px 2px;
		color: #929292;
		font-size: 11px;
	}

	:global(.dockview-container .dv-groupview .blender-panel-properties) {
		background: #292929;
	}
</style>
