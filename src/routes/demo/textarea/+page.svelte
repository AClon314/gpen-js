<script lang="ts">
	import TextEditor from '#lib/components/widgets/inputs/TextEditor.svelte';
	import { numberStepper } from '#lib/inputs/codemirror/numberStepper';

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

<svelte:head><title>TextEditor · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">gpen · textarea</p>
		<h1>CodeMirror 6 多行文本</h1>
		<p class="intro">
			<code>TextEditor</code> 用 CodeMirror 6 承载多行文本，表单关联靠一个
			<code>hidden</code> 的真 <code>&lt;textarea&gt;</code> 镜像（不是
			<code>type="hidden"</code>，也不是 <code>&lt;noscript&gt;</code>，原因见
			<code>docs/textarea.md</code>）。镜像参与 <code>FormData</code> / <code>required</code> /
			<code>checkValidity()</code>，但 <code>display:none</code> 不占布局、不进无障碍树。
		</p>
	</header>

	<section class="cards">
		<article class="card">
			<h2>双向绑定与占位符</h2>
			<p>
				打字写回 <code>bind:value</code>；点「外部改值」直接改绑定值，编辑器整篇替换
				（不是重建 EditorView），所以 <code>Ctrl+Z</code> 还能撤销回自己刚写的内容。
			</p>
			<TextEditor
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
			<h2>表单关联（hidden 镜像）</h2>
			<p>
				提交时读的是镜像 textarea 的值：<code>required</code> 空值会拦住提交，
				<code>disabled</code> 会退出 FormData，<code>readonly</code> 仍会提交。
				<code>maxlength={20}</code> 由 CM 的 <code>changeFilter</code> 拒绝超长事务（键入与粘贴都拦）。
			</p>
			<form data-textarea-form onsubmit={handleSubmit}>
				<TextEditor
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
			<h2>注入扩展（numberStepper）</h2>
			<p>
				<code>extensions</code> 把调用方的语言 / 扩展原样并进编辑器，这里挂上
				<code>numberStepper</code>：单行文档里 <code>↑</code>/<code>↓</code> 按光标位权步进数字。
			</p>
			<TextEditor bind:value={numeric} aria-label="数值扩展" rows={1} extensions={stepperExtensions} />
			<output aria-live="polite">{numeric}</output>
		</article>

		<article class="card">
			<h2>只读与禁用</h2>
			<p>
				只读（<code>EditorState.readOnly</code>）仍可选中复制、仍会提交；禁用
				（<code>EditorView.editable.of(false)</code> + <code>aria-disabled</code>）只用于展示。
			</p>
			<div class="pair">
				<TextEditor value="只读：可选中复制，不能改" aria-label="只读示例" readonly rows={2} />
				<TextEditor value="禁用：不参与编辑" aria-label="禁用示例" disabled rows={2} />
			</div>
		</article>
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

	.card h2 {
		margin: 0 0 0.35lh;
		font-size: 1.1em;
	}

	.card p {
		margin: 0 0 1lh;
		color: var(--gpen-panel-muted);
		line-height: 1.5;
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
