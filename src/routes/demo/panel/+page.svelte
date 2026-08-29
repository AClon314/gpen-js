<script lang="ts">
	import { resolve } from '$app/paths';

	type GpenPanelElement = HTMLElement & { collapsed: boolean };

	let firstPanel = $state<GpenPanelElement | undefined>();
	let events = $state<string[]>([]);

	function onPanelToggle(event: Event) {
		const { collapsed, label } = (event as CustomEvent<{ collapsed: boolean; label: string }>).detail;
		events = [`${label} → ${collapsed ? 'collapsed' : 'expanded'}`, ...events].slice(0, 5);
	}

	function expandFirstPanel() {
		if (firstPanel) firstPanel.collapsed = false;
	}
</script>

<svelte:head><title>Collapsible panel · gpen</title></svelte:head>

<main>
	<p><a href={resolve('/')}>← gpen</a></p>
	<h1>Collapsible panel web component</h1>
	<p>
		<code>&lt;gpen-panel&gt;</code> provides the panel behavior used by the future toolbar and layer
		panel: it can collapse into an icon button, exposes a reflected <code>collapsed</code> property,
		and emits <code>gpen-panel-toggle</code>.
	</p>

	<div class="playground">
		<gpen-panel
			bind:this={firstPanel}
			label="画笔工具"
			icon="✎"
			ongpen-panel-toggle={onPanelToggle}
		>
			<p>内容可以由宿主页面投影进来，面板收起后仍会保留。</p>
			<button type="button" onclick={expandFirstPanel}>通过属性展开第一个面板</button>
		</gpen-panel>

		<gpen-panel label="图层" icon="▤" collapsed ongpen-panel-toggle={onPanelToggle}>
			<p>图层面板先验证容器行为，具体图层模型留给后续 TODO。</p>
		</gpen-panel>
	</div>

	{#if events.length}
		<section aria-labelledby="events-title">
			<h2 id="events-title">toggle events</h2>
			<ul>
				{#each events as event (event)}
					<li><code>{event}</code></li>
				{/each}
			</ul>
		</section>
	{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f6f8fc;
	}

	main {
		padding-top: 1px;
	}

	h1,
	p,
	section {
		max-width: 48rem;
		margin-right: auto;
		margin-left: auto;
	}

	h1 {
		padding: 0 1.5rem;
	}

	p {
		padding: 0 1.5rem;
	}

	.playground {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
		max-width: 48rem;
		margin: 2rem auto;
		padding: 1.5rem;
		border: 1px dashed #b8c2d6;
		border-radius: 1rem;
		background: rgb(255 255 255 / 0.7);
	}

	button {
		padding: 0.45rem 0.7rem;
		border: 1px solid #c8d0df;
		border-radius: 0.45rem;
		background: #fff;
		cursor: pointer;
	}

	button:hover {
		border-color: #4f46e5;
	}

	section {
		padding: 0 1.5rem 2rem;
	}
</style>
