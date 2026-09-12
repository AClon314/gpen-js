<script lang="ts">
	import Input from '#lib/components/widgets/Input.svelte';

	let horizontalValue = $state(42);
	let fineValue = $state(0.5);
	let verticalValue = $state(25);
	let textValue = $state('画笔名称');
	let disabled = $state(true);
	let lastChange = $state('还没有提交变更');

	function recordChange(label: string, nextValue: number | string) {
		lastChange = `${label}：${nextValue}`;
	}
</script>

<svelte:head><title>Input widgets · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">gpen · widgets</p>
		<h1>Blender 风格 Input</h1>
		<p class="intro">
			点击数值中央进入文本编辑；从两侧空白区域拖拽进行 scrub。右键打开菜单，键盘方向键也可以调整数值。
		</p>
	</header>

	<section class="demo-grid" aria-label="Input 组件示例">
		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>水平数值</h2>
					<p>范围 0–100，步长 1；可以从左右两侧拖动。</p>
				</div>
				<output aria-live="polite">{horizontalValue}</output>
			</div>
			<Input
				bind:value={horizontalValue}
				label="强度"
				min={0}
				max={100}
				step={1}
				unit="%"
				onchange={(nextValue) => recordChange('强度', nextValue)}
			/>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>精细数值</h2>
					<p>步长 0.05，precision 2。</p>
				</div>
				<output aria-live="polite">{fineValue.toFixed(2)}</output>
			</div>
			<Input
				bind:value={fineValue}
				label="不透明度"
				min={0}
				max={1}
				step={0.05}
				precision={2}
				unit=""
				onchange={(nextValue) => recordChange('不透明度', nextValue)}
			/>
		</article>

		<article class="demo-card vertical-card">
			<div class="card-heading">
				<div>
					<h2>垂直形态</h2>
					<p>向上增加，向下减少。</p>
				</div>
				<output aria-live="polite">{verticalValue}</output>
			</div>
			<Input
				bind:value={verticalValue}
				orientation="vertical"
				label="压力"
				min={0}
				max={50}
				step={1}
				unit="px"
				onchange={(nextValue) => recordChange('压力', nextValue)}
			/>
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>文本输入</h2>
					<p>文本值没有 scrub，但仍支持短触编辑和 Esc 取消。</p>
				</div>
			</div>
			<Input
				bind:value={textValue}
				label="图层名称"
				onchange={(nextValue) => recordChange('图层名称', nextValue)}
			/>
			<p class="inline-value">当前值：<strong>{textValue || '（空）'}</strong></p>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>禁用状态</h2>
					<p>验证 disabled、焦点和菜单不会修改它。</p>
				</div>
			</div>
			<Input bind:value={horizontalValue} label="锁定值" min={0} max={100} disabled={disabled} />
			<button type="button" class="secondary-button" onclick={() => (disabled = !disabled)}>
				{disabled ? '启用组件' : '禁用组件'}
			</button>
		</article>
	</section>

	<section class="interaction-notes" aria-labelledby="interaction-title">
		<h2 id="interaction-title">验证提示</h2>
		<ul>
			<li>左键/短触值区：输入框会自动全选；Enter 或失焦提交，Esc 回退。</li>
			<li>数值两侧拖拽：左键确认，右键或 Esc 取消；鼠标锁定后可越过屏幕边缘继续。</li>
			<li>长按触摸：移动进入 scrub；不移动会打开同样的右键菜单。</li>
			<li>最近一次提交：<output aria-live="polite">{lastChange}</output></li>
		</ul>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f1f5f9;
		color: var(--gpen-panel-foreground);
		font-family: var(--gpen-font-sans);
	}

	main {
		box-sizing: border-box;
		width: min(100% - 4ch, 88ch);
		margin: 0 auto;
		padding: 3lh 0 5lh;
	}

	.page-header {
		margin-bottom: 3lh;
	}

	.eyebrow {
		margin: 0 0 0.5lh;
		color: var(--gpen-panel-accent);
		font-size: 0.85em;
		font-weight: 700;
		letter-spacing: 0.12ch;
		text-transform: uppercase;
	}

	h1,
	h2,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0.75lh;
		font-size: 2em;
		line-height: 1.1;
	}

	.intro {
		max-width: 70ch;
		margin-bottom: 0;
		color: #475569;
		line-height: 1.6;
	}

	.demo-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1.5lh 2ch;
		align-items: start;
	}

	.demo-card {
		box-sizing: border-box;
		min-width: 0;
		min-height: 14lh;
		padding: 1.25lh 1.5ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.75lh;
		background: var(--gpen-panel-background);
		box-shadow: 0 0.5lh 1.5lh rgb(15 23 42 / 0.08);
	}

	.demo-card-wide {
		grid-column: span 2;
	}

	.vertical-card {
		min-height: 25lh;
	}

	.card-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1ch;
		min-height: 5lh;
		margin-bottom: 1.25lh;
	}

	.card-heading h2 {
		margin-bottom: 0.35lh;
		font-size: 1.1em;
	}

	.card-heading p {
		margin-bottom: 0;
		color: var(--gpen-panel-muted);
		font-size: 0.9em;
		line-height: 1.45;
	}

	.card-heading output {
		padding: 0.25lh 0.75ch;
		border-radius: 0.35lh;
		background: #eef2ff;
		color: #3730a3;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.inline-value {
		margin: 1.25lh 0 0;
		color: var(--gpen-panel-muted);
	}

	.inline-value strong {
		color: var(--gpen-panel-foreground);
	}

	.secondary-button {
		margin-top: 1.5lh;
		padding: 0.45lh 1ch;
		border: 1px solid #94a3b8;
		border-radius: 0.35lh;
		background: #f8fafc;
		color: #334155;
		font: inherit;
		cursor: pointer;
	}

	.secondary-button:hover,
	.secondary-button:focus-visible {
		border-color: var(--gpen-panel-accent);
		background: #eef2ff;
		outline: none;
	}

	.interaction-notes {
		margin-top: 2lh;
		padding: 1.25lh 1.5ch;
		border-inline-start: 0.35ch solid var(--gpen-panel-accent);
		background: #e0e7ff;
		color: #312e81;
	}

	.interaction-notes h2 {
		margin-bottom: 0.5lh;
		font-size: 1.05em;
	}

	.interaction-notes ul {
		margin: 0;
		padding-inline-start: 2ch;
		line-height: 1.65;
	}

	.interaction-notes output {
		font-weight: 600;
	}

	@media (max-width: 64ch) {
		main {
			width: min(100% - 2ch, 88ch);
			padding-top: 2lh;
		}

		.demo-grid {
			grid-template-columns: 1fr;
		}

		.demo-card-wide {
			grid-column: auto;
		}
	}
</style>
