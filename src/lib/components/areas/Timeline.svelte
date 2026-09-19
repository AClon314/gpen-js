<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-fast-forward.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-play.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-rewind.js';

	// 静态占位的时间轴：帧列宽固定（`--frame-width`），标尺、关键帧、播放头都按同一个
	// 宽度换算位置，所以缩放面板宽度时三者不会错位。
	const COLUMN_FRAMES = 12; // 每 COLUMN_FRAMES 帧标一个数字（CSS 侧用 --frames-per-tick 对齐）
	const COLUMN_COUNT = 8; // 标尺上画多少列
	const frames = Array.from({ length: COLUMN_COUNT }, (_, index) => index * COLUMN_FRAMES + 1);

	const firstFrame = 1;
	const lastFrame = 250;
	const currentFrame = 24;
	const fps = 24;

	const layers = [
		{ id: 'summary', name: '汇总', active: false, summary: true, weight: '' },
		{ id: 'stroke', name: 'Stroke', active: true, weight: '1.00' },
		{ id: 'fills', name: 'Fills', active: false, weight: '1.00' }
		// 行高固定 2lh，和右侧帧网格逐行对齐；默认面板高度按 3 行算，
		// 再多就要滚动（layer-list 已设 overflow-y: auto）。
	];

	// 关键帧按帧号放，左侧偏移用帧号换算，确保和标尺同一坐标系。
	const keyframes = [1, 25, 73, 121];
	const playheadFrame = currentFrame;
</script>

<div
	class="blender-panel blender-panel-timeline"
	aria-label="时间轴和图层"
	style:--frames-per-tick={COLUMN_FRAMES}
>
	<div class="timeline-toolbar">
		<span class="editor-chip">时间轴</span>
		<button class="gpen-panel-button" type="button">视图</button>
		<button class="gpen-panel-button" type="button">选择</button>
		<button class="gpen-panel-button" type="button">标记</button>
		<span class="spacer"></span>
		<span class="frame-readout">帧 {currentFrame} / {lastFrame}</span>
		<span class="frame-readout">{fps} fps</span>
	</div>

	<div class="timeline-main">
		<div class="layer-list">
			<!-- 和标尺等高的一行：让图层行与右侧的帧行一一对齐（两边都是 2lh）。 -->
			<div class="layer-head">图层</div>
			{#each layers as layer (layer.id)}
				<div class="layer-row" class:active={layer.active} class:summary={layer.summary}>
					<span class="layer-name">{layer.name}</span>
					{#if layer.weight}<em>{layer.weight}</em>{/if}
				</div>
			{/each}
		</div>

		<div class="frame-area">
			<div class="frame-ruler">
				{#each frames as frame}
					<span class="frame-tick">{frame}</span>
				{/each}
			</div>
			<div class="frame-grid">
				{#each keyframes as frame (frame)}
					<span class="keyframe" style:left={`calc((${frame - firstFrame}) * var(--frame-width))`}></span>
				{/each}
				<span
					class="playhead"
					style:left={`calc((${playheadFrame - firstFrame}) * var(--frame-width))`}
				></span>
			</div>
		</div>
	</div>

	<div class="timeline-footer">
		<span class="transport" role="group" aria-label="播放控制">
			<button class="gpen-panel-button transport-button" type="button" aria-label="回到起点">
				<sp-icon-rewind></sp-icon-rewind>
			</button>
			<button class="gpen-panel-button transport-button" type="button" aria-label="播放">
				<sp-icon-play></sp-icon-play>
			</button>
			<button class="gpen-panel-button transport-button" type="button" aria-label="到结尾">
				<sp-icon-fast-forward></sp-icon-fast-forward>
			</button>
		</span>
		<button class="gpen-panel-button keyframe-button" type="button">◆ 插入关键帧</button>
	</div>
</div>

<style>
	.blender-panel-timeline {
		/* 帧列宽：标尺、网格、关键帧、播放头全部按它换算。 */
		--frame-width: 3.5ch;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.timeline-toolbar,
	.timeline-footer {
		display: flex;
		align-items: center;
		gap: 0.5ch;
		min-height: 2.2lh;
		padding: 0 1ch;
		background: var(--gpen-chrome-background-subtle);
	}

	.timeline-toolbar {
		border-bottom: 1px solid var(--gpen-panel-border);
	}

	.timeline-footer {
		border-top: 1px solid var(--gpen-panel-border);
	}

	.timeline-toolbar button,
	.timeline-footer button {
		height: 1.8lh;
		color: var(--gpen-panel-muted);
	}

	.transport-button {
		width: 2.2lh;
		padding: 0;
	}

	.editor-chip {
		padding: 0 1ch;
		font-weight: 600;
		color: var(--gpen-panel-accent);
	}

	.spacer {
		flex: 1;
	}

	.frame-readout {
		padding: 0 0.75ch;
		color: var(--gpen-panel-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}

	.timeline-main {
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.layer-list {
		width: clamp(18ch, 22%, 32ch);
		flex: 0 0 auto;
		overflow-y: auto;
		border-right: 1px solid var(--gpen-panel-border);
		background: var(--gpen-panel-background);
	}

	.layer-row {
		display: flex;
		align-items: center;
		gap: 1ch;
		min-height: 2lh;
		padding: 0 1.25ch;
		border-left: 2px solid transparent;
	}

	.layer-row.summary {
		color: var(--gpen-panel-muted);
		background: color-mix(in srgb, var(--gpen-panel-border) 45%, transparent);
	}

	.layer-row.active {
		border-left-color: var(--gpen-panel-accent);
		background: var(--gpen-panel-selection);
		color: var(--gpen-panel-foreground);
	}

	.layer-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.layer-row em {
		margin-left: auto;
		color: var(--gpen-panel-muted);
		font-style: normal;
		font-variant-numeric: tabular-nums;
	}

	.frame-area {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.layer-head {
		display: flex;
		align-items: center;
		min-height: 2lh;
		padding: 0 1.25ch;
		border-bottom: 1px solid var(--gpen-panel-border);
		color: var(--gpen-panel-muted);
		font-size: 11px;
	}

	.frame-ruler {
		display: flex;
		min-height: 2lh;
		border-bottom: 1px solid var(--gpen-panel-border);
		color: var(--gpen-panel-muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
		overflow: hidden;
	}

	.frame-tick {
		/* 一列 = COLUMN_FRAMES 帧，才能和每帧一条的网格线对齐。 */
		flex: 0 0 calc(var(--frames-per-tick) * var(--frame-width));
		padding-left: 0.5ch;
		padding-top: 0.5lh;
		border-left: 1px solid color-mix(in srgb, var(--gpen-panel-border) 70%, transparent);
	}

	.frame-grid {
		position: relative;
		flex: 1;
		min-height: 0;
		/* 列 = 帧（与标尺同一 --frame-width），行 = 2lh，和左侧图层列表的行高对齐。 */
		background-image:
			repeating-linear-gradient(
				90deg,
				color-mix(in srgb, var(--gpen-panel-border) 55%, transparent) 0 1px,
				transparent 1px var(--frame-width)
			),
			repeating-linear-gradient(
				180deg,
				color-mix(in srgb, var(--gpen-panel-border) 45%, transparent) 0 1px,
				transparent 1px 2lh
			);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--gpen-panel-accent);
		box-shadow: 0 0 6px color-mix(in srgb, var(--gpen-panel-accent) 60%, transparent);
	}

	.playhead::before {
		content: '';
		position: absolute;
		top: 0;
		left: -0.5ch;
		width: 1ch;
		height: 0.8lh;
		border-radius: 0 0 var(--gpen-radius-sm) var(--gpen-radius-sm);
		background: var(--gpen-panel-accent);
	}

	.keyframe {
		position: absolute;
		/* 第二行（Stroke）的垂直中心：行高 = 2lh。 */
		top: calc(3lh - 0.45ch);
		width: 0.9ch;
		height: 0.9ch;
		transform: translateX(-0.45ch) rotate(45deg);
		border-radius: 1px;
		background: var(--gpen-panel-accent);
		opacity: 0.75;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 0.25ch;
	}

	.keyframe-button {
		margin-left: 1.5ch;
	}

</style>
