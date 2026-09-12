<script lang="ts">
	import { mount, onDestroy, onMount, unmount } from 'svelte';
	import type { Path } from '$app/types';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import GpenOverlay from '#lib/components/GpenOverlay.svelte';
	import { locales, localizeHref } from '#lib/paraglide/runtime';
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import ContextMenu from '#lib/components/contextMenu/ContextMenu.svelte';
	import '#lib/components/contextMenu/contextMenu.svelte';

	let { children } = $props();
	let overlay: ReturnType<typeof mount> | undefined;

	onMount(() => {
		overlay = mount(GpenOverlay, { target: document.body });
	});

	onDestroy(() => {
		if (overlay) void unmount(overlay);
	});
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
<ContextMenu />

<div style="display:none">
	{#each locales as locale (locale)}
		<a
			href={resolve(localizeHref(page.url.pathname, { locale }) as Path)}
		>{locale}</a>
	{/each}
</div>
