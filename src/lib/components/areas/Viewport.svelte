<script lang="ts">
	import { onMount } from 'svelte';
	import { observeViewport, viewportSize } from '#lib/visualViewport';
	import MiniMap from '../MiniMap.svelte';

	// 视口本身是 overlay 上的一个洞：宿主网页从它中间透出来，所以这里**不画背景**，
	// 只在右上角放一块导航小地图与一组视图旋转控件；整块区域 pointer-events: none，
	// 只有这些 overlay 控件 opt-in。
	//
	// 小地图映射的是宿主网页的滚动范围：拖动 / 方向键平移就是在 `window.scrollTo`
	// 平移网页（overlay 跟着 visualViewport 走，所以工作区不动，洞里的内容在动）。
	// 将来画布自己管理平移时，把 extent/viewport 换成画布的那份即可。
	let {
		viewState = { rotation: 0 },
		onRotate
	}: {
		/** 共享视图状态（`$state` 代理：跨组件传引用才保持响应）。 */
		viewState?: { rotation: number };
		/** `onRotate` 收的是绝对角度（度），不是增量。 */
		onRotate?: (degrees: number) => void;
	} = $props();

	let extent = $state({ width: 0, height: 0 });
	let viewport = $state({ x: 0, y: 0, width: 0, height: 0 });

	function readHostViewport() {
		const { width, height } = viewportSize();
		const root = document.documentElement;
		extent = {
			width: Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0, width),
			height: Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0, height)
		};
		// 这里用 `scrollX/scrollY` 而不是 `pageLeft/pageTop`：小地图平移是 `window.scrollTo`，
		// 后者只能寻址布局视口的滚动量（pinch 平移没法用它设置）。
		viewport = { x: window.scrollX, y: window.scrollY, width, height };
	}

	function navigateTo(next: { x: number; y: number }) {
		window.scrollTo({ left: next.x, top: next.y, behavior: 'instant' as ScrollBehavior });
		readHostViewport();
	}

	function formatRotation(degrees: number): string {
		return `${degrees.toFixed(1)}°`;
	}

	onMount(() => {
		readHostViewport();
		// 滚动 / 缩放 / 软键盘都会改可视区：合并到 rAF 后重读一次（observeViewport 已经做了批量）。
		return observeViewport(readHostViewport);
	});
</script>

<div class="blender-panel blender-panel-viewport" aria-label="视口">
	<div class="viewport-overlays">
		<MiniMap {extent} {viewport} onNavigate={navigateTo} />

		<div class="view-rotate" role="group" aria-label="视图旋转">
			<button
				class="view-rotate-button"
				type="button"
				aria-label="逆时针旋转 15 度"
				title="逆时针旋转 15°"
				onclick={() => onRotate?.(viewState.rotation - 15)}
			>−</button>
			<span class="view-rotate-value" aria-live="polite" aria-label="当前视图旋转角度">
				{formatRotation(viewState.rotation)}
			</span>
			<button
				class="view-rotate-button"
				type="button"
				aria-label="顺时针旋转 15 度"
				title="顺时针旋转 15°"
				onclick={() => onRotate?.(viewState.rotation + 15)}
			>+</button>
			<button
				class="view-rotate-button view-rotate-reset"
				type="button"
				aria-label="重置视图旋转"
				title="重置视图旋转"
				onclick={() => onRotate?.(0)}
			>0°</button>
		</div>
	</div>
</div>

<style>
	.blender-panel-viewport {
		position: relative;
		background: transparent;
		/* The empty viewport is a real hole in the overlay. Future drawing tools
		 * can opt back into pointer events for their stroke layer only. */
		pointer-events: none;
	}

	.viewport-overlays {
		position: absolute;
		top: 1lh;
		right: 1.5ch;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0.5lh;
		pointer-events: none;
	}

	/* 旋转控件浮在宿主网页上，沿用 minimap 的 overlay 配色（深色半透明）。 */
	.view-rotate {
		display: flex;
		align-items: center;
		gap: 0.25ch;
		box-sizing: border-box;
		padding: 0.2lh 0.4ch;
		border: 1px solid color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 24%, transparent);
		border-radius: var(--gpen-radius);
		background: var(--gpen-viewport-overlay-background);
		box-shadow: var(--gpen-viewport-overlay-shadow);
		backdrop-filter: blur(2px);
		color: var(--gpen-viewport-overlay-foreground);
		pointer-events: auto;
		user-select: none;
	}

	.view-rotate-button {
		display: grid;
		place-items: center;
		min-width: 2.4ch;
		height: 1.6lh;
		padding: 0 0.4ch;
		border: 0;
		border-radius: var(--gpen-radius-sm);
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.view-rotate-button:hover {
		background: color-mix(in srgb, var(--gpen-viewport-overlay-foreground) 18%, transparent);
	}

	.view-rotate-button:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 1px;
	}

	.view-rotate-value {
		min-width: 6ch;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.view-rotate-reset {
		font-size: 11px;
	}
</style>
