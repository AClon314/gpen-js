<script lang="ts">
	// 视口本身是 overlay 上的一个洞：宿主网页从它中间透出来，所以这里**不画背景**，
	// 只放浮在网页上方的坐标轴 gizmo 和角标。整块区域 pointer-events: none，
	// 只有 gizmo 自己 opt-in（见 GpenWorkspace 的 :global 规则）。
</script>

<div class="blender-panel blender-panel-viewport" aria-label="视口">
	<div class="viewport-stage">
		<div class="axis-gizmo" aria-label="3D 轴 gizmo">
			<span class="axis-line axis-line-x"></span>
			<span class="axis-line axis-line-y"></span>
			<span class="axis-line axis-line-z"></span>
			<span class="axis-label axis-label-x">X</span>
			<span class="axis-label axis-label-y">Y</span>
			<span class="axis-label axis-label-z">Z</span>
			<span class="axis-origin"></span>
		</div>
		<span class="viewport-label">viewport</span>
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

	.blender-panel-viewport {
		background: transparent;
		/* The empty viewport is a real hole in the overlay. Future drawing tools
		 * can opt back into pointer events for their stroke layer only. */
		pointer-events: none;
	}

	.viewport-stage {
		position: relative;
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-height: 8lh;
	}

	/* 坐标轴 gizmo：浮在宿主网页上方，所以自带半透明底板而不是靠主题底色。 */
	.axis-gizmo {
		position: relative;
		pointer-events: auto;
		width: 11ch;
		height: 4.5lh;
		border: 1px solid color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 26%, transparent);
		border-radius: 50%;
		background: var(--gpen-viewport-overlay-background);
		box-shadow: 0 4px 14px rgb(15 23 42 / 0.25);
		backdrop-filter: blur(2px);
	}

	.axis-line {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 2px;
		height: 1.7lh;
		transform-origin: 50% 0;
		border-radius: 2px;
	}

	.axis-line-x {
		background: #ef6a75;
		transform: translate(-1px, 0) rotate(90deg);
	}

	.axis-line-y {
		background: #5fc46a;
		transform: translate(-1px, 0) rotate(-32deg);
	}

	.axis-line-z {
		background: #5ca9ef;
		transform: translate(-1px, 0) rotate(208deg);
	}

	.axis-label {
		position: absolute;
		font-size: 11px;
		font-weight: 700;
		text-shadow: 0 1px 3px rgb(15 23 42 / 0.8);
	}

	.axis-label-x {
		right: 1ch;
		top: 2.15lh;
		color: #ff8a93;
	}

	.axis-label-y {
		left: 1.5ch;
		top: 0.9lh;
		color: #8be391;
	}

	.axis-label-z {
		left: 5.25ch;
		bottom: 0.4lh;
		color: #8ec8ff;
	}

	.axis-origin {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0.9ch;
		height: 0.9ch;
		transform: translate(-50%, -50%);
		border: 1px solid var(--gpen-viewport-overlay-foreground);
		border-radius: 50%;
		background: rgb(15 23 42 / 0.6);
	}

	.viewport-label {
		position: absolute;
		bottom: 1lh;
		padding: 0.3lh 1.25ch;
		border: 1px solid color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 20%, transparent);
		border-radius: 99px;
		background: var(--gpen-viewport-overlay-background);
		color: var(--gpen-viewport-overlay-foreground);
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		backdrop-filter: blur(2px);
	}
</style>
