<script lang="ts">
	import Input from '#lib/components/widgets/inputs/Input.svelte';
	import { STD_UNITS, type Dimension } from '#lib/inputs/units';

	// 无换算需求的纯标签单位：`units` 收一张「单量纲表」，显示单位缺省取它的 base，
	// 所以一张恒等表就等价于「只是把 % / px 显示在旁边」。
	const PERCENT: Dimension = { base: '%', units: { '%': 1 } };
	const PIXEL: Dimension = { base: 'px', units: { px: 1 } };

	let horizontalValue = $state(42);
	let fineValue = $state(23.45);
	let illegalValue = $state(23.45);
	let verticalValue = $state(25);
	let textValue = $state('画笔名称');
	let formValue = $state(3);
	let disabled = $state(true);
	let sliderValue = $state(9.98);
	let fractionValue = $state(0.009);
	let validDemoValue = $state(5);
	let validDemoOutput = $state<number | undefined>(5);
	let lengthInMeters = $state(0.12);
	let massInKg = $state(1.234);
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
					<p>范围 0–100，步长 1；把光标放到某一位后 ↑/↓ 按该位量级步进，caret 在最左侧时改首位数字（<code>^90</code> ↑ → <code>^100</code>、<code>^100</code> ↓ → <code>^90</code>）；caret 贴在最左/最右时 ←/→ 按配置 step 减/加。Home/End 按两次跳 min/max；悬浮在控件上、且未聚焦时按 Delete（激活后 Delete 为原生删除）或在控件上右键选「重置为默认值」回到初始值 42。</p>
				</div>
				<output aria-live="polite">{horizontalValue}%</output>
			</div>
			<Input
				bind:value={horizontalValue}
				aria-label="强度"
				min={0}
				max={100}
				step={1}
				units={PERCENT}
				onchange={(event) => recordChange('强度', event)}
			/>
		</article>

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>精细数值</h2>
					<p>从 23.45 开始：<code>step={0.01}</code> 同时定义步长与提交精度（2 位小数）。把光标放到某一位，↑/↓ 按该位量级步进；− / + 按钮、caret 贴边 ←/→ 与滑条中央分区都按 <code>step</code> 步进。</p>
				</div>
				<output aria-live="polite">{Number.isNaN(fineValue) ? 'NaN' : fineValue.toFixed(2)}</output>
			</div>
			<Input
				bind:value={fineValue}
				aria-label="不透明度"
				min={-1000}
				max={1000}
				step={0.01}
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
				units={PIXEL}
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

		<article class="demo-card">
			<div class="card-heading">
				<div>
					<h2>validValue 输出通道</h2>
					<p>
						<code>min=0 max=10</code>：输入 <code>150</code> 时绑定值仍是 150（打字不钳），
						<code>onvalidvalue</code> 给出钳好的 <code>10</code>；文本改成非数字（如 <code>1.2.3</code>）时
						通道给 <code>undefined</code>（不下发 NaN）。不按 <code>step</code> 取整。
					</p>
				</div>
				<output aria-live="polite">{validDemoOutput ?? 'undefined'}</output>
			</div>
			<Input
				bind:value={validDemoValue}
				aria-label="validValue 演示"
				min={0}
				max={10}
				step={1}
				onvalidvalue={(next) => (validDemoOutput = next)}
			/>
			<p class="inline-value">绑定值：<strong>{validDemoValue}</strong>（原样保留，未被钳制）</p>
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>无极滑条（InputSlider）</h2>
					<p>点击 / 轻触走原生 focus，激活 InputNumber 编辑模式；长按或拖拽进入 scrub。<strong>滑条沿轴平均分三段</strong>，按下时落点所在的那段决定步进规则（松开前不变）：靠近 − 用智能整数位（<code>1.12 → 0.12 → 0.02 → 0.01 → 0.009</code>），中央按 <code>step</code>，靠近 + 用用户输入的最大精度（<code>0.499 → 0.500 → 0.501</code>）。浮层按 min/max 显示比例，悬浮或拖拽时显示三段分区。</p>
				</div>
				<output aria-live="polite">{sliderValue}</output>
			</div>
			<Input bind:value={sliderValue} aria-label="滑条数值" min={0} max={100} step={0.01} />
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>单位（质量：只给 <code>units</code>）</h2>
					<p>传一张量纲表时，显示单位就是它的 <code>base</code>（此处 <code>kg</code>）。敲 <code>1234克</code> 或
						<code>1234 克</code>（两侧空格无所谓）会在输入过程中就地换算成 <code>1.234</code>，右侧
						<code>kg</code> 只是只读标签，二次编辑只会改到数字。不认识的单位（如 <code>12 xyz</code>）不换算，
						按既有的非数字 → 红底 <code>:invalid</code> 处理。</p>
				</div>
				<output aria-live="polite">{massInKg} kg</output>
			</div>
			<Input bind:value={massInKg} units={STD_UNITS.mass} min={0} step={0.001} aria-label="质量" />
		</article>

		<article class="demo-card demo-card-wide">
			<div class="card-heading">
				<div>
					<h2>单位（长度：<code>units</code> + <code>activeUnit</code>）</h2>
					<p><code>activeUnit="cm"</code> 覆盖默认显示单位，而 <code>value</code> 仍以基准单位 <code>m</code> 存储：
						输入 <code>12</code> → <code>value = 0.12</code>；<code>12cm</code> / <code>12 厘米</code> / <code>1 in</code> 都会换算到 cm；
						跨量纲的 <code>2 kg</code> 被拒（不换算，交给 <code>:invalid</code>）。只想要长度这一量纲时
						直接传 <code>units={'{STD_UNITS.length}'}</code> 即可。</p>
				</div>
				<output aria-live="polite">{lengthInMeters} m</output>
			</div>
			<Input
				bind:value={lengthInMeters}
				units={STD_UNITS.length}
				activeUnit="cm"
				min={0}
				max={200}
				step={1}
				aria-label="长度"
			/>
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
					<p>非法文本（以及 <code>min</code>/<code>max</code> 违规）会写进
						<code>input.validity.customError</code>，所以 <code>&lt;form&gt;</code> 的
						<code>checkValidity()</code> / 提交会被浏览器拦下并给出气泡提示。清空后再提交则通过。</p>
				</div>
				<output aria-live="polite">{Number.isNaN(formValue) ? 'NaN' : formValue}</output>
			</div>
			<form onsubmit={recordSubmit}>
				<Input bind:value={formValue} aria-label="表单数值" min={0} max={10} step={1} />
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
			<li>数值 ↑/↓ 按光标所在数字的位权步进；Home/End 第一次移动光标，第二次才在有 min/max 时跳边界。</li>
			<li>caret 在符号区时 <code>-</code> 在 <code>-5</code> / <code>+5</code> 之间切换（保留加号），<code>+</code> 强制为正；<code>^1.0</code> ↓ 会进入智能小数位变成 <code>0.^9</code>。</li>
			<li>鼠标悬浮在数值控件上、且未聚焦时，按裸 Delete 重置为创建时的初值；激活（input 聚焦）后 Delete 恢复原生向后删除。</li>
			<li>数值控件上右键打开自研菜单（重置为默认值 / 设为最小值 / 设为最大值，后两项在没有对应 min/max 时禁用）；其余 <code>&lt;input&gt;</code> 保留浏览器原生右键菜单。</li>
			<li>输入非数字文本时不再强行回退：文本原样保留、背景标 <code>--gpen-danger</code>、绑定值变 NaN，并让 <code>&lt;form&gt;</code> 的原生校验拦截提交；Escape 恢复聚焦快照。</li>
			<li>滑条沿轴平均分成三段，<strong>规则按 pointerdown 的落点锁定</strong>（拖到别的分区也不会换）：靠近 − 的 1/3 用<strong>智能整数位</strong>（<code>1.12 → 0.12 → 0.02 → 0.01 → 0.009</code>，递减会自动退回智能小数位、无限趋近 0），中央 1/3 按配置 <code>step</code>，靠近 + 的 1/3 用<strong>用户输入的最大精度</strong>（<code>0.499 → 0.500 → 0.501</code>）；拖拽每 6px 走一步，方向由位移符号决定。</li>
			<li>−/+ 按钮与 caret 贴边的 ←/→ 按配置 step 调整（<code>step</code> 缺省按 HTML 语义取 1）；显式非数值 step（<code>step="any"</code>）退回用户精度。数值控件<strong>激活（聚焦）后</strong>滚轮等价于 ↑/↓，未激活时滚轮留给页面滚动。</li>
			<li>最近一次提交：<output aria-live="polite">{lastChange}</output></li>
			<li>
				<code>onvalidvalue</code> 是只读的校验结果通道（不做 <code>bind:validValue</code>）：只钳
				<code>min</code>/<code>max</code>、不按 <code>step</code> 取整，非法文本/空值给
				<code>undefined</code>。挂载初值、外部改值与用户输入都会触发。
			</li>
			<li>
				<code>units</code> + <code>activeUnit</code>：<code>value</code> 存<strong>基准单位</strong>，显示与编辑
				用 <code>activeUnit</code>；<code>min</code>/<code>max</code>/<code>step</code> 按显示单位表述。
				粘贴带单位的文本会换算（整段替换），跨量纲或未知单位则不改写。
			</li>
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

	/* 垂直形态：卡片是 flex 列，控件用 flex: 1 1 auto 撑满剩余高度（不会溢出）。 */
	.vertical-card {
		display: flex;
		flex-direction: column;
		height: 25lh;
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
