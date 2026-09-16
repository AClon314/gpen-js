<script lang="ts">
	import Input from '#lib/components/widgets/inputs/Input.svelte';

	let horizontalValue = $state(42);
	let fineValue = $state(23.45);
	let illegalValue = $state(23.45);
	let verticalValue = $state(25);
	let textValue = $state('画笔名称');
	let formValue = $state(3);
	let disabled = $state(true);
	let sliderValue = $state(9.98);
	let fractionValue = $state(0.009);
	let lastChange = $state('还没有提交变更');

	type InputChangeEvent = Event & { currentTarget: HTMLInputElement };

	function recordChange(label: string, event: InputChangeEvent) {
		lastChange = `${label}：${event.currentTarget.value}`;
	}

	function recordSubmit(event: SubmitEvent) {
		event.preventDefault();
		lastChange = '表单校验通过，已提交';
	}
</script>

<svelte:head><title>Input widgets · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">gpen · widgets</p>
		<h1>Blender 风数值输入</h1>
		<p class="intro">
			只有 <code>number</code> 用自研控件（原生 <code>&lt;input type="number"&gt;</code> 在 Chrome
			不提供 selection API，做不了按光标位权步进）；其余 <code>type</code> 一律渲染原生
			<code>&lt;input&gt;</code>。输入框始终可直接编辑；把光标放到某一位后用 ↑/↓ 按该位量级步进（caret 在最左侧时改首位数字，<code>^90</code> ↑ → <code>^100</code>、<code>^100</code> ↓ → <code>^90</code>），caret 贴在最左/最右
			时 ←/→ 按配置 step 减/加，也可用两侧的 −/+ 按配置 step 调整。
		</p>
	</header>

	<section class="demo-grid" aria-label="Input 组件示例">
		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>水平数值</h2>
					<p>范围 0–100，步长 1；把光标放到某一位后 ↑/↓ 按该位量级步进，caret 在最左侧时改首位数字（<code>^90</code> ↑ → <code>^100</code>、<code>^100</code> ↓ → <code>^90</code>），Shift 放大 5 倍；caret 贴在最左/最右时 ←/→ 按配置 step 减/加。Home/End 按两次跳 min/max；悬浮在控件上、且未聚焦时按 Delete（激活后 Delete 为原生删除）或在控件上右键选「重置为默认值」回到初始值 42。</p>
				</div>
				<output aria-live="polite">{horizontalValue}%</output>
			</div>
			<Input
				bind:value={horizontalValue}
				aria-label="强度"
				min={0}
				max={100}
				step={1}
				unit="%"
				onchange={(event) => recordChange('强度', event)}
			/>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>精细数值</h2>
					<p>从 23.45 开始：<code>step={0.01}</code> 同时定义步长与提交精度（2 位小数）。把光标放到某一位，↑/↓ 按该位量级步进；Shift 放大 5 倍。</p>
				</div>
				<output aria-live="polite">{Number.isNaN(fineValue) ? 'NaN' : fineValue.toFixed(2)}</output>
			</div>
			<Input
				bind:value={fineValue}
				aria-label="不透明度"
				min={-1000}
				max={1000}
				step={0.01}
				unit=""
				onchange={(event) => recordChange('不透明度', event)}
			/>
		</article>

		<article class="demo-card vertical-card">
			<div class="card-heading">
				<div>
					<h2>垂直形态</h2>
					<p>垂直布局视觉顺序为 + 在上、− 在下；键盘按 caret 位权步进，按钮按 step 调整，单位显示为 px。</p>
				</div>
				<output aria-live="polite">{verticalValue}px</output>
			</div>
			<Input
				bind:value={verticalValue}
				orientation="vertical"
				aria-label="压力"
				min={0}
				max={50}
				step={1}
				unit="px"
				onchange={(event) => recordChange('压力', event)}
			/>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>非法文本</h2>
					<p>输入 <code>1.2.3</code> 一类非数字文本后失焦：文本原样保留、背景变 <code>--gpen-danger</code>、绑定值变成 NaN；不再强行回退。</p>
				</div>
				<output aria-live="polite">{Number.isNaN(illegalValue) ? 'NaN' : '是数值'}</output>
			</div>
			<Input
				bind:value={illegalValue}
				aria-label="不透明度（非法文本演示）"
				min={-1000}
				max={1000}
				step={0.01}
				onchange={(event) => recordChange('不透明度', event)}
			/>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>小数位轮</h2>
					<p>把光标放在小数点右侧（<code>0.^009</code>），↑/↓ 从第一个非零小数位开始逐位步进；<code>0.^01</code> ▼ 会扩展精度到 <code>0.^009</code>。step=0.001 提供 3 位精度。</p>
				</div>
				<output aria-live="polite">{fractionValue}</output>
			</div>
			<Input bind:value={fractionValue} aria-label="小数位轮" min={0} max={1} step={0.001} />
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>无极滑条（InputSlider）</h2>
					<p>点击 / 轻触走原生 focus，激活 InputNumber 编辑模式；长按或拖拽不激活编辑模式，直接连续调整数值。<strong>拖拽精度取当前值的小数位</strong>（9.98 → 0.01），浮层按 min/max 显示比例。</p>
				</div>
				<output aria-live="polite">{sliderValue}</output>
			</div>
			<Input bind:value={sliderValue} slider aria-label="滑条数值" min={0} max={100} step={0.01} />
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>文本输入（原生）</h2>
					<p>字符串 value → 直接渲染原生 <code>&lt;input type="text"&gt;</code>，不再包一层自研控件；剪切/复制/粘贴与右键菜单都是浏览器原生行为。</p>
				</div>
			</div>
			<Input
				bind:value={textValue}
				class="demo-native-input"
				aria-label="图层名称"
				placeholder="输入图层名称"
				onchange={(event) => recordChange('图层名称', event)}
			/>
			<p class="inline-value">当前值：<strong>{textValue || '（空）'}</strong></p>
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>表单校验（原生 constraint validation）</h2>
					<p>非法文本（以及 <code>min</code>/<code>max</code>/<code>step</code> 违规）会写进
						<code>input.validity.customError</code>，所以 <code>&lt;form&gt;</code> 的
						<code>checkValidity()</code> / 提交会被浏览器拦下并给出气泡提示。清空后再提交则通过。</p>
				</div>
				<output aria-live="polite">{Number.isNaN(formValue) ? 'NaN' : formValue}</output>
			</div>
			<form onsubmit={recordSubmit}>
				<Input bind:value={formValue} aria-label="表单数值" min={0} max={10} step={1} unit="" />
				<button type="submit" class="secondary-button">提交表单</button>
			</form>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>禁用状态</h2>
					<p>原生 disabled 会同时禁用输入框和 −/+ 按钮；禁用时右键不弹自研菜单。</p>
				</div>
			</div>
			<Input bind:value={horizontalValue} aria-label="锁定值" min={0} max={100} disabled={disabled} />
			<button type="button" class="secondary-button" onclick={() => (disabled = !disabled)}>
				{disabled ? '启用组件' : '禁用组件'}
			</button>
		</article>
	</section>

	<section class="interaction-notes" aria-labelledby="interaction-title">
		<h2 id="interaction-title">验证提示</h2>
		<ul>
			<li>数值 ↑/↓ 按光标所在数字的位权步进；Shift 临时放大 5 倍；Home/End 第一次移动光标，第二次才在有 min/max 时跳边界。</li>
			<li>caret 在符号区时 <code>-</code> 在 <code>-5</code> / <code>+5</code> 之间切换（保留加号），<code>+</code> 强制为正；<code>^1.0</code> ↓ 会进入智能小数位变成 <code>0.^9</code>。</li>
			<li>鼠标悬浮在数值控件上、且未聚焦时，按裸 Delete 重置为创建时的初值；激活（input 聚焦）后 Delete 恢复原生向后删除。</li>
			<li>数值控件上右键打开自研菜单（重置为默认值 / 设为最小值 / 设为最大值，后两项在没有对应 min/max 时禁用）；其余 <code>&lt;input&gt;</code> 保留浏览器原生右键菜单。</li>
			<li>输入非数字文本时不再强行回退：文本原样保留、背景标 <code>--gpen-danger</code>、绑定值变 NaN，并让 <code>&lt;form&gt;</code> 的原生校验拦截提交；数值文本失焦时做 min/max clamp 与 step 位数取整，Escape 恢复聚焦快照。</li>
			<li>−/+ 按钮、caret 贴边的 ←/→ 与滑条拖拽都按配置 step 调整；显式非数值 step 安全忽略。数值控件<strong>激活（聚焦）后</strong>滚轮等价于 ↑/↓，未激活时滚轮留给页面滚动。</li>
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

	/* 原生分支：基础样式来自 @tailwindcss/forms，这里只对齐卡片宽度 */
	:global(.demo-native-input) {
		box-sizing: border-box;
		width: 100%;
	}

	form {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1ch;
	}

	form .secondary-button {
		margin-top: 0;
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
