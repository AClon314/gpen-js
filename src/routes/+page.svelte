<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<main>
	<h1>gpen</h1>
	<p>
		把 Blender Grease Pencil 的数据结构搬到 Web，让浏览器 / VS Code 扩展里也能有接近 Saber 的笔记与绘画体验。
	</p>
	<p>客户端渲染，不做 SSR。词条之后走 Paraglide。</p>
	<p><a href={resolve('/demo/storage')}>storage demo</a></p>
	<p><a href={resolve('/demo/cross-tab-bus')}>cross-tab bus demo</a></p>
	<p><a href={resolve('/demo/zoom')}>browser zoom counter demo</a></p>
	{'测试'.repeat(9999)}
</main>

<style>
	main {
		max-width: 80ch;
		padding: 1.5lh 3.6ch;
		background: linear-gradient(135deg, var(--gpen-panel-background) 0%, var(--gpen-panel-accent) 100%);
	}
	:global {
		main {
			/* 关键：用 margin 外扩，撑开滚动范围 */
			margin: 500px;

			width: 100vw;
			height: 100vh;

			/* 节点定位上下文 */
			position: relative;

			/* 拖拽时别选中 */
			user-select: none;
		}
	}
</style>
