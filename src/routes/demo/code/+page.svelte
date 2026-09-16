<script lang="ts">
	import { onMount } from 'svelte';

	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { EditorState, type Extension } from '@codemirror/state';
	import { drawSelection, EditorView, keymap } from '@codemirror/view';

	import { numberScrubber } from '#lib/inputs/codemirror/numberScrubber';
	import { numberStepper } from '#lib/inputs/codemirror/numberStepper';

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
</script>

<svelte:head><title>CodeMirror 数字步进 · gpen</title></svelte:head>

<main>
	<header class="page-header">
		<p class="eyebrow">gpen · codemirror</p>
		<h1>CodeMirror 6 数值插件</h1>
		<p class="intro">
			把 InputNumber 的「按位权步进」抽成 CodeMirror 扩展：<code>numberStepper</code> 用方向键步进光标下的数字，
			<code>numberScrubber</code> 渲染一个 2ch 宽的 <code>±</code> 把手，拖拽改变数值。两者都直接调用
			<code>#lib/inputs/numericCaret</code> / <code>numericScrub</code> 的纯函数，不重复实现步进逻辑。
		</p>
	</header>

	<section class="cards">
		<article class="card">
			<h2>单行文本</h2>
			<p>
				整篇只有一行时，<code>↑</code>/<code>↓</code> 直接步进光标下的数字（<code>←</code>/<code>→</code>
				仍是原生光标移动）。拖拽右侧的 <code>±</code> 把手连着改值。min/max 是 soft 边界，只限制步进。
			</p>
			<div class="editor" bind:this={singleHost}></div>
		</article>

		<article class="card">
			<h2>多行文本</h2>
			<p>
				多行文档里方向键默认导航光标；<strong>点亮 CapsLock 后</strong>，<code>↑</code>/<code>→</code> 步进
				<code>+1</code>、<code>↓</code>/<code>←</code> 步进 <code>-1</code>。把光标放进某个数字里再试。
			</p>
			<div class="editor" bind:this={multiHost}></div>
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
		max-width: 70ch;
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

	.editor {
		display: block;
	}
</style>
