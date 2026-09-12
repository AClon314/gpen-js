<script lang="ts"></script>

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
		font: 13px/1.2 var(--gpen-font-sans);
	}

	.blender-panel-viewport {
		background: transparent;
		color: rgb(255 255 255 / 0.9);
		/* The empty viewport is a real hole in the overlay. Future drawing tools
		 * can opt back into pointer events for their stroke layer only. */
		pointer-events: none;
	}

	.viewport-stage {
		display: grid;
		place-items: center;
		width: 100%;
		height: 100%;
		min-height: 8lh;
		background: transparent;
	}

	.axis-gizmo {
		position: relative;
		pointer-events: auto;
		width: 13ch;
		height: 5.5lh;
		border: 1px solid rgb(255 255 255 / 0.24);
		border-radius: 50%;
		background: rgb(15 23 42 / 0.12);
		box-shadow: 0 4px 14px rgb(15 23 42 / 0.18);
	}

	.axis-line {
		position: absolute;
		left: 50%;
		top: 50%;
		height: 2lh;
		width: 0.25ch;
		transform-origin: 50% 0;
		border-radius: 2px;
	}

	.axis-line-x {
		background: #e75b67;
		transform: translate(-1px, 0) rotate(90deg);
	}

	.axis-line-y {
		background: #63c56b;
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
		text-shadow: 0 1px 3px #111;
	}

	.axis-label-x {
		right: 1.25ch;
		top: 2.5lh;
		color: #ff7680;
	}

	.axis-label-y {
		left: 1.75ch;
		top: 1lh;
		color: #8be391;
	}

	.axis-label-z {
		left: 6ch;
		bottom: 0.5lh;
		color: #83c3ff;
	}

	.axis-origin {
		position: absolute;
		left: calc(50% - 0.75ch);
		top: calc(50% - 0.25lh);
		width: 1.25ch;
		height: 0.5lh;
		border: 1px solid #fff;
		border-radius: 50%;
		background: #4b5563;
	}

	.viewport-label {
		position: absolute;
		margin-top: 8lh;
		padding: 0.25lh 1.25ch;
		border-radius: 3px;
		background: rgb(15 23 42 / 0.32);
		color: rgb(255 255 255 / 0.9);
		font-size: 12px;
		letter-spacing: 0.04em;
	}

	:global(.dockview-container .dv-groupview .blender-panel-viewport) {
		background: transparent;
	}
</style>
