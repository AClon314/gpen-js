<script lang="ts">
	import '@spectrum-web-components/theme/sp-theme.js';
	// 两个片段都必需：color（theme-*）与 scale（scale-*）。只给 color 时，
	// 依赖 scale token 的组件（如 sp-swatch）会量出 0×0。
	import '@spectrum-web-components/theme/scale-medium.js';
	import '@spectrum-web-components/theme/theme-dark.js';
	import '@spectrum-web-components/theme/theme-light.js';

	import type { Snippet } from 'svelte';

	// SWC 的组件靠 `sp-theme` 注入 Spectrum 设计 token（`--spectrum-*`）。
	// 这里把它**限制在控件子树内**：不让第二套 token 体系污染 gpen 的 `--gpen-*`，
	// 也让「哪些地方是 Adobe 风格」在代码里一眼可见（见 docs/color.md）。
	//
	// light / dark 两套主题都要 import（各自是一份 CSS custom property 表），
	// 这是引入 SWC 的主要固定体积成本；`color` 由调用方按当前配色方案给。
	let {
		color = 'dark',
		scale = 'medium',
		children,
	}: {
		color?: 'light' | 'dark';
		scale?: 'small' | 'medium' | 'large';
		children: Snippet;
	} = $props();
</script>

<sp-theme system="spectrum" {color} {scale}>{@render children()}</sp-theme>
