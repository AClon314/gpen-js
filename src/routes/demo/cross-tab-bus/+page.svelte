<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { createTabBus, type ITabBus } from '#lib/crossTabBus/index.js';

	type DemoPayload = {
		text: string;
		senderId: string;
	};

	type LogEntry = {
		id: number;
		direction: 'sent' | 'received';
		text: string;
		senderId: string;
		time: number;
	};

	const channelName = 'gpen:demo:cross-tab';
	const senderId = `${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36).slice(-4)}`;

	let bus = $state<ITabBus | undefined>(undefined);
	let draft = $state('Hello from this tab');
	let log = $state<LogEntry[]>([]);
	let isReady = $state(false);
	let isSending = $state(false);
	let status = $state('正在创建 tab bus...');
	let errorMessage = $state('');
	let sequence = 0;

	function isDemoPayload(value: unknown): value is DemoPayload {
		return (
			typeof value === 'object' &&
			value !== null &&
			typeof (value as { text?: unknown }).text === 'string' &&
			typeof (value as { senderId?: unknown }).senderId === 'string'
		);
	}

	function addLog(direction: LogEntry['direction'], text: string, messageSenderId: string) {
		log = [
			{
				id: ++sequence,
				direction,
				text,
				senderId: messageSenderId,
				time: Date.now()
			},
			...log
		].slice(0, 24);
	}

	function formatTime(time: number) {
		return new Date(time).toLocaleTimeString([], {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	async function sendText(text = draft) {
		const currentBus = bus;
		const messageText = text.trim();
		if (!currentBus || !messageText || isSending) return;

		isSending = true;
		errorMessage = '';
		try {
			await currentBus.send('demo.message', { text: messageText, senderId });
			addLog('sent', messageText, senderId);
			draft = '';
			status = '消息已发送；另一个标签页应该已经收到。';
		} catch (cause) {
			status = '发送失败';
			errorMessage = cause instanceof Error ? cause.message : String(cause);
		} finally {
			isSending = false;
		}
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		void sendText();
	}

	onMount(() => {
		try {
			const nextBus = createTabBus({
				targetOrigin: window.location.origin,
				channelName
			});
			const unsubscribe = nextBus.onMessage((message) => {
				if (message.type !== 'demo.message') return;
				const payload = isDemoPayload(message.payload)
					? message.payload
					: { text: JSON.stringify(message.payload), senderId: 'unknown' };
				addLog('received', payload.text, payload.senderId);
				status = `收到来自 ${payload.senderId} 的消息`;
			});

			bus = nextBus;
			isReady = true;
			status = '已连接；请打开第二个同源标签页';

			return () => {
				unsubscribe();
				nextBus.destroy();
				bus = undefined;
			};
		} catch (cause) {
			status = '连接失败';
			errorMessage = cause instanceof Error ? cause.message : String(cause);
		}
	});
</script>

<svelte:head>
	<title>Cross-tab bus demo | gpen</title>
</svelte:head>

<main>
	<p><a href={resolve('/')}>← gpen</a></p>

	<header>
		<p class="eyebrow">gpen-js / crossTabBus / createTabBus</p>
		<h1>Cross-tab bus demo</h1>
		<p>打开两个同源标签页，发送一条消息，看看另一个页面如何通过 BroadcastChannel 实时收到。</p>
	</header>

	<p class:error={Boolean(errorMessage)} class="status" aria-live="polite">
		{status}{#if errorMessage}：{errorMessage}{/if}
	</p>

	<section class="overview" aria-labelledby="overview-title">
		<div>
			<p class="eyebrow">transport</p>
			<h2 id="overview-title">Same-origin BroadcastChannel</h2>
			<p class="muted">
				当前标签页 ID：<code>{senderId}</code>
			</p>
		</div>
		<code class="channel">{channelName}</code>
	</section>

	<section aria-labelledby="send-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">send</p>
				<h2 id="send-title">发一条消息</h2>
			</div>
			<code>{isReady ? 'ready' : 'connecting'}</code>
		</div>

		<form onsubmit={submit}>
			<label for="message">消息内容</label>
			<div class="composer">
				<input
					id="message"
					bind:value={draft}
					disabled={!isReady || isSending}
					placeholder="输入一条消息"
				/>
				<button type="submit" disabled={!isReady || isSending || !draft.trim()}>
					{isSending ? '发送中…' : '发送'}
				</button>
			</div>
			<div class="actions">
				<button type="button" disabled={!isReady || isSending} onclick={() => void sendText('ping')}>
					发送 Ping
				</button>
				<button type="button" class="secondary" disabled={!log.length} onclick={() => (log = [])}>
					清空日志
				</button>
			</div>
		</form>
	</section>

	<section aria-labelledby="log-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">messages</p>
				<h2 id="log-title">消息日志</h2>
			</div>
			<span class="muted">{log.length} 条</span>
		</div>

		{#if log.length === 0}
			<p class="empty">还没有消息。打开第二个标签页，然后点击“发送”。</p>
		{:else}
			<ol class="log" aria-live="polite">
				{#each log as entry (entry.id)}
					<li class:received={entry.direction === 'received'}>
						<div class="log-meta">
							<strong>{entry.direction === 'sent' ? '发送' : '收到'}</strong>
							<time datetime={new Date(entry.time).toISOString()}>{formatTime(entry.time)}</time>
						</div>
						<p>{entry.text}</p>
						<code>{entry.senderId}</code>
					</li>
				{/each}
			</ol>
		{/if}
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
	p {
		margin-top: 0;
	}

	h1 {
		margin-bottom: 0.75rem;
		font-size: 2.25rem;
	}

	h2 {
		margin-bottom: 0;
		font-size: 1.35rem;
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

	.overview,
	.section-heading,
	.composer,
	.actions,
	.log-meta {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.overview,
	.section-heading {
		justify-content: space-between;
	}

	.section-heading {
		align-items: end;
		margin-bottom: 1.25rem;
	}

	.section-heading code,
	.channel {
		color: #63717c;
		font-size: 0.8rem;
	}

	.overview {
		align-items: start;
	}

	label {
		display: block;
		margin-bottom: 0.6rem;
		font-weight: 650;
	}

	.composer {
		align-items: stretch;
	}

	input {
		box-sizing: border-box;
		min-width: 0;
		flex: 1;
		border: 1px solid #aebbc4;
		border-radius: 4px;
		padding: 0.65rem 0.75rem;
		background: #fff;
		color: inherit;
		font: inherit;
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

	button.secondary {
		border-color: #aebbc4;
		background: #fff;
		color: #315a70;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.actions {
		margin-top: 0.75rem;
		flex-wrap: wrap;
	}

	.muted {
		color: #63717c;
	}

	.empty {
		margin: 0;
		padding: 1.25rem;
		border: 1px dashed #aebbc4;
		color: #63717c;
		text-align: center;
	}

	.log {
		display: grid;
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.log li {
		border-left: 3px solid #315a70;
		padding: 0.75rem 1rem;
		background: #f3f6f8;
	}

	.log li.received {
		border-left-color: #b56a32;
		background: #fff8f0;
	}

	.log-meta {
		justify-content: space-between;
		color: #63717c;
		font-size: 0.8rem;
	}

	.log p {
		margin: 0.45rem 0;
		font-size: 1.05rem;
		overflow-wrap: anywhere;
	}

	.log code,
	.overview code {
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}

	@media (max-width: 36rem) {
		.overview,
		.composer {
			align-items: stretch;
			flex-direction: column;
		}

		.composer button {
			width: 100%;
		}
	}
</style>
