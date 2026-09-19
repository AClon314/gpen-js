<script lang="ts">
	import { onMount } from 'svelte';
	import { observeViewport, viewportSize } from '#lib/visualViewport';
	import MiniMap from '../MiniMap.svelte';

	// 视口本身是 overlay 上的一个洞：宿主网页从它中间透出来，所以这里**不画背景**，
	// 只在右上角放一块导航小地图；整块区域 pointer-events: none，只有小地图 opt-in。
	//
	// 小地图映射的是宿主网页的滚动范围：拖动 / 方向键平移就是在 `window.scrollTo`
	// 平移网页（overlay 跟着 visualViewport 走，所以工作区不动，洞里的内容在动）。
	// 将来画布自己管理平移时，把 extent/viewport 换成画布的那份即可。
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

	onMount(() => {
		readHostViewport();
		// 滚动 / 缩放 / 软键盘都会改可视区：合并到 rAF 后重读一次（observeViewport 已经做了批量）。
		return observeViewport(readHostViewport);
	});
</script>

<div class="blender-panel blender-panel-viewport" aria-label="视口">
	<div class="minimap-slot">
		<MiniMap {extent} {viewport} onNavigate={navigateTo} />
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

	.minimap-slot {
		position: absolute;
		top: 1lh;
		right: 1.5ch;
		z-index: 1;
	}
</style>
