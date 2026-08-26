<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import {
		createRuntimeStorage,
		type BlobBackend,
		type Storage
	} from '#lib/bindings/storage/index.js';
	import { createUploadDownloadOnlyBlob } from '#lib/bindings/upDownloader/index.js';

	type BlobMetadata = {
		name: string;
		type: string;
		size: number;
		updatedAt: number;
	};

	type DemoState = {
		visits: number;
		note: string;
		blob: BlobMetadata;
	};

	let storage = $state<Storage<DemoState, BlobBackend> | undefined>(undefined);
	let isReady = $state(false);
	let busy = $state(false);
	let status = $state('正在连接存储...');
	let errorMessage = $state('');
	let visits = $state(0);
	let note = $state('');
	let noteDraft = $state('');
	let keys = $state<string[]>([]);
	let blobId = $state('demo-file');
	let selectedFile = $state<File | undefined>(undefined);
	let storedBlob = $state<Blob | undefined>(undefined);
	let storedMetadata = $state<BlobMetadata | undefined>(undefined);
	let previewUrl = $state<string | undefined>(undefined);
	const selector = createUploadDownloadOnlyBlob();

	function revokePreview() {
		if (!previewUrl) return;
		URL.revokeObjectURL(previewUrl);
		previewUrl = undefined;
	}

	async function refreshKeys() {
		const currentStorage = storage;
		if (!currentStorage) return;
		keys = await currentStorage.kv.keys();
	}

	async function refreshBlob() {
		const currentStorage = storage;
		if (!currentStorage) {
			storedBlob = undefined;
			storedMetadata = undefined;
			return;
		}

		const blobStore = currentStorage.blob;
		revokePreview();
		const [blob, metadata] = await Promise.all([
			blobStore.get(blobId),
			currentStorage.kv.get.blob
		]);
		storedBlob = blob;
		storedMetadata = metadata;
		if (blob?.type.startsWith('image/')) previewUrl = URL.createObjectURL(blob);
	}

	async function initialize() {
		try {
			const nextStorage = createRuntimeStorage<DemoState>({ dbName: 'gpen-demo-storage' });
			storage = nextStorage;
			visits = (await nextStorage.kv.get.visits) ?? 0;
			note = (await nextStorage.kv.get.note) ?? '';
			noteDraft = note;
			await refreshKeys();
			await refreshBlob();
			isReady = true;
			status = `已连接：${nextStorage.kv.name}`;
		} catch (cause) {
			status = '存储不可用';
			errorMessage = cause instanceof Error ? cause.message : String(cause);
		}
	}

	async function runAction(action: () => Promise<void>) {
		if (!isReady || busy) return;
		busy = true;
		errorMessage = '';
		try {
			await action();
		} catch (cause) {
			status = '操作失败';
			errorMessage = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	function incrementVisits() {
		return runAction(async () => {
			const currentStorage = storage;
			if (!currentStorage) return;
			visits = (await currentStorage.kv.get.visits) ?? 0;
			visits += 1;
			await currentStorage.kv.set.visits(visits);
			await currentStorage.kv.submit();
			await refreshKeys();
			status = `visits 已写入：${visits}`;
		});
	}

	function saveNote() {
		return runAction(async () => {
			const currentStorage = storage;
			if (!currentStorage) return;
			await currentStorage.kv.set.note(noteDraft);
			await currentStorage.kv.submit();
			note = noteDraft;
			await refreshKeys();
			status = 'note 已写入';
		});
	}

	function onFileChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		selectedFile = selector.upload(input);
	}

	function saveBlob() {
		return runAction(async () => {
			const currentStorage = storage;
			const file = selectedFile;
			if (!currentStorage || !file) {
				status = '请先选择文件';
				return;
			}
			await currentStorage.blob.set(blobId, file);
			await currentStorage.kv.set.blob({
				name: file.name,
				type: file.type || 'application/octet-stream',
				size: file.size,
				updatedAt: Date.now()
			});
			await currentStorage.kv.submit();
			await refreshBlob();
			await refreshKeys();
			status = `Blob 已保存：${blobId}`;
		});
	}

	function loadBlob() {
		return runAction(async () => {
			await refreshBlob();
			status = storedBlob ? `Blob 已读取：${blobId}` : `没有找到：${blobId}`;
		});
	}

	function removeBlob() {
		return runAction(async () => {
			const currentStorage = storage;
			if (!currentStorage) return;
			await currentStorage.blob.delete(blobId);
			await currentStorage.kv.del.blob;
			await currentStorage.kv.submit();
			await refreshBlob();
			await refreshKeys();
			status = `Blob 已删除：${blobId}`;
		});
	}

	onMount(() => {
		void initialize();
		return () => {
			revokePreview();
			void storage?.close?.();
		};
	});
</script>

<svelte:head>
	<title>Storage demo | gpen</title>
</svelte:head>

<main>
	<p><a href={resolve('/')}>← gpen</a></p>
	<header>
		<p class="eyebrow">gpen-js / bindings / storage</p>
		<h1>Storage demo</h1>
		<p>同一套 callable KV API，在普通网页中自动使用 IndexedDB。</p>
	</header>

	<p class:error={Boolean(errorMessage)} class="status" aria-live="polite">
		{status}{#if errorMessage}：{errorMessage}{/if}
	</p>

	<section aria-labelledby="kv-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">JSON data</p>
				<h2 id="kv-title">KV</h2>
			</div>
			<code>{storage?.kv.name ?? 'loading'}</code>
		</div>

		<div class="grid">
			<div class="field">
				<span>visits</span>
				<strong>{visits}</strong>
				<button type="button" disabled={!isReady || busy} onclick={incrementVisits}>增加一次</button>
			</div>

			<div class="field">
				<label for="note">note</label>
				<textarea id="note" rows="4" bind:value={noteDraft} disabled={!isReady || busy}></textarea>
				<div class="actions">
					<button type="button" disabled={!isReady || busy} onclick={saveNote}>保存 note</button>
					<output>{note || '尚未保存'}</output>
				</div>
			</div>
		</div>

		<div class="keys">
			<div class="section-heading compact">
				<h3>root keys</h3>
				<button type="button" disabled={!isReady || busy} onclick={() => runAction(refreshKeys)}>刷新</button>
			</div>
			{#if keys.length}
				<ul>
					{#each keys as key (key)}
						<li><code>{key}</code></li>
					{/each}
				</ul>
			{:else}
				<p class="muted">暂无 root key</p>
			{/if}
		</div>
	</section>

	<section aria-labelledby="blob-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">binary data</p>
				<h2 id="blob-title">Blob</h2>
			</div>
			<code>{storage?.blob.name ?? 'loading'}</code>
		</div>

		<div class="grid">
			<div class="field">
				<label for="blob-id">Blob id</label>
				<input id="blob-id" bind:value={blobId} disabled={!isReady || busy} />
				<label for="file">选择文件</label>
				<input id="file" type="file" onchange={onFileChange} disabled={!isReady || busy} />
				{#if selectedFile}
					<p class="muted">待保存：{selectedFile.name} · {selectedFile.size} bytes</p>
				{/if}
				<div class="actions">
					<button type="button" disabled={!isReady || busy} onclick={saveBlob}>保存 Blob</button>
					<button type="button" disabled={!isReady || busy} onclick={loadBlob}>读取 Blob</button>
					<button type="button" disabled={!isReady || busy} onclick={removeBlob}>删除 Blob</button>
				</div>
			</div>

			<div class="field result">
				<span>已存文件</span>
				{#if storedBlob && storedMetadata}
					<strong>{storedMetadata.name}</strong>
					<dl>
						<div><dt>type</dt><dd>{storedMetadata.type}</dd></div>
						<div><dt>size</dt><dd>{storedMetadata.size} bytes</dd></div>
						<div><dt>loaded</dt><dd>{storedBlob.size} bytes</dd></div>
					</dl>
					{#if previewUrl}
						<img src={previewUrl} alt={storedMetadata.name} />
					{/if}
				{:else}
					<p class="muted">当前 id 没有 Blob</p>
				{/if}
			</div>
		</div>
	</section>
</main>

<style>
	main {
		max-width: 58rem;
		margin: 0 auto;
		padding: 1.5rem;
		color: #1d2833;
	}

	header {
		padding: 3rem 0 2rem;
		border-bottom: 1px solid #ccd5dc;
	}

	h1,
	h2,
	h3,
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0.75rem;
		font-size: 2.25rem;
		letter-spacing: 0;
	}

	h2 {
		margin-bottom: 0;
		font-size: 1.35rem;
		letter-spacing: 0;
	}

	h3 {
		margin-bottom: 0;
		font-size: 1rem;
		letter-spacing: 0;
	}

	.eyebrow {
		margin-bottom: 0.5rem;
		color: #63717c;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.status {
		min-height: 1.5rem;
		margin: 1rem 0 0;
		color: #36566b;
	}

	.status.error {
		color: #a33b3b;
	}

	section {
		padding: 2rem 0;
		border-bottom: 1px solid #ccd5dc;
	}

	.section-heading {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.section-heading.compact {
		align-items: center;
		margin-bottom: 0.75rem;
	}

	.section-heading code {
		color: #63717c;
		font-size: 0.8rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem 2rem;
	}

	.field {
		display: grid;
		align-content: start;
		gap: 0.6rem;
		min-width: 0;
	}

	.field > span,
	.field > label {
		font-weight: 650;
	}

	.field strong {
		font-size: 2rem;
		line-height: 1.1;
	}

	input,
	textarea {
		box-sizing: border-box;
		width: 100%;
		border: 1px solid #aebbc4;
		border-radius: 4px;
		padding: 0.65rem 0.75rem;
		background: #fff;
		color: inherit;
		font: inherit;
	}

	input[type='file'] {
		padding: 0.45rem;
	}

	button {
		width: fit-content;
		border: 1px solid #315a70;
		border-radius: 4px;
		padding: 0.55rem 0.8rem;
		background: #315a70;
		color: #fff;
		font: inherit;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: center;
	}

	.actions output {
		min-width: 0;
		color: #63717c;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.keys {
		margin-top: 2rem;
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
	}

	li code {
		display: inline-block;
		border: 1px solid #ccd5dc;
		border-radius: 4px;
		padding: 0.35rem 0.5rem;
		background: #f3f6f8;
	}

	.muted {
		color: #63717c;
	}

	.result {
		border-left: 1px solid #ccd5dc;
		padding-left: 1.25rem;
	}

	dl {
		display: grid;
		gap: 0.4rem;
		margin: 0;
	}

	dl > div {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	dt,
	dd {
		margin: 0;
	}

	dt {
		color: #63717c;
	}

	dd {
		text-align: right;
		overflow-wrap: anywhere;
	}

	img {
		max-width: 100%;
		max-height: 16rem;
		object-fit: contain;
		border: 1px solid #ccd5dc;
	}

	@media (max-width: 34rem) {
		main {
			padding: 1rem;
		}

		header {
			padding-top: 2rem;
		}

		.section-heading {
			align-items: start;
			flex-direction: column;
		}

		.result {
			border-top: 1px solid #ccd5dc;
			border-left: 0;
			padding-top: 1rem;
			padding-left: 0;
		}
	}
</style>
