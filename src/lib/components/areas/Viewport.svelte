<script lang="ts">
	import { onMount } from 'svelte';
	import MiniMap from '../MiniMap.svelte';

	// 视口本身是 overlay 上的一个洞（viewpoint: 内容由 MiniMap 承担）：宿主网页从它中间透出来，所以这里**不画背景**，
	// 只在右上角放一块导航小地图。整块区域 pointer-events: none，只有小地图 opt-in。
	//
	// 小地图映射的是宿主网页的滚动范围：拖动 / 方向键平移就是在 `window.scrollTo`
	// 平移网页（overlay 跟着 visualViewport 走，所以工作区不动，洞里的内容在动）。
	// 将来画布自己管理平移时，把 extent/viewport 换成画布的那份即可。
	let extent = $state({ width: 0, height: 0 });
	let viewport = $state({ x: 0, y: 0, width: 0, height: 0 });

	function readHostViewport() {
		const visual = window.visualViewport;
		const width = visual?.width ?? window.innerWidth;
		const height = visual?.height ?? window.innerHeight;
		const root = document.documentElement;
		extent = {
			width: Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0, width),
			height: Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0, height)
		};
		viewport = {
			x: window.scrollX,
			y: window.scrollY,
			width,
			height
		};
	}

	function navigateTo(next: { x: number; y: number }) {
		window.scrollTo({ left: next.x, top: next.y, behavior: 'instant' as ScrollBehavior });
		readHostViewport();
	}

	onMount(() => {
		readHostViewport();

		// scroll 每帧都可能触发：批量到一个 rAF，避免连续平移时反复布局。
		let frame: number | undefined;
		const schedule = () => {
			if (frame !== undefined) return;
			frame = requestAnimationFrame(() => {
				frame = undefined;
				readHostViewport();
			});
		};

		const targets: (Window | VisualViewport)[] = [window];
		if (window.visualViewport) targets.push(window.visualViewport);
		for (const target of targets) {
			target.addEventListener('scroll', schedule, { passive: true });
			target.addEventListener('resize', schedule, { passive: true });
		}

		return () => {
			if (frame !== undefined) cancelAnimationFrame(frame);
			for (const target of targets) {
				target.removeEventListener('scroll', schedule);
				target.removeEventListener('resize', schedule);
			}
		};
	});
</script>

<div class="blender-panel blender-panel-viewport" aria-label="视口">
	<div class="minimap-slot">
		<MiniMap {extent} {viewport} onNavigate={navigateTo} />
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
