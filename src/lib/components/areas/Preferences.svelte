<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-color-fill.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-erase.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-settings.js';

	import ColorPicker from '#lib/components/widgets/colors/ColorPicker.svelte';
	import InputSlider from '#lib/components/widgets/inputs/InputSlider.svelte';
	import SelectRow from '#lib/components/widgets/inputs/SelectRow.svelte';
	import { EraserMode, type BrushSettingsT, type EraserSettingsT } from 'gpen-protocol/flatbuffers';
	import type { GpenPreferences } from '../gpenPreferences';
	import type { GpenToolId } from '../gpenWorkspaceState';
	import {
		color4ToHex,
		DEFAULT_BRUSH_SIZE,
		DEFAULT_BRUSH_SPACING,
		DEFAULT_BRUSH_STRENGTH,
		DEFAULT_ERASER_SIZE,
		DEFAULT_ERASER_STRENGTH,
		hexToColor4,
		normalizeColor
	} from '../toolbarOps';
	import { Color4T } from 'gpen-protocol/flatbuffers';

	// 偏好设置面板：**浮动** dockview 面板（不是模态对话框，handoff §4.2），所以它是
	// 普通 `.svelte` 组件、由 `panelComponents` 注册，标题栏保留（浮动手柄）。
	//
	// 三层数据在这里第一次并排出现（handoff §4.1），行内的控件各自绑定自己那层：
	//   1. 用户偏好（`GpenPreferences`，gpen.preferences KV）
	//   2. 工具栏 / 会话（协议 `ToolbarState`，随文档走）
	//   3. 工作区布局（`GpenWorkspaceState`，gpen.workspaceState KV）
	// 面板不做状态缓存：值由父级 `$state` 代理进来，改动一律回调出去（受控三件套）。
	interface Props {
		preferences: GpenPreferences;
		/** 工作区布局层：界面缩放 / 面板布局。 */
		uiScale?: number;
		onChangeUiScale?: (delta: number) => void;
		onResetUiScale?: () => void;
		brush?: BrushSettingsT;
		eraser?: EraserSettingsT;
		onChangeBrush?: (patch: Partial<BrushSettingsT>) => void;
		onChangeEraser?: (patch: Partial<EraserSettingsT>) => void;
		onChangePreferences?: (patch: Partial<GpenPreferences>) => void;
		/** 恢复默认偏好 + 重置画笔/橡皮。 */
		onResetPreferences?: () => void;
		onResetPanelLayout?: () => void;
		/** 只读诊断：当前文档 id 与落盘状态。 */
		documentId?: string;
		storageStatus?: string;
		onClearDocument?: () => void;
	}

	let {
		preferences,
		uiScale = 1,
		onChangeUiScale,
		onResetUiScale,
		brush,
		eraser,
		onChangeBrush,
		onChangeEraser,
		onChangePreferences,
		onResetPreferences,
		onResetPanelLayout,
		documentId = 'gpen-main',
		storageStatus = '未知',
		onClearDocument
	}: Props = $props();

	const THEME_OPTIONS = [
		{ value: 'system' as const, label: '跟随系统' },
		{ value: 'light' as const, label: '浅色' },
		{ value: 'dark' as const, label: '深色' }
	];

	const LOCALE_OPTIONS = [
		{ value: 'system' as const, label: '跟随系统' },
		{ value: 'en' as const, label: 'English' },
		{ value: 'zh-cn' as const, label: '简体中文' }
	];

	// 工具下拉只列**真的能选**的工具：其余 rail 按钮（填充 / 套索 / 选择 …）还没实现，
	// 列进来就是「假承诺」（handoff §1）。
	const TOOL_OPTIONS: { value: GpenToolId; label: string }[] = [
		{ value: 'brush', label: '画笔' },
		{ value: 'eraser', label: '橡皮' }
	];

	const ERASER_MODE_OPTIONS = [
		{ value: String(EraserMode.ERASER_MODE_STROKE), label: '笔画（整笔删除）' },
		// 协议枚举的 0 值叫 `ERASER_MODE_SOFT_UNSPECIFIED`（0 同时是 protobuf 的
		// unspecified 哨兵），SOFT 就是它。
		{ value: String(EraserMode.ERASER_MODE_SOFT_UNSPECIFIED), label: '溶解（逐点降不透明度）' },
		{ value: String(EraserMode.ERASER_MODE_HARD), label: '点（切开笔画）' }
	];

	// 画笔 `size` 是**直径**、`Point.radius` 是半径：滑条直接用直径表述，
	// 换算只发生在 toolbarOps（`brushRadiusOf` / `eraserRadiusOf`）。
	//
	// ⚠️ 回退值必须与**协议默认值**一致（`DEFAULT_BRUSH_SIZE` / `DEFAULT_ERASER_SIZE`），
	// 不能用 `0`：`InputSlider` 会把 0 钳到 `min={1}` 并在 `$effect` 里把结果发回来，
	// 于是「刚打开设置面板」就会把 size=1 写进文档（实测：352 → 720 字节，还会多一条 undo）。
	const brushSize = $derived(brush?.size ?? DEFAULT_BRUSH_SIZE);
	const brushStrength = $derived(brush?.strength ?? DEFAULT_BRUSH_STRENGTH);
	const brushSpacing = $derived(brush?.spacing ?? DEFAULT_BRUSH_SPACING);
	const brushColor = $derived(color4ToHex(brush?.color ?? undefined));
	const eraserSize = $derived(eraser?.size ?? DEFAULT_ERASER_SIZE);
	const eraserStrength = $derived(eraser?.strength ?? DEFAULT_ERASER_STRENGTH);
	const eraserMode = $derived(String(eraser?.mode ?? EraserMode.ERASER_MODE_HARD));

	function patchPreferences(patch: Partial<GpenPreferences>) {
		onChangePreferences?.(patch);
	}

	function patchColor(hex: string) {
		const color = hexToColor4(hex);
		if (!color) return;
		// `Color4T` 有 `a` 与 `pack()`，不能用普通对象字面量替代。
		onChangeBrush?.({
			color: Object.assign(new Color4T(), brush?.color ?? undefined, normalizeColor(color))
		});
	}
</script>

<div class="blender-panel blender-panel-preferences" aria-label="偏好设置">
	<section class="property-card">
		<header class="card-head">
			<sp-icon-settings></sp-icon-settings>
			<h2>界面</h2>
		</header>

		<div class="property-row">
			<span class="property-label">界面缩放</span>
			<div class="scale-control" role="group" aria-label="界面缩放">
				<button
					class="gpen-panel-button"
					type="button"
					aria-label="缩小界面"
					onclick={() => onChangeUiScale?.(-0.25)}
				>−</button>
				<button
					class="gpen-panel-button scale-value"
					type="button"
					title="点击重置界面缩放"
					aria-label="当前界面缩放 {uiScale.toFixed(2)}，点击重置"
					onclick={() => onResetUiScale?.()}
				>{uiScale.toFixed(2)}×</button>
				<button
					class="gpen-panel-button"
					type="button"
					aria-label="放大界面"
					onclick={() => onChangeUiScale?.(0.25)}
				>+</button>
			</div>
		</div>

		<SelectRow
			label="主题"
			value={preferences.theme}
			options={THEME_OPTIONS}
			hint="跟随系统时由操作系统 / 浏览器决定深浅色"
			onchange={(theme) => patchPreferences({ theme })}
		/>

		<SelectRow
			label="语言"
			value={preferences.locale}
			options={LOCALE_OPTIONS}
			onchange={(locale) => patchPreferences({ locale })}
		/>

		<div class="property-row">
			<span class="property-label">显示状态栏</span>
			<input
				type="checkbox"
				aria-label="显示状态栏"
				checked={preferences.showStatusBar}
				onchange={(event) =>
					patchPreferences({ showStatusBar: (event.currentTarget as HTMLInputElement).checked })}
			/>
		</div>
	</section>

	<section class="property-card">
		<header class="card-head">
			<sp-icon-brush></sp-icon-brush>
			<h2>工具</h2>
		</header>

		<SelectRow
			label="默认工具"
			value={preferences.defaultTool}
			options={TOOL_OPTIONS}
			hint="打开工作区时预选的工具"
			onchange={(defaultTool) => patchPreferences({ defaultTool })}
		/>

		<div class="property-row">
			<span class="property-label">画笔尺寸</span>
			<InputSlider
				value={brushSize}
				units={{ base: 'px', units: { px: 1 } }}
				min={1}
				max={256}
				step={1}
				aria-label="画笔尺寸（直径）"
				onvalidvalue={(value) => {
					if (typeof value === 'number') onChangeBrush?.({ size: value });
				}}
			/>
		</div>

		<div class="property-row">
			<span class="property-label">画笔强度</span>
			<InputSlider
				value={brushStrength}
				min={0}
				max={1}
				step={0.01}
				aria-label="画笔强度"
				onvalidvalue={(value) => {
					if (typeof value === 'number') onChangeBrush?.({ strength: value });
				}}
			/>
		</div>

		<div class="property-row">
			<span class="property-label">画笔间距</span>
			<InputSlider
				value={brushSpacing}
				min={0.01}
				max={1}
				step={0.01}
				aria-label="画笔间距"
				onvalidvalue={(value) => {
					if (typeof value === 'number') onChangeBrush?.({ spacing: value });
				}}
			/>
		</div>

		<div class="property-row">
			<span class="property-label">画笔颜色</span>
			<ColorPicker value={brushColor} label="画笔颜色" onchange={patchColor} />
		</div>
	</section>

	<section class="property-card">
		<header class="card-head">
			<sp-icon-erase></sp-icon-erase>
			<h2>橡皮</h2>
		</header>

		<SelectRow
			label="擦除模式"
			value={eraserMode}
			options={ERASER_MODE_OPTIONS}
			hint="整笔删除 / 逐点降不透明度 / 把笔画切开"
			onchange={(value) => onChangeEraser?.({ mode: Number(value) as EraserMode })}
		/>

		<div class="property-row">
			<span class="property-label">橡皮尺寸</span>
			<InputSlider
				value={eraserSize}
				units={{ base: 'px', units: { px: 1 } }}
				min={1}
				max={256}
				step={1}
				aria-label="橡皮尺寸（直径）"
				onvalidvalue={(value) => {
					if (typeof value === 'number') onChangeEraser?.({ size: value });
				}}
			/>
		</div>

		<div class="property-row">
			<span class="property-label">橡皮强度</span>
			<InputSlider
				value={eraserStrength}
				min={0}
				max={1}
				step={0.01}
				aria-label="橡皮强度"
				onvalidvalue={(value) => {
					if (typeof value === 'number') onChangeEraser?.({ strength: value });
				}}
			/>
		</div>
	</section>

	<section class="property-card">
		<header class="card-head">
			<sp-icon-color-fill></sp-icon-color-fill>
			<h2>文件</h2>
		</header>

		<div class="property-row">
			<span class="property-label">自动保存间隔</span>
			<InputSlider
				value={preferences.autoSaveDebounceMs}
				units={{ base: 'ms', units: { ms: 1 } }}
				min={0}
				max={10000}
				step={50}
				aria-label="自动保存间隔（毫秒）"
				onvalidvalue={(value) => {
					if (typeof value === 'number') patchPreferences({ autoSaveDebounceMs: value });
				}}
			/>
		</div>

		<div class="property-row">
			<span class="property-label">当前文档</span>
			<code class="read-only">{documentId}</code>
		</div>

		<div class="property-row">
			<span class="property-label">落盘状态</span>
			<code class="read-only">{storageStatus}</code>
		</div>

		{#if onClearDocument}
			<div class="property-row">
				<span class="property-label">清空当前文档</span>
				<button class="gpen-pill danger" type="button" onclick={onClearDocument}>
					清空笔画与图层
				</button>
			</div>
		{/if}
	</section>

	<section class="property-card">
		<header class="card-head">
			<h2>重置</h2>
		</header>

		<div class="property-row">
			<span class="property-label">恢复默认</span>
			<button
				class="gpen-pill"
				type="button"
				title="偏好与画笔 / 橡皮设置回到默认值"
				onclick={() => onResetPreferences?.()}
			>恢复默认偏好</button>
		</div>

		<div class="property-row">
			<span class="property-label">面板布局</span>
			<button class="gpen-pill" type="button" onclick={() => onResetPanelLayout?.()}>
				重置面板布局
			</button>
		</div>
	</section>
</div>

<style>
	.blender-panel-preferences {
		display: flex;
		flex-direction: column;
		gap: 0.6lh;
		overflow: auto;
		padding: 0.6lh 1.25ch;
	}

	.scale-control {
		display: flex;
		align-items: center;
		gap: 0.5ch;
	}

	.scale-control button {
		height: 2lh;
		min-width: 2.25ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius-sm);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-muted);
	}

	.scale-control button.scale-value {
		min-width: 5.5ch;
		color: var(--gpen-panel-foreground);
		font-variant-numeric: tabular-nums;
	}

	.read-only {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--gpen-panel-muted);
		font-family: var(--gpen-font-mono);
	}

	.gpen-pill.danger {
		justify-self: start;
		border-color: var(--gpen-danger);
		color: var(--gpen-danger);
	}
</style>
