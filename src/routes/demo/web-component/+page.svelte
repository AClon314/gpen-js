<script lang="ts">
	import { resolve } from '$app/paths';

	let log = $state<string[]>([]);
	let btn = $state<(HTMLElement & { label: string }) | undefined>();

	function onGpenClick(e: Event) {
		const { clicks, label } = (e as CustomEvent<{ clicks: number; label: string }>).detail;
		log = [`${label} → ${clicks}`, ...log].slice(0, 8);
	}

	function bumpLabel() {
		if (btn) btn.label = `JS label ${Date.now() % 1000}`;
	}
</script>

<p><a href={resolve('/')}>← gpen</a></p>
<h1>Svelte 5 custom element</h1>
<p>
	<code>&lt;gpen-button&gt;</code> is compiled as a web component (shadow DOM). The same tag is also
	mounted in <code>src/app.html</code>.
</p>

<div>
	<gpen-button bind:this={btn} label="in +page.svelte" ongpen-click={onGpenClick}></gpen-button>
	<button type="button" onclick={bumpLabel}>set .label via JS</button>
</div>

{#if log.length}
	<ul>
		{#each log as line (line)}
			<li><code>{line}</code></li>
		{/each}
	</ul>
{/if}

<style>
	div {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		flex-wrap: wrap;
		margin: 1rem 0;
	}
</style>
