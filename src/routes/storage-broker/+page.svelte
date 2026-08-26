<script lang="ts">
	import { onMount } from 'svelte';
	import { createOpfsBlobBroker } from '#lib/bindings/storage/index.js';
	import { CrossOriginBus } from '#lib/crossTabBus/index.js';

	let status = $state('starting');

	onMount(() => {
		let disposed = false;
		let bus: CrossOriginBus | undefined;
		let broker: { destroy(): void } | undefined;

		const start = async () => {
			if (window.parent === window) throw new Error('Storage broker must run in an iframe');

			const params = new URLSearchParams(window.location.search);
			const parentOrigin = params.get('parentOrigin');
			const channel = params.get('channel');
			const timeout = Number(params.get('timeout'));
			if (!parentOrigin || !channel) throw new Error('Storage broker parameters are missing');

			const storage = globalThis.navigator?.storage;
			if (!storage?.getDirectory) {
				throw new Error('Origin Private File System is unavailable');
			}
			const root = await storage.getDirectory();
			if (disposed) return;

			bus = new CrossOriginBus({
				remoteWindow: window.parent,
				targetOrigin: parentOrigin,
				channel,
				...(Number.isFinite(timeout) && timeout > 0 ? { timeout } : {})
			});
			await bus.ready;
			if (disposed) return;

			broker = await createOpfsBlobBroker(bus, { root });
			status = 'ready';
		};

		void start().catch((cause) => {
			status = cause instanceof Error ? cause.message : String(cause);
			broker?.destroy();
			bus?.destroy();
		});

		return () => {
			disposed = true;
			broker?.destroy();
			bus?.destroy();
		};
	});
</script>

<svelte:head>
	<title>gpen storage broker</title>
</svelte:head>

<main aria-live="polite">{status}</main>
