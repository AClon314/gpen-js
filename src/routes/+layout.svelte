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
	import { initTheme, setThemePreference } from '#lib/themes/theme.svelte';
	import { loadPreferences, preferences } from '#lib/components/gpenPreferencesState.svelte';
	import '#lib/components/contextMenu/contextMenu.svelte';

	let { children } = $props();
	let overlay: ReturnType<typeof mount> | undefined;

	onMount(() => {
		// JS reads the static --gpen-* tokens and takes over their control. The
		// persisted theme preference is applied first (and again once the KV read
		// settles) so the workspace never flashes the wrong scheme.
		initTheme();
		void loadPreferences().then((loaded) => setThemePreference(loaded.theme));
		// Keep the DOM attribute in sync when the settings panel changes it.
		$effect.root(() => {
			$effect(() => setThemePreference(preferences().theme));
		});
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
