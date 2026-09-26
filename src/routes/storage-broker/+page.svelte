<script lang="ts">
	import { onMount } from 'svelte';
	import { createOpfsBlobBroker } from '#lib/bindings/storage/index.js';
	import { CrossOriginBus } from '#lib/crossTabBus/index.js';

	type BrokerParams = {
		parentOrigin: string;
		channel: string;
		timeout: number;
	};

	let status = $state('starting');

	/** 读取 iframe URL 上的 broker 参数；页面必须跑在 iframe 里才拿得到父窗口。 */
	function readBrokerParams(): BrokerParams {
		if (window.parent === window) throw new Error('Storage broker must run in an iframe');

		const params = new URLSearchParams(window.location.search);
		const parentOrigin = params.get('parentOrigin');
		const channel = params.get('channel');
		if (!parentOrigin || !channel) throw new Error('Storage broker parameters are missing');

		const timeout = Number(params.get('timeout'));
		return {
			parentOrigin,
			channel,
			timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 0
		};
	}

	/** 取 OPFS 根目录；Origin Private File System 不可用时抛错。 */
	async function openOpfsRoot(): Promise<FileSystemDirectoryHandle> {
		const storage = globalThis.navigator?.storage;
		if (!storage?.getDirectory) {
			throw new Error('Origin Private File System is unavailable');
		}
		return storage.getDirectory();
	}

	onMount(() => {
		let disposed = false;
		let bus: CrossOriginBus | undefined;
		let broker: { destroy(): void } | undefined;

		const start = async () => {
			const params = readBrokerParams();
			const root = await openOpfsRoot();
			if (disposed) return;

			bus = new CrossOriginBus({
				remoteWindow: window.parent,
				targetOrigin: params.parentOrigin,
				channel: params.channel,
				...(params.timeout > 0 ? { timeout: params.timeout } : {})
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
			console.debug('[gpen] ignored rejection: storage-broker start', cause);
			return;
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
