<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-down.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-right.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-color-fill.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-erase.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-more.js';

	import { Color4T, type BrushSettingsT, type EraserSettingsT } from 'gpen-protocol/flatbuffers';
	import ColorPicker from '#lib/components/widgets/colors/ColorPicker.svelte';
	import InputSlider from '#lib/components/widgets/inputs/InputSlider.svelte';
	import type { GpenToolId } from '../gpenWorkspaceState';
	import {
		color4ToHex,
		DEFAULT_BRUSH_SIZE,
		DEFAULT_BRUSH_SPACING,
		DEFAULT_BRUSH_STRENGTH,
		DEFAULT_ERASER_SIZE,
		DEFAULT_ERASER_STRENGTH,
		hexToColor4
	} from '../toolbarOps';

	let {
		brush,
		onChangeBrush,
		activeTool = 'brush',
		eraser,
		onChangeEraser
	}: {
		/** 协议 `ToolbarState.brush`（真值在文档里，面板只读 + 回调）。 */
		brush?: BrushSettingsT;
		onChangeBrush?: (patch: Partial<BrushSettingsT>) => void;
		/** 当前工具：画笔 / 橡皮两套参数共用这个面板。 */
		activeTool?: GpenToolId;
		eraser?: EraserSettingsT;
		onChangeEraser?: (patch: Partial<EraserSettingsT>) => void;
	} = $props();

	// 属性面板是第一批真正吃 widget 的面板：尺寸 / 强度直接用 InputSlider
	// （Blender 风「拖拽 = 滑条，点击 = 编辑」），所以这里的数值行为与
	// /demo/widgets 完全一致，而不是另写一套只读展示。
	//
	// 值不再存在本地：真值是协议 `ToolbarState`（随文档走），面板只读 + 回调。
	// `BrushSettings.size` 是**直径、CSS px**（`Point.radius` 才是半径），所以这里
	// 直接以 px 直径表述，不做单位换算（两套口径混用会把人绕晕）。
	//
	// ⚠️ 回退值必须等于协议默认值，不能用 0：`InputSlider` 会把 0 钳到 `min={1}` 并在
	// `$effect` 里把结果发回来，于是面板一挂载就把 size=1 写进文档（实测踩到）。
	const isEraser = $derived(activeTool === 'eraser');
	const size = $derived(isEraser ? (eraser?.size ?? DEFAULT_ERASER_SIZE) : (brush?.size ?? DEFAULT_BRUSH_SIZE));
	const strength = $derived(
		isEraser ? (eraser?.strength ?? DEFAULT_ERASER_STRENGTH) : (brush?.strength ?? DEFAULT_BRUSH_STRENGTH)
	);
	const spacing = $derived(brush?.spacing ?? DEFAULT_BRUSH_SPACING);
	const color = $derived(color4ToHex(brush?.color ?? undefined));
	let isColorCollapsed = $state(true);

	function patchSize(value: number | undefined) {
		if (typeof value !== 'number') return;
		if (isEraser) onChangeEraser?.({ size: value });
		else onChangeBrush?.({ size: value });
	}

	function patchStrength(value: number | undefined) {
		if (typeof value !== 'number') return;
		if (isEraser) onChangeEraser?.({ strength: value });
		else onChangeBrush?.({ strength: value });
	}

	function patchColor(hex: string) {
		const next = hexToColor4(hex);
		if (!next) return;
		onChangeBrush?.({ color: Object.assign(new Color4T(), brush?.color ?? undefined, next) });
	}
</script>

<div class="blender-panel blender-panel-properties" aria-label="属性">
	<section class="property-card">
		<header class="card-head">
			{#if isEraser}
				<sp-icon-erase></sp-icon-erase>
				<h2>橡皮设置</h2>
			{:else}
				<sp-icon-brush></sp-icon-brush>
				<h2>笔刷设置</h2>
			{/if}
			<button type="button" class="card-menu" aria-label="工具设置菜单" title="工具设置菜单">
				<sp-icon-more></sp-icon-more>
			</button>
		</header>

		<div class="property-row">
			<span class="property-label">{isEraser ? '橡皮直径' : '画笔直径'}</span>
			<InputSlider
				value={size}
				units={{ base: 'px', units: { px: 1 } }}
				min={1}
				max={256}
				step={1}
				aria-label={isEraser ? '橡皮尺寸（直径）' : '画笔尺寸（直径）'}
				onvalidvalue={patchSize}
			/>
		</div>
		<div class="property-row">
			<span class="property-label">强度/力度</span>
			<InputSlider
				value={strength}
				min={0}
				max={1}
				step={0.01}
				aria-label={isEraser ? '橡皮强度' : '画笔强度'}
				onvalidvalue={patchStrength}
			/>
		</div>
		{#if !isEraser}
			<div class="property-row">
				<span class="property-label">间距</span>
				<InputSlider
					value={spacing}
					min={0.01}
					max={1}
					step={0.01}
					aria-label="画笔间距"
					onvalidvalue={(value) => {
						if (typeof value === 'number') onChangeBrush?.({ spacing: value });
					}}
				/>
			</div>
		{/if}
	</section>

	<section class="property-card">
		<header class="card-head">
			<sp-icon-color-fill></sp-icon-color-fill>
			<h2>颜色</h2>
			<button
				type="button"
				class="card-menu"
				aria-expanded={!isColorCollapsed}
				aria-label={isColorCollapsed ? '展开颜色设置' : '收起颜色设置'}
				onclick={() => (isColorCollapsed = !isColorCollapsed)}
			>
				{#if isColorCollapsed}
					<sp-icon-chevron-right></sp-icon-chevron-right>
				{:else}
					<sp-icon-chevron-down></sp-icon-chevron-down>
				{/if}
			</button>
		</header>

		{#if !isColorCollapsed}
			<div class="property-row">
				<span class="property-label">主色</span>
				<ColorPicker value={color} label="画笔颜色" onchange={patchColor} />
			</div>
		{/if}
	</section>
</div>

<style>
	.blender-panel-properties {
		display: flex;
		flex-direction: column;
		gap: 0.6lh;
		overflow: auto;
		padding: 0.6lh 1.25ch;
	}

</style>
