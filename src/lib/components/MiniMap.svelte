<script lang="ts">
	import {
		clampViewportOrigin,
		projectMinimap,
		viewportOriginAtPoint,
		type MapRect,
		type MapSize
	} from '#lib/viewportMap';

	// 视图导航小地图：把「文档」（这里是宿主网页的滚动范围）缩成一张小图，
	// 图里那格亮框就是当前可见区域。拖它 / 点它 / 用方向键都能平移视图。
	//
	// 组件只做投影和手势，不知道滚动是谁实现的：调用方把 `extent` / `viewport`
	// 喂进来，再用 `onNavigate` 把目标位置落到自己那边（网页 → window.scrollTo，
	// 将来的 gpen 画布 → 画布的 pan）。
	let {
		extent,
		viewport,
		label = '视图',
		onNavigate
	}: {
		extent: MapSize;
		viewport: MapRect;
		label?: string;
		onNavigate?: (origin: { x: number; y: number }) => void;
	} = $props();

	const projection = $derived(projectMinimap({ extent, viewport }));
	// 小地图的宽高比跟着覆盖范围走，拖动位置才对得上（极端宽高比靠 CSS 的 max-height 兜底）。
	const aspect = $derived(
		projection.span.width > 0 && projection.span.height > 0
			? `${projection.span.width} / ${projection.span.height}`
			: '4 / 3'
	);

	let body = $state<HTMLElement | undefined>(undefined);
	let dragging = $state(false);

	function navigateTo(clientX: number, clientY: number) {
		const box = body?.getBoundingClientRect();
		if (!box || box.width === 0 || box.height === 0) return;
		onNavigate?.(
			viewportOriginAtPoint({
				extent,
				viewport,
				nx: (clientX - box.left) / box.width,
				ny: (clientY - box.top) / box.height
			})
		);
	}

	function handlePointerDown(event: PointerEvent) {
		if (event.button !== 0) return;
		dragging = true;
		body?.setPointerCapture(event.pointerId);
		navigateTo(event.clientX, event.clientY);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!dragging) return;
		navigateTo(event.clientX, event.clientY);
	}

	function endDrag(event: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		if (body?.hasPointerCapture(event.pointerId)) body.releasePointerCapture(event.pointerId);
	}

	/** 键盘等价操作：方向键按视图的 1/10 平移。 */
	function handleKeydown(event: KeyboardEvent) {
		const stepX = viewport.width / 10;
		const stepY = viewport.height / 10;
		const offset = {
			ArrowLeft: { x: -stepX, y: 0 },
			ArrowRight: { x: stepX, y: 0 },
			ArrowUp: { x: 0, y: -stepY },
			ArrowDown: { x: 0, y: stepY }
		}[event.key];
		if (!offset) return;
		event.preventDefault();
		onNavigate?.(
			clampViewportOrigin({ x: viewport.x + offset.x, y: viewport.y + offset.y }, { extent, viewport })
		);
	}

	function percent(value: number): string {
		return `${(value * 100).toFixed(3)}%`;
	}
</script>

<div class="minimap" role="group" aria-label="{label}导航">
	<div class="minimap-head">
		<span class="minimap-title">{label}</span>
		<span class="minimap-hint" aria-hidden="true">拖动平移</span>
	</div>

	<!-- 这块小图是可操作控件（pointer 拖动 + 方向键平移），不是装饰性的 div：
	     role="application" 是为了把方向键交给它自己处理，svelte 的 a11y 规则不认这个 role，
	     所以显式豁免这两条（可聚焦 + 事件监听）。 -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="minimap-body"
		class:dragging
		bind:this={body}
		style="aspect-ratio: {aspect}"
		tabindex="0"
		role="application"
		aria-label="{label}：拖动或按方向键平移"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={endDrag}
		onpointercancel={endDrag}
		onkeydown={handleKeydown}
	>
		<!-- 视图框：位置 / 大小都是相对覆盖范围的百分比，因此不用测量 DOM。 -->
		<span
			class="minimap-view"
			style:left={percent(projection.rect.x)}
			style:top={percent(projection.rect.y)}
			style:width={percent(projection.rect.width)}
			style:height={percent(projection.rect.height)}
		></span>
	</div>
</div>

<style>
	.minimap {
		/* 浮在宿主网页上，所以自带半透明底板，而不是靠主题底色。 */
		box-sizing: border-box;
		width: 16ch;
		padding: 0.35lh 0.5ch 0.5ch;
		border: 1px solid color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 24%, transparent);
		border-radius: var(--gpen-radius);
		background: var(--gpen-viewport-overlay-background);
		box-shadow: var(--gpen-viewport-overlay-shadow);
		backdrop-filter: blur(2px);
		color: var(--gpen-viewport-overlay-foreground);
		/* 视口整块是 pointer-events: none 的“洞”，这里 opt-in 回来。 */
		pointer-events: auto;
		user-select: none;
	}

	.minimap-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1ch;
		padding: 0 0.25ch 0.25lh;
	}

	.minimap-title {
		font-size: 11px;
		letter-spacing: 0.08em;
	}

	.minimap-hint {
		font-size: 10px;
		opacity: 0;
		transition: opacity 120ms ease;
	}

	.minimap:hover .minimap-hint,
	.minimap:focus-within .minimap-hint {
		opacity: 0.7;
	}

	.minimap-body {
		position: relative;
		box-sizing: border-box;
		width: 100%;
		min-height: 3lh;
		max-height: 10lh;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 18%, transparent);
		border-radius: var(--gpen-radius-sm);
		/* 画布网格：让这块小图读起来像“文档”而不是一个空盒子。 */
		background-image:
			repeating-linear-gradient(
				90deg,
				color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 12%, transparent) 0 1px,
				transparent 1px 2ch
			),
			repeating-linear-gradient(
				180deg,
				color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 12%, transparent) 0 1px,
				transparent 1px 2lh
			);
		cursor: grab;
		touch-action: none;
	}

	.minimap-body.dragging {
		cursor: grabbing;
	}

	.minimap-body:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 1px;
	}

	.minimap-view {
		position: absolute;
		box-sizing: border-box;
		border: 1px solid var(--gpen-panel-accent);
		border-radius: 2px;
		background: color-mix(in srgb, var(--gpen-panel-accent) 32%, transparent);
		/* 视图框描边用 overlay 底色（两套配色下都是深色半透明，保证任何网页上都看得清）。 */
		box-shadow: 0 0 0 1px var(--gpen-viewport-overlay-background);
		pointer-events: none;
	}
</style>
