<script lang="ts">
	import { onMount } from 'svelte';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	import { defaultKeymap, history, historyKeymap, isolateHistory } from '@codemirror/commands';
	import { Compartment, EditorState, type Extension } from '@codemirror/state';
	import {
		drawSelection,
		EditorView,
		keymap,
		placeholder as cmPlaceholder,
	} from '@codemirror/view';

	// CodeEditor：多行输入统一用的 CodeMirror 6 壳（可注入语言 / 扩展，将来挂语法高亮）。
	//
	// 为什么自研（对照 docs/code-editor.md 的「缺口 + 自研代价」）：原生 <textarea> 除了
	// 撤销栈以外没有任何编辑能力（隐式快捷键、按位权步进、± 拖拽、将来的语法高亮），
	// 也拿不到「光标落在哪一位」这类结构化信息。CM6 已在仓库里（demo/code、
	// numberStepper / numberScrubber），这里只做「CM 文档 ⇄ 表单值」的接线，不重写编辑逻辑。
	//
	// 表单关联**不用** <input type="hidden">（hidden input 被排除在 constraint validation
	// 之外，setCustomValidity 与 required 全部无效），也不用 <noscript>（Svelte 5 的编译器
	// 会静默丢弃它的子节点），改用 `hidden` 的真 <textarea> 镜像：它参与 FormData /
	// required / checkValidity，但 display:none 不占布局、不进无障碍树。

	interface CodeEditorProps
		extends Omit<
			HTMLTextareaAttributes,
			| 'value'
			| 'placeholder'
			| 'disabled'
			| 'readonly'
			| 'required'
			| 'maxlength'
			| 'name'
			| 'form'
			| 'rows'
			| 'wrap'
			| 'class'
		> {
		/** 双向绑定的文本（唯一真值源）。 */
		value?: string;
		disabled?: boolean;
		readonly?: boolean;
		placeholder?: string;
		/** 表单相关：写进镜像 textarea。 */
		name?: string;
		form?: string;
		required?: boolean;
		maxlength?: number;
		/** 可见行数，映射成 `min-height: N * 1lh`（原生 textarea 的默认值是 2）。 */
		rows?: number;
		/** `off` 关闭折行，其余（含缺省）走 `EditorView.lineWrapping`。 */
		wrap?: 'hard' | 'soft' | 'off';
		/** 调用方注入的语言 / 扩展（如 `numberStepper`）。 */
		extensions?: Extension[];
		class?: string;
	}

	// 这些原生 textarea 属性对 CM 无意义，不进 contentAttributes：
	// `cols` 是字符列宽（横向由父容器决定）；`defaultValue` / `dirname` 没有 CM 语义；
	// `minlength` 原生也只做「用户编辑过才提示」的弱校验，不值得在 CM 里复刻。
	const IGNORED_ATTRIBUTES = new Set([
		'cols',
		'defaultValue',
		'defaultvalue',
		'dirname',
		'minlength',
		'rows',
		'wrap',
	]);

	let {
		value = $bindable(''),
		disabled = false,
		readonly = false,
		placeholder = '',
		name,
		form,
		required = false,
		maxlength,
		rows = 2,
		wrap = 'soft',
		extensions = [],
		class: editorClass,
		'aria-label': ariaLabel,
		...rest
	}: CodeEditorProps = $props();

	let host = $state<HTMLDivElement | undefined>();
	let mirror = $state<HTMLTextAreaElement | undefined>();
	// view 不该被深度代理（CM 内部大量身份比较），用 raw 只保留「换实例」这一层响应性。
	let view = $state.raw<EditorView | undefined>(undefined);
	// 「外部值 ⇄ 文档」去重的锚点：只要两者相同就不再派发事务。
	// 它防的是**多余事务**（会推走 caret、污染 undo、形成回声循环），不是重建 EditorView ——
	// 值变化永远只走 view.dispatch，EditorView 只在挂载 / 卸载时创建 / 销毁。
	let observedValue = value;
	// IME 组字期间外部值先缓存（见 value 的 $effect），compositionend 后补发。
	let pendingValue: string | undefined;
	// 外部改值可以超出 maxlength（外部是唯一真值源，超限交给镜像的校验报告）；
	// 这个开关只在那一次 dispatch 期间放行长度过滤器。
	let ignoreLengthFilter = false;

	// 配置类扩展全部塞进一个 compartment：props 变化时 reconfigure 即可，
	// EditorView 与 undo 历史都保留（跨 compartment 的 history() 不会被重置）。
	const config = new Compartment();

	const editorTheme = EditorView.theme({
		'&': {
			boxSizing: 'border-box',
			border: '1px solid var(--gpen-panel-border)',
			borderRadius: 'var(--gpen-radius)',
			background: 'var(--gpen-panel-background)',
			color: 'var(--gpen-panel-foreground)',
			fontSize: 'var(--gpen-font-size)',
			lineHeight: 'var(--gpen-line-height)',
		},
		'&.cm-focused': {
			outline: '2px solid var(--gpen-panel-accent)',
			outlineOffset: '-1px',
		},
		'.cm-scroller': {
			overflow: 'auto',
			fontFamily: 'var(--gpen-font-mono)',
			lineHeight: 'var(--gpen-line-height)',
		},
		// rows → min-height：1lh 只由控件自己的字号 × 行高 token 决定（与宿主页无关）。
		'.cm-content': {
			minHeight: 'calc(var(--gpen-code-rows, 2) * 1lh)',
			padding: '0.4lh 0',
		},
		'.cm-line': { padding: '0 1ch' },
		'.cm-placeholder': { color: 'var(--gpen-panel-muted)' },
	});

	/** 长度校验消息（也用于 CM 侧 changeFilter 的判据）。 */
	function validityMessage(text: string, limit: number | undefined): string {
		if (limit !== undefined && text.length > limit) return `最多 ${limit} 个字符`;
		return '';
	}

	/** 镜像 textarea 是 FormData / required / checkValidity 的载体，值随文档走。 */
	function syncMirror(text: string) {
		const element = mirror;
		if (element === undefined) return;
		element.value = text;
		element.setCustomValidity(validityMessage(text, maxlength));
	}

	/** 透传剩余原生属性（spellcheck / autocomplete / id / data-* / aria-* …）到 CM 的内容元素。 */
	function passthroughAttributes(): Record<string, string> {
		const attributes: Record<string, string> = {};
		for (const [key, attribute] of Object.entries(rest)) {
			// 事件处理器（oninput 等）不能当字符串属性写进 contentAttributes，直接放掉。
			if (typeof attribute === 'function' || attribute === undefined || attribute === null) continue;
			if (IGNORED_ATTRIBUTES.has(key)) continue;
			attributes[key] = String(attribute);
		}
		return attributes;
	}

	function contentAttributes(): Record<string, string> {
		const attributes = passthroughAttributes();
		if (typeof ariaLabel === 'string') attributes['aria-label'] = ariaLabel;
		if (disabled) {
			attributes['aria-disabled'] = 'true';
			attributes.tabindex = '-1';
		}
		return attributes;
	}

	/** CM 侧的长度闸门：拒绝让文档超过 maxlength 的事务（键入与粘贴都会经过它）。 */
	function lengthFilter(limit: number): Extension {
		return EditorState.changeFilter.of((transaction) => {
			if (ignoreLengthFilter) return true;
			return transaction.newDoc.length <= limit;
		});
	}

	function configExtensions(): Extension[] {
		const list: Extension[] = [
			EditorView.editable.of(!disabled),
			EditorState.readOnly.of(readonly),
			EditorView.contentAttributes.of(contentAttributes()),
		];
		if (placeholder !== '') list.push(cmPlaceholder(placeholder));
		if (wrap !== 'off') list.push(EditorView.lineWrapping);
		if (maxlength !== undefined) list.push(lengthFilter(maxlength));
		list.push(...extensions);
		return list;
	}

	/** 外部值 → 文档：整篇替换（不重建 view，undo 历史保留）。 */
	function writeExternal(current: EditorView, next: string) {
		if (current.state.doc.toString() === next) return;
		ignoreLengthFilter = true;
		try {
			current.dispatch({
				changes: { from: 0, to: current.state.doc.length, insert: next },
				// 外部改值是独立的一步 undo：不加注解时 CM 会把它并进 500ms 内上一次键入
				// （无 userEvent 的事务仍是 joinable），一次 Ctrl+Z 会把用户刚打的字也撤掉。
				annotations: isolateHistory.of('full'),
				// 屏幕阅读器只在编辑器未聚焦时播报外部改值（聚焦时用户正看着 caret）。
				effects: current.hasFocus ? [] : EditorView.announce.of(next === '' ? '已清空' : next),
			});
		} finally {
			ignoreLengthFilter = false;
		}
	}

	// 文档 → 绑定值 / 镜像。`doc.toString()` 只在 docChanged 时物化一次。
	const documentListener = EditorView.updateListener.of((update) => {
		if (!update.docChanged) return;
		const text = update.state.doc.toString();
		observedValue = text;
		value = text;
		syncMirror(text);
	});

	// 组字结束后补发被缓存的外部值；期间打断会重置候选窗、重复字符、把 caret 弹走。
	const compositionHandlers = EditorView.domEventHandlers({
		compositionend: () => {
			const next = pendingValue;
			pendingValue = undefined;
			if (next !== undefined && view !== undefined) writeExternal(view, next);
		},
	});

	onMount(() => {
		if (host === undefined) return;
		const created = new EditorView({
			state: EditorState.create({
				doc: value,
				extensions: [
					history(),
					drawSelection(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					compositionHandlers,
					documentListener,
					editorTheme,
					config.of(configExtensions()),
				],
			}),
			parent: host,
		});
		view = created;
		observedValue = value;
		syncMirror(value);
		return () => {
			created.destroy();
			view = undefined;
		};
	});

	// 外部改值：同一个值直接 return（回声守卫）；组字期间缓存，结束后补发。
	$effect(() => {
		const current = view;
		const next = value;
		if (current === undefined) return;
		if (Object.is(next, observedValue)) return;
		observedValue = next;
		if (current.composing) {
			pendingValue = next;
			return;
		}
		writeExternal(current, next);
	});

	// 配置变化：reconfigure compartment，不重建 EditorView（不丢 undo 历史）。
	$effect(() => {
		const current = view;
		const next = configExtensions();
		if (current === undefined) return;
		current.dispatch({ effects: config.reconfigure(next) });
	});

	// maxlength 变化要重算镜像的 custom validity；文档变化由 documentListener 负责。
	$effect(() => {
		const element = mirror;
		const current = view;
		if (element === undefined || current === undefined) return;
		element.value = current.state.doc.toString();
		element.setCustomValidity(validityMessage(element.value, maxlength));
	});
</script>

<div
	class={`code-editor${disabled ? ' disabled' : ''}${editorClass ? ` ${editorClass}` : ''}`}
	style="--gpen-code-rows: {rows ?? 2}"
	data-code-editor
>
	<div class="code-editor__host" bind:this={host}></div>
	<!-- 表单镜像：hidden 的真 <textarea>，参与 FormData / required / checkValidity。 -->
	<textarea
		bind:this={mirror}
		hidden
		aria-hidden="true"
		tabindex="-1"
		{name}
		{form}
		{required}
		{maxlength}
		{disabled}
		{readonly}
	></textarea>
</div>

<style>
	.code-editor {
		display: block;
	}

	/* 尺寸全交给 CM 的 theme（min-height = rows × 1lh），这里只统一「禁用」观感。 */
	.code-editor.disabled :global(.cm-editor) {
		opacity: 0.55;
	}

	.code-editor.disabled :global(.cm-content) {
		cursor: default;
	}
</style>
