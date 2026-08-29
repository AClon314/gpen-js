<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main>
	<h1>gpen</h1>
	<p>
		把 Blender Grease Pencil 的数据结构搬到 Web，让浏览器 / VS Code 扩展里也能有接近 Saber 的笔记与绘画体验。
	</p>
	<p>客户端渲染，不做 SSR。词条之后走 Paraglide。</p>
	<p><a href={resolve('/demo/web-component')}>web component demo</a></p>
	<p><a href={resolve('/demo/panel')}>collapsible panel demo</a></p>
	<p><a href={resolve('/demo/storage')}>storage demo</a></p>
	<p><a href={resolve('/demo/cross-tab-bus')}>cross-tab bus demo</a></p>
</main>

<style>
	main {
		max-width: 40rem;
		padding: 1.5rem;
	}
</style>
