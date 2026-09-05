<script lang="ts">
	import { resolve } from '$app/paths';

	// ---- 概念 ----
	// dpr  = window.devicePixelRatio  （设备物理像素 / CSS px；桌面 Ctrl+/- 会改，捏合不改）
	// dppc = 屏幕真实 device px / css px（= visualViewport.scale × dpr）
	//
	// 区分 PC 与捏合不用基线，改用两个「归一化到 100% 时≈1」的度量：
	//   - 桌面 Ctrl+/-：outerWidth/innerWidth（detect-zoom chrome 式）
	//   - 捏合：dppc/dpr = visualViewport.scale（你猜的公式，方向正确，且无需基线）
	// 判断用「谁在变」：dpr 变→PC 用 outer/inner；dpr 不变、scale 变→捏合用 scale。
	const _init_dpr = window.devicePixelRatio || 1;
	const _init_dppc = measureDppc();

	let dpr = $state(_init_dpr);
	let dppc = $state(_init_dppc);
	let zoomFactor = $state(_init_dppc);
	let mode = $state<'pc' | 'mobile' | 'none'>('none');
	$inspect(dpr, dppc, zoomFactor);

	// 仅用于「变化检测」（区分 dpr 是否变、scale 是否变），非响应式。
	let lastDpr = $state(_init_dpr);
	let lastScale = $state(window.visualViewport?.scale ?? 1);

	// 归一化到【1】的缩放因子：无缩放时为 1，不依赖加载时基线。
	function normalize(v: number): number {
		if (!Number.isFinite(v)) return 1;
		// 贴近 1 的小偏移（滚动条/取整误差）视为无缩放，避免 counter 0.98 这类噪声。
		return Math.abs(v - 1) < 0.02 ? 1 : v;
	}

	function measureDppc(): number {
		return (window.visualViewport?.scale ?? 1) ;
	}

	function applyChange() {
		const newDpr = window.devicePixelRatio || 1;
		const newScale = window.visualViewport?.scale ?? 1;

		const dprChanged = newDpr !== lastDpr;
		const scaleChanged = newScale !== lastScale;

		if (dprChanged) {
			// 桌面缩放：dpr 变，scale 恒 1 → 用 outer/inner（自身归一化，无需基线）。
			mode = 'pc';
			zoomFactor = normalize(newDpr);
		} else if (scaleChanged) {
			// 捏合：dpr 不变 → 缩放就是 visualViewport.scale（= dppc / dpr）。
			mode = 'mobile';
			zoomFactor = normalize(newScale);
		} else {
			// 两个都没变：保持当前 zoomFactor。
		}

		lastDpr = newDpr;
		lastScale = newScale;
		dpr = newDpr;
		dppc = measureDppc();
	}

	// ---- 把元素钉在屏幕顶部（SO：#26387316 的 absolute + 手动重定位） ----
	let pinnedRef: HTMLDivElement | null = null;
	const PIN = 12; // px 距屏幕边缘

	function positionPinned() {
		const el = pinnedRef;
		if (!el) return;
		const w = el.offsetWidth || 0;
		el.style.top = `${window.pageYOffset + PIN}px`;
		el.style.left = `${window.innerWidth + window.pageXOffset - w - PIN}px`;
	}

	$effect(() => {
		positionPinned();

		// 统一事件入口：一次缩放/滚动同时更新 zoomFactor/mode 并重定位钉子盒子。
		// 桌面 Ctrl+/- 与布局尺寸变化走 window resize/scroll；
		// 捏合/双击缩放的 scale 变化走 visualViewport 的 resize/scroll。
		const onMove = () => {
			applyChange();
			positionPinned();
		};

		window.addEventListener('scroll', onMove);
		window.visualViewport?.addEventListener('resize', onMove);

		return () => {
			window.removeEventListener('scroll', onMove);
			window.visualViewport?.removeEventListener('resize', onMove);
		};
	});

	const counterScale = $derived(1 / zoomFactor);

	const modeLabel = $derived(
		mode === 'pc' ? 'PC (Ctrl+/-)' : mode === 'mobile' ? 'mobile pinch' : '—'
	);
	const zoomPercent = $derived((zoomFactor * 100).toFixed(0));
	const dprValue = $derived(dpr.toFixed(2));
	const dppcValue = $derived(dppc.toFixed(2));
	const counterPercent = $derived((counterScale * 100).toFixed(1));
</script>

<svelte:head><title>Zoom counter · gpen</title></svelte:head>

<main>
	<p><a href={resolve('/')}>← gpen</a></p>
	<h1>读浏览器缩放 · 反向 zoom 抵消 · 捏合后固定元素</h1>
	<p>
		按 <a href="https://github.com/tombigel/detect-zoom" rel="noreferrer">detect-zoom</a>
		的思路，监听 <code>dpr</code> 与 <code>dppc</code>（device px / css px）两个值：
		同时变化判为 <strong>PC</strong>，仅 <code>dppc</code> 变化判为 <strong>移动端捏合</strong>。
		用 <code>zoom: 1/zoomFactor</code> 抵消根级缩放。底部用
		<code>position: absolute</code> + <code>scroll/resize</code> 重定位复刻
		<a href="https://stackoverflow.com/a/26387316/19986873" rel="noreferrer">SO #26387316</a>，
		捏合放大后仍钉在屏幕顶部。
	</p>

	<p class="hint">
		桌面试试 <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>Ctrl</kbd> + <kbd>0</kbd>；移动端/设备模拟器上双指捏合。
	</p>

	<section class="readout" aria-label="缩放读数">
		<div class="readout-item">
			<span class="readout-label">mode</span>
			<span class="readout-value">{modeLabel}</span>
		</div>
		<div class="readout-item">
			<span class="readout-label">zoomFactor</span>
			<span class="readout-value">{zoomPercent}%</span>
		</div>
		<div class="readout-item">
			<span class="readout-label">dpr</span>
			<span class="readout-value">{dprValue}</span>
		</div>
		<div class="readout-item">
			<span class="readout-label">dppc</span>
			<span class="readout-value">{dppcValue}</span>
		</div>
		<div class="readout-item">
			<span class="readout-label">应用的 counter zoom</span>
			<span class="readout-value">{counterPercent}%</span>
		</div>

		<div class="readout-item">
			<span class="readout-label">lastDpr</span>
			<span class="readout-value">{lastDpr.toFixed(2)}</span>
		</div>
		<div class="readout-item">
			<span class="readout-label">lastDppr</span>
			<span class="readout-value">{lastScale.toFixed(2)}</span>
		</div>
	</section>

	<section class="stage" aria-label="缩放对比">
		<div class="box box-plain">
			<strong>普通元素</strong>
			<span>固定 CSS 尺寸（200px），随浏览器缩放放大</span>
		</div>

		<!-- `zoom: 1/zoomFactor` 抵消根级缩放，视觉尺寸恒定 -->
		<div class="box box-counter" style:zoom={counterScale}>
			<strong>counter 元素</strong>
			<span>zoom: 1/{zoomFactor.toFixed(2)} = {counterPercent}% → 视觉尺寸恒定</span>
		</div>
	</section>

	<!-- 占位内容，让页面能滚动，才能观察“固定顶部”效果 -->
	<section class="scroll-space" aria-label="滚动占位">
		<p>往下滚，右下的两个盒子应始终贴在屏幕上。</p>
		<pre>{'测试 '.repeat(800)}</pre>
	</section>
</main>

<!-- 顶部固定的两个盒子：fixed（可能在捏合放大后失效）vs absolute+JS（复刻 SO 做法） -->
<div class="pin fixed-control">fixed</div>
<div class="pin pinned-control" bind:this={pinnedRef}>absolute + JS</div>

<style>
	:global(body) {
		margin: 0;
		background: #f6f8fc;
	}

	main {
		max-width: 48rem;
		padding: 1rem 1.5rem 6rem;
		margin: 0 auto;
	}

	h1 {
		font: 700 1.5rem/1.3 system-ui, sans-serif;
		color: #1e293b;
	}

	p {
		font: 14px/1.6 system-ui, sans-serif;
		color: #475569;
	}

	a {
		color: #4f46e5;
	}

	.hint {
		padding: 0.5rem 0.75rem;
		border: 1px dashed #c6d2e4;
		border-radius: 0.5rem;
		background: rgb(255 255 255 / 0.7);
	}

	kbd {
		padding: 0 0.3rem;
		border: 1px solid #c8d0df;
		border-radius: 0.3rem;
		background: #fff;
		font: 12px/1.4 ui-monospace, monospace;
	}

	.readout {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
		margin: 1rem 0;
	}

	.readout-item {
		display: grid;
		gap: 0.2rem;
		min-width: 8rem;
		padding: 0.6rem 0.85rem;
		border: 1px solid #d7dde6;
		border-radius: 0.5rem;
		background: #fff;
	}

	.readout-label {
		font: 11px/1 system-ui, sans-serif;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #64748b;
	}

	.readout-value {
		font: 700 1.15rem/1.2 ui-monospace, monospace;
		color: #0f172a;
	}

	.stage {
		display: flex;
		gap: 1.25rem;
		flex-wrap: wrap;
		margin-top: 1.5rem;
	}

	.box {
		box-sizing: border-box;
		display: grid;
		align-content: start;
		gap: 0.5rem;
		width: 200px;
		height: 130px;
		padding: 0.9rem 1rem;
		border-radius: 0.6rem;
		color: inherit;
	}

	.box strong {
		font: 700 15px/1.2 system-ui, sans-serif;
	}

	.box span {
		font: 12px/1.5 system-ui, sans-serif;
		opacity: 0.85;
	}

	.box-plain {
		border: 1px solid #c8d0df;
		background: #ffffff;
		color: #1e293b;
	}

	.box-counter {
		border: 1px solid #4f46e5;
		background: #eef2ff;
		color: #3730a3;
	}

	.scroll-space {
		margin-top: 2rem;
		color: #94a3b8;
		font-size: 13px;
	}

	.scroll-space pre {
		white-space: pre-wrap;
		word-break: break-word;
		color: #94a3b8;
	}

	.pin {
		box-sizing: border-box;
		display: grid;
		place-items: center;
		width: 90px;
		height: 28px;
		border-radius: 0.4rem;
		font: 600 12px/1 ui-monospace, monospace;
		z-index: 5;
	}

	.fixed-control {
		position: fixed;
		top: 12px;
		right: 12px;
		background: rgb(220 38 38 / 0.9);
		color: #fff;
	}

	.pinned-control {
		position: absolute; /* 用 absolute 模拟，靠 JS 重定位 */
		top: 12px;
		background: rgb(79 70 229 / 0.9);
		color: #fff;
	}

	@media (prefers-reduced-motion: no-preference) {
		.box,
		.pin {
			transition: background-color 120ms ease;
		}
	}
</style>
