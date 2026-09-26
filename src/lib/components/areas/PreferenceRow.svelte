<script lang="ts">
	import type { Snippet } from 'svelte';

	// 「标签 + 控件」的偏好 / 属性行。行的盒模型来自全局 `panel.css` 的 `.property-row`
	// （设置面板与属性面板共用），这里只固定「第一列是标签、第二列是控件」的结构，
	// 让每行在卡片里只写自己那半的控件。
	//
	// 尺寸仍由调用方内联 `style` 覆盖（见 AGENTS.md），本组件不新增传值 props。
	interface Props {
		label: string;
		/** 悬停说明（原生 `title`），与 `SelectRow` 的 `hint` 同一含义。 */
		hint?: string;
		children: Snippet;
	}

	let { label, hint, children }: Props = $props();
</script>

<div class="property-row">
	<span class="property-label" title={hint}>{label}</span>
	{@render children()}
</div>