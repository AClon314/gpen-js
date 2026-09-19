<script lang="ts">
	import ColorPicker from '#lib/components/widgets/colors/ColorPicker.svelte';

	let layerColor = $state('#3366cc');
	let secondColor = $state('#ff8a3d');
	let locked = $state(true);

	/** 协议侧 `Vec3T` 是 0..1 浮点，这里演示边界换算（纯函数，将来放 #lib）。 */
	function toVec3(hex: string): [number, number, number] {
		const n = Number.parseInt(hex.slice(1), 16);
		return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255].map(
			(v) => Number(v.toFixed(3)),
		) as [number, number, number];
	}
</script>

<svelte:head><title>Color widgets · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">gpen · colors</p>
		<h1>颜色控件（Spectrum Web Components）</h1>
		<p>
			不重造颜色选择器：直接用 Adobe 的 <code>@spectrum-web-components</code>（Lit 自定义元素，
			Apache-2.0）。面积图 <code>sp-color-area</code> + 色相条 <code>sp-color-slider</code> +
			十六进制 <code>sp-color-field</code> + 预览 <code>sp-swatch</code>，
			外面套一层 <code>sp-theme</code>（<code>theme-light</code>/<code>theme-dark</code> 两套 token 表）。
			绑定值是 <code>#rrggbb</code>；协议侧的 <code>Vec3T</code>（0..1）在调用方换算。
		</p>
	</header>

	<section class="demo-grid">
		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>图层颜色</h2>
					<p>拖动面积图或色相条、或直接改十六进制值，三者与绑定值保持同步。</p>
				</div>
				<output aria-live="polite">{layerColor}</output>
			</div>
			<ColorPicker bind:value={layerColor} label="图层颜色" />
			<p class="inline-value">
				Vec3T：<strong>{toVec3(layerColor).join(', ')}</strong>
			</p>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>外部改值</h2>
					<p>下面的按钮直接改绑定值，控件应当跟着走（回声守卫保证不与拖拽互抢）。</p>
				</div>
				<output aria-live="polite">{secondColor}</output>
			</div>
			<ColorPicker bind:value={secondColor} label="第二颜色" />
			<button type="button" class="secondary-button" onclick={() => (secondColor = '#22aa66')}>
				设为 #22aa66
			</button>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>禁用</h2>
					<p><code>disabled</code> 透传给三个 SWC 元素。</p>
				</div>
			</div>
			<ColorPicker bind:value={layerColor} label="锁定颜色" disabled={locked} />
			<button type="button" class="secondary-button" onclick={() => (locked = !locked)}>
				{locked ? '启用' : '禁用'}
			</button>
		</article>
	</section>
</main>

<style>
	main {
		max-width: 100ch;
		padding: 1.5lh 3.6ch;
	}

	.page-header p {
		max-width: 80ch;
	}

	.demo-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 2lh 2ch;
		align-items: flex-start;
	}

	.demo-card {
		display: flex;
		flex-direction: column;
		gap: 1lh;
		padding: 1lh 1.5ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
	}

	.inline-value {
		margin: 0;
		color: var(--gpen-panel-muted);
	}
</style>
