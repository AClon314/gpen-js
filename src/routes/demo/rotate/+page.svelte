<script lang="ts">
	import { resolve } from '$app/paths';

	type Point = {
		x: number;
		y: number;
	};

	const quickAngles = [0, 90, 180, 270] as const;

	let rotation = $state(0);
	const angleLabel = $derived(`${rotation.toFixed(1)}°`);
	const canvasTransform = $derived(`rotate(${rotation}deg)`);

	// 触摸状态只保存指针位置，不保存或修改任何画布内容坐标。
	const touchPoints = new Map<number, Point>();
	let gestureAngle: number | null = null;

	function clampAngle(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.min(360, Math.max(0, value));
	}

	function wrapAngle(value: number): number {
		const wrapped = value % 360;
		return wrapped < 0 ? wrapped + 360 : wrapped;
	}

	function setRotation(value: number) {
		rotation = clampAngle(value);
	}

	function addRotation(delta: number) {
		rotation = wrapAngle(rotation + delta);
	}

	function onRotationInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		setRotation(Number(input.value));
	}

	function rememberChangedTouches(touches: TouchList) {
		for (let index = 0; index < touches.length; index += 1) {
			const touch = touches.item(index);
			if (touch) {
				touchPoints.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
			}
		}
	}

	function forgetChangedTouches(touches: TouchList) {
		for (let index = 0; index < touches.length; index += 1) {
			const touch = touches.item(index);
			if (touch) touchPoints.delete(touch.identifier);
		}
	}

	function getTouchPair(touches: TouchList): [Point, Point] | null {
		const points: Point[] = [];

		for (let index = 0; index < touches.length && points.length < 2; index += 1) {
			const touch = touches.item(index);
			const point = touch ? touchPoints.get(touch.identifier) : undefined;
			if (point) points.push(point);
		}

		return points.length === 2 ? [points[0], points[1]] : null;
	}

	function lineAngle([first, second]: [Point, Point]): number {
		return (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
	}

	// 将两次测量之间的差值压到 [-180, 180]，避免跨过 0° 时跳变一整圈。
	function shortestAngleDelta(next: number, previous: number): number {
		let delta = next - previous;
		if (delta > 180) delta -= 360;
		if (delta < -180) delta += 360;
		return delta;
	}

	function onTouchStart(event: TouchEvent) {
		// changedTouches 是这次新增/变化的触点；同时同步当前活跃触点，方便第二根手指刚落下时建基线。
		rememberChangedTouches(event.changedTouches);
		rememberChangedTouches(event.touches);

		const pair = getTouchPair(event.touches);
		gestureAngle = pair ? lineAngle(pair) : null;
	}

	function onTouchMove(event: TouchEvent) {
		if (event.touches.length < 2) {
			gestureAngle = null;
			return;
		}

		// 只根据 changedTouches 更新移动中的点；同向平移不会改变两点连线角度，也不会产生平移。
		rememberChangedTouches(event.changedTouches);
		const pair = getTouchPair(event.touches);
		if (!pair) return;

		const nextAngle = lineAngle(pair);
		if (gestureAngle !== null) {
			addRotation(shortestAngleDelta(nextAngle, gestureAngle));
		}
		gestureAngle = nextAngle;

		// touch-action: none 已关闭浏览器手势；这里再阻止默认行为，避免双指移动带动画面滚动。
		if (event.cancelable) event.preventDefault();
	}

	function finishTouchGesture(event: TouchEvent) {
		forgetChangedTouches(event.changedTouches);
		if (event.touches.length < 2) {
			gestureAngle = null;
			if (event.touches.length === 0) touchPoints.clear();
			return;
		}

		rememberChangedTouches(event.touches);
		const pair = getTouchPair(event.touches);
		gestureAngle = pair ? lineAngle(pair) : null;
	}

	// Escape 也可以回到文档的默认视图角度。
	$effect(() => {
		function resetOnEscape(event: KeyboardEvent) {
			if (event.key === 'Escape') setRotation(0);
		}

		window.addEventListener('keydown', resetOnEscape);
		return () => window.removeEventListener('keydown', resetOnEscape);
	});
</script>

<svelte:head><title>Rotate view · gpen</title></svelte:head>

<main>
	<p class="back-link"><a href={resolve('/')}>← gpen</a></p>
	<h1>画布旋转 · Rotate View</h1>
	<p class="intro">
		模拟 Photoshop 的 R 工具：旋转的是显示视图，不是文档数据。拖动滑杆、点击快捷角度，或在下方画布上用两根手指旋转。
	</p>

	<section class="controls" aria-labelledby="controls-title">
		<div class="control-heading">
			<div>
				<h2 id="controls-title">视图旋转</h2>
				<p>触摸手势只读取两指连线的角度变化，不会缩放或平移画布。</p>
			</div>
			<strong class="angle-readout" aria-live="polite">{angleLabel}</strong>
		</div>

		<div class="slider-row">
			<label for="rotation">角度</label>
			<input
				id="rotation"
				type="range"
				min="0"
				max="360"
				step="0.1"
				value={rotation}
				aria-valuetext={angleLabel}
				oninput={onRotationInput}
			/>
			<span class="range-end">360°</span>
		</div>

		<div class="quick-actions" aria-label="常用角度">
			{#each quickAngles as quickAngle}
				<button
					type="button"
					class:active={rotation === quickAngle}
					aria-pressed={rotation === quickAngle}
					onclick={() => setRotation(quickAngle)}
				>
					{quickAngle}°
				</button>
			{/each}
			<button type="button" class="reset-button" onclick={() => setRotation(0)}>↺ 复位</button>
		</div>
	</section>

	<section class="demo-section" aria-labelledby="demo-title">
		<div class="demo-heading">
			<h2 id="demo-title">视图工作区</h2>
			<code>transform: {canvasTransform}</code>
		</div>

		<div
			class="stage"
			role="application"
			aria-label="可用双指旋转的画布工作区"
			ontouchstart={onTouchStart}
			ontouchmove={onTouchMove}
			ontouchend={finishTouchGesture}
			ontouchcancel={finishTouchGesture}
		>
			<!-- 这些方向标记在旋转容器之外，代表屏幕方向，不会跟着画布转。 -->
			<div class="screen-reference" aria-label="固定的屏幕方向参考">
				<span class="direction direction-n">N</span>
				<span class="direction direction-e">E</span>
				<span class="direction direction-s">S</span>
				<span class="direction direction-w">W</span>
				<span class="reference-label">SCREEN<br />不旋转</span>
			</div>

			<!-- 只有这个容器被旋转；其中的网格、坐标和图形仍使用原来的文档坐标。 -->
			<div class="artboard" style:transform={canvasTransform} role="img" aria-label="旋转中的参考画布">
				<span class="canvas-tag">DOCUMENT VIEW</span>
				<span class="axis-label axis-x">x</span>
				<span class="axis-label axis-y">y</span>
				<span class="coordinate coordinate-top">(-120, 80)</span>
				<span class="coordinate coordinate-bottom">(120, -80)</span>

				<div class="guide guide-horizontal" aria-hidden="true"></div>
				<div class="guide guide-vertical" aria-hidden="true"></div>
				<div class="crosshair" aria-hidden="true"></div>

				<div class="shape shape-circle">
					<span>A</span>
				</div>
				<div class="shape shape-square">
					<span>B</span>
				</div>
				<div class="shape shape-diamond" aria-hidden="true"></div>
				<div class="shape shape-triangle" aria-hidden="true"></div>
				<div class="shape shape-orbit" aria-hidden="true"></div>
			</div>
		</div>
	</section>

	<section class="explanation" aria-label="实现说明">
		<div>
			<span class="explanation-label">文档坐标</span>
			<strong>(0, 0) · unchanged</strong>
		</div>
		<div>
			<span class="explanation-label">当前视图</span>
			<strong>只应用 rotate({angleLabel})</strong>
		</div>
		<p id="gesture-help">两指旋转结束后角度会保持；两指同向水平/垂直移动时，连线角度不变，因此不会触发画布平移。按 Esc 或点击“复位”回到 0°。</p>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f4f7fb;
		color: #172033;
	}

	:global(button),
	:global(input) {
		font: inherit;
	}

	main {
		max-width: 70rem;
		margin: 0 auto;
		padding: 1rem 1.5rem 4rem;
	}

	.back-link {
		margin: 0 0 1.5rem;
	}

	a {
		color: #5b4be7;
	}

	h1 {
		margin: 0;
		font: 700 clamp(1.6rem, 4vw, 2.25rem) / 1.2 system-ui, sans-serif;
		letter-spacing: -0.02em;
	}

	h2 {
		margin: 0;
		font: 700 1.05rem / 1.3 system-ui, sans-serif;
	}

	p {
		color: #526078;
		font: 14px / 1.65 system-ui, sans-serif;
	}

	.intro {
		max-width: 52rem;
		margin: 0.75rem 0 1.5rem;
	}

	.controls,
	.explanation {
		border: 1px solid #dbe2ee;
		border-radius: 0.9rem;
		background: rgb(255 255 255 / 0.86);
		box-shadow: 0 0.5rem 1.5rem rgb(31 41 55 / 0.05);
	}

	.controls {
		padding: 1rem 1.1rem 1.1rem;
	}

	.control-heading,
	.demo-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.control-heading p {
		margin: 0.35rem 0 0;
		font-size: 12px;
	}

	.angle-readout {
		flex: 0 0 auto;
		color: #3528a8;
		font: 700 clamp(1.5rem, 5vw, 2.1rem) / 1 ui-monospace, monospace;
		letter-spacing: -0.05em;
	}

	.slider-row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.7rem;
		margin-top: 1.1rem;
		color: #334155;
		font: 600 12px / 1 system-ui, sans-serif;
	}

	.slider-row input {
		width: 100%;
		accent-color: #6657e8;
		cursor: ew-resize;
	}

	.range-end {
		color: #8792a6;
		font: 11px / 1 ui-monospace, monospace;
	}

	.quick-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-top: 0.9rem;
	}

	button {
		min-width: 3.5rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.45rem;
		background: #fff;
		color: #334155;
		font: 600 12px / 1 system-ui, sans-serif;
		cursor: pointer;
		transition:
			border-color 120ms ease,
			background-color 120ms ease,
			color 120ms ease;
	}

	button:hover,
	button:focus-visible {
		border-color: #6657e8;
		color: #4338ca;
		outline: none;
	}

	button:focus-visible {
		box-shadow: 0 0 0 3px rgb(102 87 232 / 0.18);
	}

	button.active,
	button[aria-pressed='true'] {
		border-color: #6657e8;
		background: #eeedff;
		color: #4338ca;
	}

	.reset-button {
		margin-left: auto;
		border-color: #f1b8b8;
		color: #a33a3a;
	}

	.reset-button:hover,
	.reset-button:focus-visible {
		border-color: #d46666;
		color: #9f2d2d;
	}

	.demo-section {
		margin-top: 1.5rem;
	}

	.demo-heading {
		align-items: center;
		margin-bottom: 0.7rem;
	}

	.demo-heading code {
		padding: 0.3rem 0.5rem;
		border: 1px solid #d8def0;
		border-radius: 0.35rem;
		background: #f3f1ff;
		color: #5146a9;
		font: 11px / 1.2 ui-monospace, monospace;
		white-space: nowrap;
	}

	.stage {
		position: relative;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		min-height: clamp(28rem, 75vw, 42rem);
		padding: clamp(2.5rem, 8vw, 5rem);
		overflow: hidden;
		border: 1px solid #cdd7e6;
		border-radius: 1rem;
		background:
			radial-gradient(circle at 50% 50%, rgb(255 255 255 / 0.8), transparent 58%),
			#e9eef6;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.8);
		touch-action: none;
		user-select: none;
	}

	.screen-reference {
		position: absolute;
		inset: 0;
		z-index: 3;
		pointer-events: none;
		color: #53627a;
		font: 700 11px / 1 ui-monospace, monospace;
		letter-spacing: 0.08em;
	}

	.direction {
		position: absolute;
		display: grid;
		place-items: center;
		width: 1.7rem;
		height: 1.7rem;
		border: 1px solid #aebbd0;
		border-radius: 50%;
		background: rgb(248 250 252 / 0.9);
		box-shadow: 0 0.15rem 0.4rem rgb(31 41 55 / 0.08);
	}

	.direction-n {
		top: 0.8rem;
		left: 50%;
		transform: translateX(-50%);
	}

	.direction-e {
		top: 50%;
		right: 0.8rem;
		transform: translateY(-50%);
	}

	.direction-s {
		bottom: 0.8rem;
		left: 50%;
		transform: translateX(-50%);
	}

	.direction-w {
		top: 50%;
		left: 0.8rem;
		transform: translateY(-50%);
	}

	.reference-label {
		position: absolute;
		right: 1rem;
		bottom: 0.8rem;
		text-align: right;
		color: #8090a8;
		font-size: 9px;
		line-height: 1.5;
	}

	.artboard {
		position: relative;
		z-index: 1;
		width: min(58%, 31rem);
		aspect-ratio: 4 / 3;
		box-sizing: border-box;
		border: 2px solid #667493;
		border-radius: 0.35rem;
		background-color: #f8fafc;
		background-image:
			linear-gradient(rgb(100 116 139 / 0.23) 1px, transparent 1px),
			linear-gradient(90deg, rgb(100 116 139 / 0.23) 1px, transparent 1px),
			conic-gradient(#e5eaf2 25%, #f8fafc 0 50%, #e5eaf2 0 75%, #f8fafc 0);
		background-position: 0 0, 0 0, 0 0;
		background-size: 2rem 2rem, 2rem 2rem, 1.5rem 1.5rem;
		box-shadow: 0 1rem 2rem rgb(31 41 55 / 0.17);
		transform-origin: center;
	}

	.canvas-tag,
	.coordinate,
	.axis-label {
		position: absolute;
		z-index: 2;
		color: #59677f;
		font: 10px / 1 ui-monospace, monospace;
	}

	.canvas-tag {
		top: 0.75rem;
		left: 0.85rem;
		padding: 0.25rem 0.35rem;
		border: 1px solid rgb(89 103 127 / 0.35);
		border-radius: 0.2rem;
		background: rgb(248 250 252 / 0.72);
		letter-spacing: 0.08em;
	}

	.axis-label {
		font-size: 12px;
		font-weight: 700;
	}

	.axis-x {
		right: 0.8rem;
		bottom: calc(50% - 1.1rem);
	}

	.axis-y {
		top: 0.8rem;
		left: calc(50% + 0.65rem);
	}

	.coordinate {
		padding: 0.2rem 0.3rem;
		border-radius: 0.2rem;
		background: rgb(255 255 255 / 0.65);
	}

	.coordinate-top {
		top: 14%;
		right: 13%;
	}

	.coordinate-bottom {
		right: 13%;
		bottom: 14%;
	}

	.guide {
		position: absolute;
		z-index: 0;
		background: rgb(79 70 229 / 0.22);
	}

	.guide-horizontal {
		top: calc(50% - 0.5px);
		left: 0;
		width: 100%;
		height: 1px;
	}

	.guide-vertical {
		top: 0;
		left: calc(50% - 0.5px);
		width: 1px;
		height: 100%;
	}

	.crosshair {
		position: absolute;
		top: 50%;
		left: 50%;
		z-index: 1;
		width: 2.4rem;
		height: 2.4rem;
		border: 1px solid #5146a9;
		border-radius: 50%;
		box-shadow: 0 0 0 0.3rem rgb(255 255 255 / 0.55);
		transform: translate(-50%, -50%);
	}

	.crosshair::before,
	.crosshair::after {
		position: absolute;
		content: '';
		background: #5146a9;
	}

	.crosshair::before {
		top: calc(50% - 0.5px);
		left: -0.6rem;
		width: calc(100% + 1.2rem);
		height: 1px;
	}

	.crosshair::after {
		top: -0.6rem;
		left: calc(50% - 0.5px);
		width: 1px;
		height: calc(100% + 1.2rem);
	}

	.shape {
		position: absolute;
		z-index: 2;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		font: 700 12px / 1 system-ui, sans-serif;
	}

	.shape-circle {
		top: 20%;
		left: 20%;
		width: 4.5rem;
		height: 4.5rem;
		border: 3px solid #e05d74;
		border-radius: 50%;
		background: rgb(251 113 133 / 0.2);
		color: #b3294a;
	}

	.shape-square {
		right: 17%;
		bottom: 20%;
		width: 4.25rem;
		height: 4.25rem;
		border: 3px solid #249c88;
		border-radius: 0.35rem;
		background: rgb(45 212 191 / 0.2);
		color: #087463;
	}

	.shape-diamond {
		top: 19%;
		right: 26%;
		width: 2.5rem;
		height: 2.5rem;
		border: 3px solid #d38b22;
		background: rgb(251 191 36 / 0.28);
		transform: rotate(45deg);
	}

	.shape-triangle {
		bottom: 17%;
		left: 23%;
		width: 0;
		height: 0;
		border-right: 1.8rem solid transparent;
		border-bottom: 3rem solid #6375d6;
		border-left: 1.8rem solid transparent;
		filter: drop-shadow(0 0 0.1rem rgb(63 81 181 / 0.35));
	}

	.shape-orbit {
		top: 24%;
		left: 48%;
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid #8655c9;
		border-radius: 50%;
		box-shadow: 0 0 0 0.35rem rgb(134 85 201 / 0.12);
	}

	.explanation {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem 1.2rem;
		margin-top: 1.2rem;
		padding: 1rem 1.1rem;
	}

	.explanation > div {
		display: grid;
		gap: 0.25rem;
	}

	.explanation-label {
		color: #758197;
		font: 11px / 1 system-ui, sans-serif;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.explanation strong {
		color: #29344a;
		font: 600 13px / 1.3 ui-monospace, monospace;
	}

	.explanation p {
		grid-column: 1 / -1;
		margin: 0.1rem 0 0;
		padding-top: 0.75rem;
		border-top: 1px dashed #d7deea;
		font-size: 12px;
	}

	@media (max-width: 38rem) {
		main {
			padding-right: 1rem;
			padding-left: 1rem;
		}

		.control-heading,
		.demo-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.65rem;
		}

		.angle-readout {
			align-self: flex-end;
			margin-top: -2.5rem;
		}

		.demo-heading code {
			max-width: 100%;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.stage {
			min-height: 28rem;
			padding: 2.5rem 1rem;
		}

		.artboard {
			width: min(68%, 21rem);
		}

		.shape-circle,
		.shape-square {
			width: 3.4rem;
			height: 3.4rem;
		}

		.shape-triangle {
			border-right-width: 1.35rem;
			border-bottom-width: 2.3rem;
			border-left-width: 1.35rem;
		}

		.explanation {
			grid-template-columns: 1fr;
		}
	}
</style>
