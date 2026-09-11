<script lang="ts">
	import { resolve } from '$app/paths';
	import GpenOverlay from '#lib/components/GpenOverlay.svelte';
</script>

<svelte:head><title>Blender workspace · gpen</title></svelte:head>

<GpenOverlay />

<a class="back-link" href={resolve('/')}>← gpen</a>

{'测试'.repeat(9999)}

<style>
	:global(html),
	:global(body) {
		min-height: 100%;
		margin: 0;
		background: linear-gradient(135deg, #0ea5e9 0%, #7c3aed 100%);
	}

	.back-link {
		position: fixed;
		top: 0.5rem;
		left: 0.75rem;
		z-index: 20;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		color: #334155;
		background: rgb(255 255 255 / 0.85);
		font: 12px/1.4 system-ui, sans-serif;
		text-decoration: none;
	}

	.back-link:hover {
		background: #ffffff;
	}
</style>
