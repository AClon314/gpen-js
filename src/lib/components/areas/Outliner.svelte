<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-layers.js';
	import { untrack } from 'svelte';

	import { LAYER_NODE_GROUP, type UiLayerTree } from '#lib/layers/types';
	import {
		applyDrop,
		dropTargetFromPoint,
		nextFocusKey,
		rowByKey,
		selectionAfter,
		typeaheadKey,
		visibleRows,
		type DropTarget,
		type TreeKey,
		type TreeMove,
		type TreeOp,
		type TreeRow
	} from '#lib/layers/tree/index.js';

	// 受控三件套（见 docs/tree.md §3.4）：`*Keys` 存在时它就是唯一真相（default 只作初值），
	// 回调**总是**触发 —— 非受控用法靠它把新值写回本地 state。
	interface OutlinerProps {
		tree?: UiLayerTree | null;
		selectedKeys?: ReadonlySet<TreeKey>;
		defaultSelectedKeys?: ReadonlySet<TreeKey>;
		onSelectionChange?: (keys: Set<TreeKey>) => void;
		activeKey?: TreeKey;
		onActivate?: (key: TreeKey) => void;
		expandedKeys?: ReadonlySet<TreeKey>;
		defaultExpandedKeys?: ReadonlySet<TreeKey>;
		onExpandedChange?: (keys: Set<TreeKey>) => void;
		onRename?: (key: TreeKey, name: string) => void;
		onMove?: (ops: TreeOp[]) => void;
	}

	let {
		tree = null,
		selectedKeys,
		defaultSelectedKeys,
		onSelectionChange,
		activeKey,
		onActivate,
		expandedKeys,
		defaultExpandedKeys,
		onExpandedChange,
		onRename,
		onMove
	}: OutlinerProps = $props();

	const root = $derived(tree?.root ?? null);
	const activeRowKey = $derived(activeKey ?? tree?.active_node?.node_index);

	// `default*` 只作初值，所以显式 untrack（受控值变化时不应重置本地 state）。
	let localSelected = $state<Set<TreeKey>>(
		untrack(() => new Set(defaultSelectedKeys ?? []))
	);
	const selected = $derived(selectedKeys ?? localSelected);
	let localExpanded = $state<Set<TreeKey>>(
		untrack(() => new Set(defaultExpandedKeys ?? []))
	);
	const expanded = $derived(expandedKeys ?? localExpanded);

	/// 扁平化只有一个入口（docs/tree.md §3.5）：折叠的子树不进 rows。
	const rows = $derived(visibleRows(root, expanded));

	/// roving tabindex：只有一行 tabindex=0，其余 -1。
	let focusKey = $state<TreeKey | undefined>(undefined);
	const tabbableKey = $derived(
		focusKey !== undefined && rowByKey(rows, focusKey) !== undefined
			? focusKey
			: activeRowKey !== undefined && rowByKey(rows, activeRowKey) !== undefined
				? activeRowKey
				: rows[0]?.key
	);

	/** 每级缩进 = 2ch（行内 padding-left 用同一常量，见下方模板）。 */
	const INDENT_CH = 2;
	const TYPEAHEAD_TIMEOUT_MS = 700;

	let listEl = $state<HTMLUListElement | undefined>(undefined);
	let probeEl = $state<HTMLSpanElement | undefined>(undefined);
	let renameInput = $state<HTMLInputElement | undefined>(undefined);
	let rowHeight = $state(16);
	let indent = $state(16);

	let renamingKey = $state<TreeKey | undefined>(undefined);
	let draft = $state('');

	let draggingKeys = $state<Set<TreeKey>>(new Set());
	let dropTarget = $state<DropTarget | null>(null);

	let typeaheadBuffer = '';
	let typeaheadAt = 0;

	const MOVE_BY_KEY: Record<string, TreeMove> = {
		ArrowUp: 'up',
		ArrowDown: 'down',
		ArrowLeft: 'left',
		ArrowRight: 'right',
		Home: 'home',
		End: 'end'
	};

	// `dropTargetFromPoint` 是纯函数，指针只在这里翻译成行高/缩进/滚动量。
	$effect(() => {
		void rows.length;
		void listEl;
		void probeEl;
		measureGeometry();
	});

	// 编辑态挂到 DOM 后取焦点（重命名状态不进 tree state，见 docs/tree.md §3.9）。
	$effect(() => {
		if (renamingKey === undefined || !renameInput) return;
		renameInput.focus();
		renameInput.select();
	});

	function measureGeometry() {
		const row = listEl?.querySelector<HTMLElement>('.outliner-row');
		if (row) rowHeight = row.getBoundingClientRect().height;
		const ch = probeEl?.getBoundingClientRect().width;
		if (ch && ch > 0) indent = ch * INDENT_CH;
	}

	function changeSelection(next: Set<TreeKey>) {
		localSelected = next;
		onSelectionChange?.(next);
	}

	function changeExpanded(next: Set<TreeKey>) {
		localExpanded = next;
		onExpandedChange?.(next);
	}

	function toggleExpanded(key: TreeKey) {
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		changeExpanded(next);
	}

	function activate(key: TreeKey) {
		onActivate?.(key);
	}

	function focusRow(key: TreeKey) {
		focusKey = key;
		listEl?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
	}

	function handleRowClick(event: MouseEvent, row: TreeRow) {
		focusKey = row.key;
		const next = selectionAfter(rows, selected, row.key, {
			shift: event.shiftKey,
			ctrl: event.ctrlKey || event.metaKey
		});
		changeSelection(next);
		// 被 ctrl 取消选中的行不应该同时成为 active。
		if (next.has(row.key)) activate(row.key);
	}

	function handleRowDoubleClick(event: MouseEvent, row: TreeRow) {
		event.preventDefault();
		startRename(row.key);
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (renamingKey !== undefined) return;
		const move = MOVE_BY_KEY[event.key];
		if (move) {
			event.preventDefault();
			applyMove(move);
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const key = tabbableKey;
			if (key === undefined) return;
			changeSelection(new Set([key]));
			activate(key);
			return;
		}
		if (event.key === 'F2') {
			event.preventDefault();
			if (tabbableKey !== undefined) startRename(tabbableKey);
			return;
		}
		if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
			runTypeahead(event.key);
		}
	}

	function applyMove(move: TreeMove) {
		const current = tabbableKey;
		if (current === undefined) return;
		const next = nextFocusKey(rows, current, move);
		if (next === undefined) return;
		if (next === current) {
			// `nextFocusKey` 用「返回当前 key」表示结构变化；只有展开状态允许时才真的折叠/展开。
			const row = rowByKey(rows, current);
			if (move === 'left' && row?.hasChildren && expanded.has(current)) toggleExpanded(current);
			else if (move === 'right' && row?.hasChildren && !expanded.has(current))
				toggleExpanded(current);
			return;
		}
		focusRow(next);
	}

	function runTypeahead(character: string) {
		const now = Date.now();
		typeaheadBuffer =
			now - typeaheadAt > TYPEAHEAD_TIMEOUT_MS ? character : typeaheadBuffer + character;
		typeaheadAt = now;
		const key = typeaheadKey(rows, tabbableKey, typeaheadBuffer);
		if (key !== undefined) focusRow(key);
	}

	function startRename(key: TreeKey) {
		const row = rowByKey(rows, key);
		if (!row) return;
		renamingKey = key;
		draft = row.textValue;
	}

	function commitRename(key: TreeKey) {
		if (renamingKey !== key) return;
		renamingKey = undefined;
		const name = draft.trim();
		if (name === '' || name === rowByKey(rows, key)?.textValue) return;
		onRename?.(key, name);
	}

	function cancelRename() {
		renamingKey = undefined;
	}

	function handleRenameKeyDown(event: KeyboardEvent, key: TreeKey) {
		// 输入框自己吃掉按键，别再冒泡给树的键盘导航。
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			commitRename(key);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			cancelRename();
		}
	}

	function handleDragStart(event: DragEvent, row: TreeRow) {
		if (renamingKey !== undefined) {
			event.preventDefault();
			return;
		}
		focusKey = row.key;
		const keys = selected.has(row.key) ? [...selected] : [row.key];
		draggingKeys = new Set(keys);
		dropTarget = null;
		const data = event.dataTransfer;
		if (!data) return;
		data.effectAllowed = 'move';
		data.setData('text/plain', keys.join(','));
	}

	function handleDragOver(event: DragEvent) {
		if (draggingKeys.size === 0) return;
		const target = dropTargetFromMouse(event);
		if (!target) {
			dropTarget = null;
			return;
		}
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTarget = target;
	}

	function handleDragLeave(event: DragEvent) {
		const next = event.relatedTarget;
		if (next instanceof Node && listEl?.contains(next)) return;
		dropTarget = null;
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const target = dropTarget;
		const keys = [...draggingKeys];
		draggingKeys = new Set();
		dropTarget = null;
		if (!target || keys.length === 0 || !root) return;
		const ops = applyDrop(root, keys, target);
		if (ops.length > 0) onMove?.(ops);
	}

	function handleDragEnd() {
		draggingKeys = new Set();
		dropTarget = null;
	}

	function dropTargetFromMouse(event: DragEvent): DropTarget | null {
		if (!listEl) return null;
		const rect = listEl.getBoundingClientRect();
		return dropTargetFromPoint(
			rows,
			{ x: event.clientX - rect.left, y: event.clientY - rect.top },
			{ rowHeight, indent, scrollTop: listEl.scrollTop },
			isValidDropTarget
		);
	}

	/** 否决「拖进自己的子树」（含自身）——applyDrop 也会跳过，这里是 UI 层的即时反馈。 */
	function isValidDropTarget(target: DropTarget): boolean {
		if (target.type === 'root') return true;
		for (const key of draggingKeys) {
			if (isWithin(key, target.key)) return false;
		}
		return true;
	}

	function isWithin(ancestor: TreeKey, candidate: TreeKey): boolean {
		let cursor: TreeKey | undefined = candidate;
		while (cursor !== undefined) {
			if (cursor === ancestor) return true;
			cursor = rowByKey(rows, cursor)?.parentKey ?? undefined;
		}
		return false;
	}
</script>

<div class="blender-panel blender-panel-outliner" aria-label="场景集合">
	<span class="outliner-probe" bind:this={probeEl} aria-hidden="true"></span>
	<ul
		bind:this={listEl}
		class="outliner-tree"
		role="tree"
		aria-label="图层树"
		aria-multiselectable="true"
		onkeydown={handleKeyDown}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<!-- 行本身不是按钮：键盘交互（↑↓←→/Home/End/Enter/F2/typeahead）统一在 `role="tree"`
	     的 ul 上处理，roving tabindex 负责焦点；点击只补充鼠标选区语义。 -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	{#each rows as row (row.key)}
			<li
				class="outliner-row"
				class:group={row.data.kind === LAYER_NODE_GROUP}
				class:selected={selected.has(row.key)}
				class:active={row.key === activeRowKey}
				class:dragging={draggingKeys.has(row.key)}
				class:renaming={renamingKey === row.key}
				data-key={row.key}
				data-drop={dropTarget?.type === 'item' && dropTarget.key === row.key
					? dropTarget.position
					: undefined}
				role="treeitem"
				aria-level={row.level}
				aria-selected={selected.has(row.key)}
				aria-expanded={row.hasChildren ? expanded.has(row.key) : undefined}
				style:padding-left={`calc(${row.level - 1} * ${INDENT_CH}ch + 1ch)`}
				tabindex={row.key === tabbableKey ? 0 : -1}
				draggable={renamingKey !== row.key}
				onclick={(event) => handleRowClick(event, row)}
				ondblclick={(event) => handleRowDoubleClick(event, row)}
				ondragstart={(event) => handleDragStart(event, row)}
				ondragend={handleDragEnd}
				onfocus={() => {
					focusKey = row.key;
				}}
			>
				{#if row.hasChildren}
					<button
						class="gpen-panel-button outliner-disclosure"
						type="button"
						tabindex="-1"
						aria-label={`${expanded.has(row.key) ? '折叠' : '展开'} ${row.textValue}`}
						title={expanded.has(row.key) ? '折叠' : '展开'}
						onclick={(event) => {
							event.stopPropagation();
							// 箭头自己的 DOM 焦点不影响 roving 状态：记下行 key，键盘导航从这行继续。
							focusKey = row.key;
							toggleExpanded(row.key);
						}}
					>
						{expanded.has(row.key) ? '⌄' : '›'}
					</button>
				{:else}
					<span class="outliner-disclosure" aria-hidden="true"></span>
				{/if}
				<span class="row-icon" aria-hidden="true">
					{#if row.data.kind === LAYER_NODE_GROUP}
						<sp-icon-layers></sp-icon-layers>
					{:else}
						<span class="layer-dot" class:active={row.key === activeRowKey}></span>
					{/if}
				</span>
				{#if renamingKey === row.key}
					<input
						class="outliner-rename"
						bind:this={renameInput}
						bind:value={draft}
						type="text"
						aria-label="重命名图层"
						onkeydown={(event) => handleRenameKeyDown(event, row.key)}
						onclick={(event) => event.stopPropagation()}
						ondblclick={(event) => event.stopPropagation()}
						onblur={() => commitRename(row.key)}
					/>
				{:else}
					<span class="row-name">{row.textValue}</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if rows.length === 0}
		<p class="outliner-empty">暂无图层</p>
	{/if}
</div>

<style>
	.blender-panel-outliner {
		position: relative;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0.6lh 0.75ch 0.75lh;
	}

	/* 量 1ch 的探针：行命中测试（dropTargetFromPoint）需要缩进和行高的 px 值，
	 * 而 ch 随字号/zoom 变化，只能量不能说。 */
	.outliner-probe {
		position: absolute;
		display: block;
		width: 1ch;
		height: 0;
		visibility: hidden;
		pointer-events: none;
	}

	.outliner-tree {
		flex: 1 1 auto;
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow: auto;
	}

	/* 行高固定（没有 gap）：dropTargetFromPoint 的定高命中测试依赖它。 */
	.outliner-row {
		display: flex;
		align-items: center;
		gap: 0.75ch;
		flex: 0 0 auto;
		height: 2lh;
		padding-right: 1ch;
		border: 1px solid transparent;
		border-radius: var(--gpen-radius);
		color: var(--gpen-panel-foreground);
		user-select: none;
	}

	.outliner-row:hover {
		background: var(--gpen-panel-background-hover);
	}

	.outliner-row.group {
		font-weight: 600;
	}

	.outliner-row.selected {
		background: var(--gpen-panel-selection);
	}

	.outliner-row.active {
		border-color: color-mix(in srgb, var(--gpen-panel-accent) 45%, transparent);
	}

	.outliner-row.dragging {
		opacity: 0.5;
	}

	.outliner-row[data-drop='before'] {
		box-shadow: inset 0 2px 0 0 var(--gpen-panel-accent);
	}

	.outliner-row[data-drop='after'] {
		box-shadow: inset 0 -2px 0 0 var(--gpen-panel-accent);
	}

	.outliner-row[data-drop='on'] {
		outline: 1px solid var(--gpen-panel-accent);
		outline-offset: -1px;
	}

	.outliner-row:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: -2px;
	}

	.outliner-disclosure {
		flex: 0 0 auto;
		width: 1.2ch;
		height: 2lh;
		padding: 0;
		color: var(--gpen-panel-muted);
		font-size: 11px;
		line-height: 1;
	}

	.row-icon {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2ch;
		color: var(--gpen-panel-muted);
	}

	.layer-dot {
		width: 0.7ch;
		height: 0.7ch;
		border-radius: 50%;
		background: var(--gpen-panel-muted);
	}

	.layer-dot.active {
		background: var(--gpen-panel-accent);
	}

	.row-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 原生 <input>（AGENTS.md：除 number 外都用原生元素）。 */
	.outliner-rename {
		flex: 1 1 auto;
		min-width: 0;
		height: 1.7lh;
		padding: 0 0.5ch;
		border: 1px solid var(--gpen-panel-accent);
		border-radius: var(--gpen-radius-sm);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-foreground);
		font: inherit;
		user-select: text;
	}

	.outliner-rename:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 1px;
	}

	.outliner-empty {
		margin: 0;
		padding: 0.5lh 1ch;
		color: var(--gpen-panel-muted);
	}
</style>
