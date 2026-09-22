<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import CodeEditor from '#lib/components/widgets/inputs/CodeEditor.svelte';
	import { formatDebugValue } from '../codeArea/format';
	import {
		mergeCodeAreaSnapshot,
		readCodeAreaSource,
		type CodeAreaSource
	} from '../codeArea/source';

	/**
	 * CodeArea：**一块可编辑文本 + 一份数据的双向同步**，默认当作 viewport 组的
	 * file tab 打开（VSCode 打开文件那种感觉）。
	 *
	 * 数据流（详见 `docs/code-area.md`）：
	 *
	 * ```
	 * source.read() ──(实时，读 $state)──► 格式化文本 ──► draft ──bind:value──► CodeEditor
	 *                                                      │
	 *                       value(提交值) ◄── 提交 ────────┤
	 *                  realtimeValue(实时值) ◄── 每次按键 ──┘
	 * ```
	 *
	 * ⚠️ 这里的 `value` 是**提交值**，与 `Input` / `InputNumber` / `CodeEditor` 的
	 * `value`（实时值）语义相反——外部绑定优先用 `value`，要每次按键就用
	 * `realtimeValue`。提交只发生在事件处理器里（按钮 / Ctrl+S），**不能**做成
	 * 「draft 一变就写回 value」的 `$effect`，那会撞 `effect_update_depth_exceeded`。
	 */
	interface Props {
		/** 数据源。缺失不空白：显示原因（旧布局里的面板可能指向已注销的源）。 */
		source?: CodeAreaSource;
		/** **提交值**（不是实时值）。 */
		value?: string;
		/** 实时值：每次按键都同步（高频，别拿它当持久化入口）。 */
		realtimeValue?: string;
		/** 只读；缺省跟随 `source.write` 是否存在。 */
		readonly?: boolean;
	}

	let { source, value = $bindable(''), realtimeValue = $bindable(''), readonly }: Props = $props();

	/** 实时值落进编辑器的去抖窗口（见 `scheduleLive`）。 */
	const LIVE_DEBOUNCE_MS = 250;

	/** 编辑器里的文本（未提交）。 */
	let draft = $state('');
	/** 上次提交 / 同步的文本；`draft !== committed` 就是「未提交」。 */
	let committed = $state('');	/** 异步快照（`source.load()`）与它的加载状态。 */
	let asyncExtra = $state<Record<string, unknown> | undefined>(undefined);
	let loading = $state(false);
	let loadError = $state<string | undefined>(undefined);
	let commitError = $state<string | undefined>(undefined);
	/** 防止卸载 / 连续刷新后，先到的旧结果覆盖新结果。 */
	let refreshToken = 0;

	const isReadonly = $derived(readonly ?? source?.write === undefined);
	const title = $derived(source?.title ?? 'CodeArea');	const snapshot = $derived(mergeCodeAreaSnapshot(readCodeAreaSource(source), asyncExtra));
	const formatted = $derived(formatDebugValue(snapshot));
	const liveText = $derived(formatted.text);
	const dirty = $derived(draft !== committed);

	/**
	 * 拉一次异步快照。`source.load` 是可选的，且**只在打开面板与点「刷新」时**跑：
	 * 一次性的 KV / blob 不适合放进实时路径。
	 */
	async function refresh(): Promise<void> {
		const target = source;
		if (!target?.load) return;
		const token = ++refreshToken;
		loading = true;
		loadError = undefined;
		try {
			const extra = await target.load();
			if (token !== refreshToken) return;
			asyncExtra = extra;
		} catch (error) {
			console.debug('[gpen] ignored rejection: CodeArea load', target.id, error);
			if (token !== refreshToken) return;
			loadError = String(error);
		} finally {
			if (token === refreshToken) loading = false;
		}
	}

	/** 提交：写回数据源 + 两个对外通道。只读 / 未改动时是 no-op。 */
	function commit(): void {
		if (isReadonly || !dirty) return;
		const target = source;
		if (target?.write) {
			try {
				target.write(draft);
			} catch (error) {
				console.debug('[gpen] ignored rejection: CodeArea write', target.id, error);
				commitError = String(error);
				return;
			}
		}
		commitError = undefined;
		committed = draft;
		value = draft;
	}

	/** 编辑器里按 Ctrl+S = 提交这一块文本（工作区的 `Ctrl+S` 在文本输入里是让路的）。
	 * 监听挂在 action 里而不是 `onkeydown` 属性上：面板根是普通 div，模板事件属性会
	 * 触发 a11y 规则，而这里只需要「焦点在本面板内时才抢先处理」。 */
	function codeAreaKeydown(node: HTMLElement) {
		node.addEventListener('keydown', handleKeydown);
		return {
			destroy() {
				node.removeEventListener('keydown', handleKeydown);
			}
		};
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key.toLowerCase() !== 's' || !(event.ctrlKey || event.metaKey)) return;
		if (isReadonly || !dirty) return;
		event.preventDefault();
		commit();
	}

	// 打开 / 源变化时拉一次异步快照。
	$effect(() => {
		void refresh();
	});

	// 首屏把快照交给编辑器与两个对外通道；之后按 `LIVE_DEBOUNCE_MS` 去抖跟随实时值。
	// untrack：这里读写 draft/committed 不该让 effect 自己再跑一遍。
	let initialized = false;
	let latestLive = '';
	let liveTimer: ReturnType<typeof setTimeout> | undefined;

	function applyLive(next: string): void {
		untrack(() => {
			if (!initialized) {
				initialized = true;
				draft = next;
				committed = next;
				value = next;
				realtimeValue = next;
				return;
			}
			// 用户动过就不覆盖（不丢输入；冲突提示暂缺，见 docs/code-area.md）。
			if (draft === committed) {
				draft = next;
				committed = next;
			}
		});
	}

	/**
	 * 去抖：一次更新 = 一次 CodeMirror 整篇替换 + 重排，这是这条链路上最贵的一步。
	 * 实时视图不需要每帧落一次（预览时拖滑条、pinch、滚动都会高频改状态），
	 * 所以只在这里限频；首屏仍然立即显示，不然面板会空白半秒。
	 */
	function scheduleLive(next: string): void {
		latestLive = next;
		if (!initialized) {
			applyLive(next);
			return;
		}
		if (liveTimer !== undefined) clearTimeout(liveTimer);
		liveTimer = setTimeout(() => {
			liveTimer = undefined;
			applyLive(latestLive);
		}, LIVE_DEBOUNCE_MS);
	}

	$effect(() => {
		scheduleLive(liveText);
	});

	// draft → realtimeValue：每次按键都同步，`Object.is` 守卫防回声（同 CodeEditor）。
	$effect(() => {
		if (realtimeValue !== draft) realtimeValue = draft;
	});

	onDestroy(() => {
		refreshToken += 1;
		if (liveTimer !== undefined) clearTimeout(liveTimer);
	});
</script>

<div class="blender-panel blender-panel-codearea" use:codeAreaKeydown>
	<div class="codearea-bar">
		<span class="codearea-title" title={source ? `${title}（${source.id}）` : title}>{title}</span>
		{#if isReadonly}
			<span class="codearea-badge">只读</span>
		{/if}
		{#if dirty}
			<span class="codearea-badge codearea-badge-dirty">未提交</span>
		{/if}
		{#if loading}
			<span class="codearea-badge">读取中…</span>
		{/if}
		{#if formatted.truncated}
			<span class="codearea-badge" title="完整 {formatted.fullLength} 字符">
				已截断 {formatted.fullLength} 字符
			</span>
		{/if}
		{#if formatted.omitted > 0}
			<span class="codearea-badge" title="受 maxEntries / maxDepth 限制">省略 {formatted.omitted} 项</span>
		{/if}
		{#if loadError}
			<span class="codearea-badge codearea-badge-error" title={loadError}>异步快照失败</span>
		{/if}
		{#if commitError}
			<span class="codearea-badge codearea-badge-error" title={commitError}>提交失败</span>
		{/if}
		<span class="codearea-spacer"></span>
		<button
			class="gpen-panel-button codearea-action"
			type="button"
			disabled={!source?.load || loading}
			title="重新读取异步快照（KV）"
			onclick={() => void refresh()}
		>
			刷新
		</button>
		<button
			class="gpen-panel-button codearea-action"
			type="button"
			disabled={isReadonly || !dirty}
			title={isReadonly ? '只读数据源' : '提交（Ctrl+S）'}
			onclick={commit}
		>
			提交
		</button>
	</div>

	<div class="codearea-editor">
		<CodeEditor
			bind:value={draft}
			readonly={isReadonly}
			preserveViewOnExternalChange
			aria-label={`${title} 文本`}
			spellcheck={false}
		/>
	</div>
</div>

<style>
	.blender-panel-codearea {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.codearea-bar {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		gap: 0.5ch;
		box-sizing: border-box;
		height: 2.2lh;
		padding: 0 0.75ch;
		border-bottom: 1px solid var(--gpen-panel-border);
		background: var(--gpen-chrome-background);
		overflow: hidden;
	}

	.codearea-title {
		font-weight: 600;
		white-space: nowrap;
	}

	.codearea-badge {
		flex: 0 0 auto;
		padding: 0 0.5ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius-sm);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-muted);
		font-size: 11px;
		white-space: nowrap;
	}

	.codearea-badge-dirty {
		border-color: var(--gpen-panel-accent);
		color: var(--gpen-panel-accent);
	}

	.codearea-badge-error {
		border-color: var(--gpen-danger);
		color: var(--gpen-danger);
	}

	.codearea-spacer {
		flex: 1 1 auto;
	}

	.codearea-action {
		flex: 0 0 auto;
		height: 1.7lh;
	}

	.codearea-editor {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}

	/* CodeEditor 只给 `.cm-content` 一个 min-height，默认不撑满父容器；这里把 flex 链
	 * 补全（**每层都要 column + min-height:0**，row 方向下 CM 会把行高算成内容高度，
	 * 结果是 `.cm-scroller` 不溢出、滚轮直接穿透到底下的 web layer），滚动交给
	 * CM 自己的 `.cm-scroller`（`overflow: auto` 在它的 theme 里）。
	 * 注意 `.code-editor__host` 是 CodeEditor 内部那个挂 CM 的 div，链上不能跳过它。 */
	.codearea-editor :global(.code-editor) {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
	}

	.codearea-editor :global(.code-editor__host) {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
	}

	.codearea-editor :global(.cm-editor) {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		overflow: hidden;
		border: 0;
		border-radius: 0;
	}

	.codearea-editor :global(.cm-scroller) {
		flex: 1 1 auto;
		min-height: 0;
	}
</style>
