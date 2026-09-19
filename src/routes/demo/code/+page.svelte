<script lang="ts">
	import { onMount } from 'svelte';

	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { EditorState, type Extension } from '@codemirror/state';
	import { drawSelection, EditorView, keymap } from '@codemirror/view';

	import CodeEditor from '#lib/components/widgets/inputs/CodeEditor.svelte';
	import { numberScrubber } from '#lib/inputs/codemirror/numberScrubber';
	import { numberStepper } from '#lib/inputs/codemirror/numberStepper';

	// ① 直接手搓 EditorView 的两个扩展 demo。
	// 两个扩展都复用 InputNumber 的纯函数（stepAtCaret / scrubValue），只多了一层
	// CodeMirror 接线（找 token、dispatch 事务、widget 拖拽）。
	let singleHost = $state<HTMLDivElement>();
	let multiHost = $state<HTMLDivElement>();
	const views: EditorView[] = [];

	function theme(height: string) {
		return EditorView.theme({
			'&': {
				height,
				border: '1px solid var(--gpen-panel-border)',
				borderRadius: 'var(--gpen-radius)',
				background: 'var(--gpen-panel-background)',
				color: 'var(--gpen-panel-foreground)',
				fontSize: 'var(--gpen-font-size)',
			},
			'&.cm-focused': {
				outline: 'none',
				borderColor: 'var(--gpen-panel-accent)',
				boxShadow: '0 0 0 1px rgb(79 70 229 / 0.18)',
			},
			'.cm-scroller': {
				overflow: 'auto',
				fontFamily: 'var(--gpen-font-mono)',
				lineHeight: 'var(--gpen-line-height)',
			},
			'.cm-content': { padding: '0.4lh 0' },
			'.cm-line': { padding: '0 1ch' },
		});
	}

	function baseExtensions(extra: Extension): Extension {
		return [history(), drawSelection(), keymap.of([...defaultKeymap, ...historyKeymap]), extra];
	}

	onMount(() => {
		if (singleHost === undefined || multiHost === undefined) return;
		const single = new EditorView({
			state: EditorState.create({
				doc: '9.98',
				extensions: baseExtensions([
					numberStepper({ lower: 0, upper: 100, decimals: 2 }),
					numberScrubber({ lower: 0, upper: 100 }),
					theme('3lh'),
				]),
			}),
			parent: singleHost,
		});
		const multi = new EditorView({
			state: EditorState.create({
				doc: '长度 12.5\n宽度 8.0',
				extensions: baseExtensions([numberStepper(), numberScrubber(), theme('6lh')]),
			}),
			parent: multiHost,
		});
		views.push(single, multi);
		single.focus();
		return () => {
			for (const view of views) view.destroy();
			views.length = 0;
		};
	});

	// ② CodeEditor 组件本身的 demo（表单关联、disabled/readonly、maxlength、注入扩展）。
	// 一次性建好扩展数组：`extensions` 每次传新数组都会让配置 compartment 重配，
	// 实例复用更省事（numberStepper 本身无状态，重配也不会丢什么，只是没必要）。
	const stepperExtensions = [numberStepper({ lower: 0, upper: 100, decimals: 2 })];

	let note = $state('');
	let numeric = $state('9.98');
	let formNote = $state('');
	let formDisabled = $state(false);
	let formReadonly = $state(false);
	let submitted = $state('尚未提交');

	// 外部改值：演示 `value` 是唯一真值源（外部写入 → 文档整篇替换；CM 的 undo 历史保留）。
	function writeFromOutside() {
		note = '外部写入的内容';
	}

	function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const data = new FormData(form);
		const entries = [...data.entries()].map(([key, entry]) => `${key}=${JSON.stringify(entry)}`);
		submitted = entries.length === 0 ? '提交成功：FormData 为空' : `提交成功：${entries.join('，')}`;
	}
</script>

<svelte:head><title>CodeMirror 6 编辑器 · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">gpen · codemirror</p>
		<h1>CodeMirror 6 编辑器</h1>
		<p class="intro">
			两部分共用同一套 CodeMirror 6 底座：上半节把 <code>numberStepper</code> /
			<code>numberScrubber</code> 两个扩展直接挂到手搓的 <code>EditorView</code> 上，
			下半节演示仓库里的 <code>CodeEditor</code> 组件（CM 文档 ⇄ 表单值接线）。
		</p>
	</header>

	<section class="section" data-number-plugins>
		<h2 class="section-title">数值插件（直接挂 EditorView）</h2>
		<p class="section-intro">
			把 InputNumber 的「按位权步进」抽成 CodeMirror 扩展：<code>numberStepper</code> 用方向键步进光标下的数字，
			<code>numberScrubber</code> 渲染一个 2ch 宽的 <code>±</code> 把手，拖拽改变数值。两者都直接调用
			<code>#lib/inputs/numericCaret</code> / <code>numericScrub</code> 的纯函数，不重复实现步进逻辑。
		</p>

		<div class="cards">
			<article class="card">
				<h3>单行文本</h3>
				<p>
					整篇只有一行时，<code>↑</code>/<code>↓</code> 直接步进光标下的数字（<code>←</code>/<code>→</code>
					仍是原生光标移动）。拖拽右侧的 <code>±</code> 把手连着改值。min/max 是 soft 边界，只限制步进。
				</p>
				<div class="editor" bind:this={singleHost}></div>
			</article>

			<article class="card">
				<h3>多行文本</h3>
				<p>
					多行文档里方向键默认导航光标；<strong>点亮 CapsLock 后</strong>，<code>↑</code>/<code>→</code> 步进
					<code>+1</code>、<code>↓</code>/<code>←</code> 步进 <code>-1</code>。把光标放进某个数字里再试。
				</p>
				<div class="editor" bind:this={multiHost}></div>
			</article>
		</div>
	</section>

	<section class="section">
		<h2 class="section-title">CodeEditor 组件（CM 文档 ⇄ 表单值）</h2>
		<p class="section-intro">
			<code>CodeEditor</code> 用 CodeMirror 6 承载多行文本，表单关联靠一个
			<code>hidden</code> 的真 <code>&lt;textarea&gt;</code> 镜像（不是
			<code>type="hidden"</code>，也不是 <code>&lt;noscript&gt;</code>，原因见
			<code>docs/code-editor.md</code>）。镜像参与 <code>FormData</code> / <code>required</code> /
			<code>checkValidity()</code>，但 <code>display:none</code> 不占布局、不进无障碍树。
		</p>

		<div class="cards">
			<article class="card">
				<h3>双向绑定与占位符</h3>
				<p>
					打字写回 <code>bind:value</code>；点「外部改值」直接改绑定值，编辑器整篇替换
					（不是重建 EditorView），所以 <code>Ctrl+Z</code> 还能撤销回自己刚写的内容。
				</p>
				<CodeEditor
					bind:value={note}
					aria-label="笔记"
					placeholder="写点什么…"
					rows={4}
					spellcheck="false"
				/>
				<div class="row">
					<button type="button" class="secondary-button" onclick={writeFromOutside}>
						外部改值
					</button>
					<output aria-live="polite">{note === '' ? '（空）' : note}</output>
				</div>
			</article>

			<article class="card">
				<h3>表单关联（hidden 镜像）</h3>
				<p>
					提交时读的是镜像 textarea 的值：<code>required</code> 空值会拦住提交，
					<code>disabled</code> 会退出 FormData，<code>readonly</code> 仍会提交。
					<code>maxlength={20}</code> 由 CM 的 <code>changeFilter</code> 拒绝超长事务（键入与粘贴都拦）。
				</p>
				<form data-textarea-form onsubmit={handleSubmit}>
					<CodeEditor
						bind:value={formNote}
						aria-label="表单备注"
						name="note"
						required
						maxlength={20}
						rows={3}
						disabled={formDisabled}
						readonly={formReadonly}
					/>
					<div class="row">
						<label><input type="checkbox" bind:checked={formDisabled} /> 禁用编辑器</label>
						<label><input type="checkbox" bind:checked={formReadonly} /> 只读编辑器</label>
						<button type="submit" class="secondary-button">提交</button>
					</div>
					<output aria-live="polite">{submitted}</output>
				</form>
			</article>

			<article class="card">
				<h3>注入扩展（numberStepper）</h3>
				<p>
					<code>extensions</code> 把调用方的语言 / 扩展原样并进编辑器，这里挂上
					<code>numberStepper</code>：单行文档里 <code>↑</code>/<code>↓</code> 按光标位权步进数字。
				</p>
				<CodeEditor bind:value={numeric} aria-label="数值扩展" rows={1} extensions={stepperExtensions} />
				<output aria-live="polite">{numeric}</output>
			</article>

			<article class="card">
				<h3>只读与禁用</h3>
				<p>
					只读（<code>EditorState.readOnly</code>）仍可选中复制、仍会提交；禁用
					（<code>EditorView.editable.of(false)</code> + <code>aria-disabled</code>）只用于展示。
				</p>
				<div class="pair">
					<CodeEditor value="只读：可选中复制，不能改" aria-label="只读示例" readonly rows={2} />
					<CodeEditor value="禁用：不参与编辑" aria-label="禁用示例" disabled rows={2} />
				</div>
			</article>
		</div>
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
		margin-bottom: 2lh;
	}

	.eyebrow {
		margin: 0 0 0.5lh;
		color: var(--gpen-panel-accent);
		font-size: 0.85em;
		font-weight: 700;
		letter-spacing: 0.12ch;
		text-transform: uppercase;
	}

	h1 {
		margin: 0 0 0.75lh;
		font-size: 2em;
		line-height: 1.1;
	}

	.intro {
		max-width: 74ch;
		margin: 0;
		color: #475569;
		line-height: 1.6;
	}

	.section {
		margin-bottom: 3lh;
	}

	.section-title {
		margin: 0 0 0.5lh;
		font-size: 1.35em;
	}

	.section-intro {
		max-width: 74ch;
		margin: 0 0 1.5lh;
		color: #475569;
		line-height: 1.6;
	}

	.cards {
		display: grid;
		gap: 1.5lh;
	}

	.card {
		box-sizing: border-box;
		padding: 1.25lh 1.5ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.75lh;
		background: var(--gpen-panel-background);
		box-shadow: 0 0.5lh 1.5lh rgb(15 23 42 / 0.08);
	}

	.card h3 {
		margin: 0 0 0.35lh;
		font-size: 1.1em;
	}

	.card p {
		margin: 0 0 1lh;
		color: var(--gpen-panel-muted);
		line-height: 1.5;
	}

	.editor {
		display: block;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 1ch;
		margin-top: 1lh;
	}

	.pair {
		display: grid;
		gap: 1lh;
	}

	form {
		display: grid;
		gap: 0;
	}

	output {
		padding: 0.25lh 0.75ch;
		border-radius: 0.35lh;
		background: #eef2ff;
		color: #3730a3;
		font-variant-numeric: tabular-nums;
	}

	.secondary-button {
		margin: 0;
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

	label {
		display: inline-flex;
		align-items: center;
		gap: 0.5ch;
		color: var(--gpen-panel-muted);
	}
</style>
