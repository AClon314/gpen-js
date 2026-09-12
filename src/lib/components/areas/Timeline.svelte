<script lang="ts">
	const frames = [1, 24, 48, 72, 96, 120, 144, 192, 216];
</script>

<div class="blender-panel blender-panel-timeline" aria-label="时间轴和图层">
	<div class="timeline-toolbar"><span class="editor-label">时间轴</span><span>视图</span><span>选择</span><span>标记</span><span class="toolbar-spacer"></span><span>▣</span><span>⚙</span></div>
	<div class="timeline-main">
		<div class="layer-list">
			<div class="layer-summary">⌄ 汇总</div>
			<div class="layer-row active"><span>⌄</span><strong>● Stroke</strong></div>
			<div class="layer-row"><span></span><span>Lines</span><em>1.00</em></div>
			<div class="layer-row"><span></span><span>Fills</span><em>1.00</em></div>
		</div>
		<div class="frame-area">
			<div class="frame-ruler">
				{#each frames as frame}
					<span>{frame}</span>
				{/each}
			</div>
			<div class="frame-grid"><span class="playhead"></span><span class="keyframe"></span></div>
		</div>
	</div>
	<div class="timeline-footer"><span>▶ 播放</span><span>◆ 插帧</span><span class="footer-spacer"></span><span>帧：1 / 250</span></div>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: 12px/1.2 var(--gpen-font-sans);
	}

	.blender-panel-timeline {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: #262626;
		color: #cfcfcf;
	}

	.timeline-toolbar,
	.timeline-footer {
		display: flex;
		align-items: center;
		gap: 2.5ch;
		min-height: 1.75lh;
		padding: 0 1.4ch;
		background: #303030;
		color: #bdbdbd;
	}

	.editor-label {
		color: #f2f2f2;
		font-weight: 600;
	}

	.toolbar-spacer,
	.footer-spacer {
		flex: 1;
	}

	.timeline-main {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.layer-list {
		width: clamp(24ch, 24%, 45ch);
		flex: 0 0 auto;
		border-right: 1px solid #444;
		background: #292929;
	}

	.layer-summary,
	.layer-row {
		display: flex;
		align-items: center;
		gap: 1.25ch;
		min-height: 1.5lh;
		padding: 0 1.5ch;
	}

	.layer-summary {
		background: #3b2c2d;
		color: #f0b2b2;
	}

	.layer-row.active {
		background: #27496d;
		color: #f0c35e;
	}

	.layer-row em {
		margin-left: auto;
		color: #bdbdbd;
		font-style: normal;
	}

	.frame-area {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.frame-ruler {
		display: flex;
		justify-content: space-around;
		min-height: 1.5lh;
		border-bottom: 1px solid #444;
		color: #999;
		font-variant-numeric: tabular-nums;
	}

	.frame-ruler span {
		padding-top: 0.5lh;
	}

	.frame-grid {
		position: relative;
		height: calc(100% - 1.5lh);
		background: repeating-linear-gradient(90deg, transparent 0 47px, rgb(255 255 255 / 0.07) 48px 49px), repeating-linear-gradient(0deg, transparent 0 24px, rgb(255 255 255 / 0.05) 25px 26px);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 4%;
		width: 0.25ch;
		background: #5ca9ef;
	}

	.keyframe {
		position: absolute;
		left: calc(4% - 0.75ch);
		top: 1lh;
		width: 1.5ch;
		height: 0.5lh;
		transform: rotate(45deg);
		background: #f1bf50;
	}

	:global(.dockview-container .dv-groupview .blender-panel-timeline) {
		background: #262626;
	}
</style>
