<script lang="ts">
	import type { Snippet } from 'svelte';

	// 设置 / 属性面板共用的分组卡片外壳（框 + 标题行）。`panel.css` 的
	// `.property-card` / `.card-head` 负责配色与盒模型，这里只固定结构。
	//
	// 图标用 `svelte:element` 按标签名渲染：Spectrum 图标在调用方 import 时已注册为
	// 自定义元素（与 `ToolStrip` 同一写法），所以卡片自己不 import 具体图标，
	// 也不新增「图标组件」这类传值 props。
	interface Props {
		title: string;
		/** Spectrum 图标元素标签名（`sp-icon-*`）；缺省不渲染图标。 */
		icon?: string;
		children: Snippet;
	}

	let { title, icon, children }: Props = $props();
</script>

<section class="property-card">
	<header class="card-head">
		{#if icon}<svelte:element this={icon} />{/if}
		<h2>{title}</h2>
	</header>
	{@render children()}
</section>