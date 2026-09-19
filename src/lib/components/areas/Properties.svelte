<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-down.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-chevron-right.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-color-fill.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-more.js';

	import InputSlider from '#lib/components/widgets/inputs/InputSlider.svelte';
	import { STD_UNITS } from '#lib/inputs/units';

	// 属性面板是第一批真正吃 widget 的面板：半径 / 强度直接用 InputSlider
	// （Blender 风「拖拽 = 滑条，点击 = 编辑」），所以这里的数值行为与
	// /demo/widgets 完全一致，而不是另写一套只读展示。
	// `value` 以量纲基准单位存储：半径用 m（0.15 m），强度是无量纲 0..1。
	let radius = $state(0.15);
	let strength = $state(0.4);
	let spacing = $state(0.25);
	let isColorCollapsed = $state(true);
</script>

<div class="blender-panel blender-panel-properties" aria-label="属性">
	<section class="property-card">
		<header class="card-head">
			<sp-icon-brush></sp-icon-brush>
			<h2>笔刷设置</h2>
			<button type="button" class="card-menu" aria-label="笔刷设置菜单" title="笔刷设置菜单">
				<sp-icon-more></sp-icon-more>
			</button>
		</header>

		<div class="property-row">
			<span class="property-label">半径</span>
			<InputSlider
				bind:value={radius}
				units={STD_UNITS.length}
				min={0}
				step={0.001}
				aria-label="笔刷半径"
			/>
		</div>
		<div class="property-row">
			<span class="property-label">强度/力度</span>
			<InputSlider
				bind:value={strength}
				min={0}
				max={1}
				step={0.01}
				aria-label="笔刷强度"
			/>
		</div>
		<div class="property-row">
			<span class="property-label">间距</span>
			<InputSlider
				bind:value={spacing}
				min={0.01}
				max={1}
				step={0.01}
				aria-label="笔刷间距"
			/>
		</div>
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
				<span class="swatch" aria-label="当前颜色 #4f46e5"></span>
			</div>
		{/if}
	</section>
</div>

<style>
	.blender-panel {
		box-sizing: border-box;
		width: 100%;
		height: 100%;
		min-width: 0;
		min-height: 0;
		font: var(--gpen-font-size)/var(--gpen-line-height) var(--gpen-font-sans);
	}

	.blender-panel-properties {
		display: flex;
		flex-direction: column;
		gap: 0.6lh;
		overflow: auto;
		padding: 0.6lh 1.25ch;
		background: var(--gpen-panel-background);
		color: var(--gpen-panel-foreground);
	}

	.property-card {
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background-raised);
		overflow: hidden;
	}

	.card-head {
		display: flex;
		align-items: center;
		gap: 0.75ch;
		min-height: 2.2lh;
		padding: 0 0.75ch 0 1ch;
		border-bottom: 1px solid var(--gpen-panel-border);
		background: color-mix(in srgb, var(--gpen-panel-border) 35%, transparent);
	}

	.card-head h2 {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
	}

	.card-menu {
		display: grid;
		place-items: center;
		width: 1.8lh;
		height: 1.8lh;
		margin-left: auto;
		padding: 0;
		border: 0;
		border-radius: var(--gpen-radius-sm);
		background: transparent;
		color: var(--gpen-panel-muted);
		cursor: pointer;
	}

	.card-menu:hover {
		background: var(--gpen-panel-background-hover);
		color: var(--gpen-panel-foreground);
	}

	.property-row {
		display: grid;
		/* 第二列必须 minmax(0, 1fr)：`1fr` 的最小值是 min-content，滑条自身的
		 * min-content 宽度会把卡片撑破（面板窄时溢出到面板外）。 */
		grid-template-columns: minmax(8ch, auto) minmax(0, 1fr);
		align-items: center;
		gap: 1ch;
		padding: 0.45lh 1ch;
	}

	.property-row + .property-row {
		border-top: 1px solid color-mix(in srgb, var(--gpen-panel-border) 60%, transparent);
	}

	.property-label {
		color: var(--gpen-panel-muted);
	}

	.swatch {
		width: 6ch;
		height: 1.8lh;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius-sm);
		background: var(--gpen-panel-accent);
	}

	.blender-panel-properties :global(sp-icon-brush),
	.blender-panel-properties :global(sp-icon-color-fill),
	.blender-panel-properties :global(sp-icon-chevron-right),
	.blender-panel-properties :global(sp-icon-chevron-down),
	.blender-panel-properties :global(sp-icon-more) {
		--mod-icon-size: 1.2lh;
		color: inherit;
	}
</style>
