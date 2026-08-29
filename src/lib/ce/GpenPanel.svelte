<svelte:options
	customElement={{
		tag: 'gpen-panel',
		shadow: 'open',
		props: {
			label: { reflect: true, type: 'String' },
			collapsed: { reflect: true, type: 'Boolean' },
			collapsible: { reflect: true, type: 'Boolean' },
			icon: { reflect: true, type: 'String' }
		}
	}}
/>

<script lang="ts">
	type PanelToggleDetail = {
		collapsed: boolean;
		label: string;
	};

	let {
		label = 'Panel',
		collapsed = $bindable(false),
		collapsible = true,
		icon = '✎'
	} = $props();

	const contentId = 'gpen-panel-content';

	function toggle() {
		if (!collapsible) return;

		collapsed = !collapsed;
		$host().dispatchEvent(
			new CustomEvent<PanelToggleDetail>('gpen-panel-toggle', {
				detail: { collapsed, label },
				bubbles: true,
				composed: true
			})
		);
	}
</script>

{#if collapsed && collapsible}
	<button
		class="icon-button"
		type="button"
		aria-controls={contentId}
		aria-expanded="false"
		aria-label={`展开 ${label}`}
		title={`展开 ${label}`}
		onclick={toggle}
	>
		<span aria-hidden="true">{icon}</span>
	</button>
{:else}
	<section class="panel" aria-labelledby="gpen-panel-label">
		<header class="header">
			<h2 id="gpen-panel-label">{label}</h2>
			{#if collapsible}
				<button
					class="collapse-button"
					type="button"
					aria-controls={contentId}
					aria-expanded="true"
					aria-label={`收起 ${label}`}
					title={`收起 ${label}`}
					onclick={toggle}
				>
					<span aria-hidden="true">⌃</span>
				</button>
			{/if}
		</header>

		<div id={contentId} class="content">
			<slot></slot>
		</div>
	</section>
{/if}

<style>
	:host {
		display: block;
		font: 14px/1.45 system-ui, sans-serif;
		color: var(--gpen-panel-foreground, #172033);
		--gpen-panel-background: #fff;
		--gpen-panel-border: #d9dfeb;
		--gpen-panel-accent: #4f46e5;
		--gpen-panel-shadow: 0 12px 32px rgb(23 32 51 / 0.16);
	}

	:host([collapsed]) {
		display: inline-block;
	}

	.panel {
		min-width: 14rem;
		max-width: min(26rem, calc(100vw - 2rem));
		overflow: hidden;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.75rem;
		background: var(--gpen-panel-background);
		box-shadow: var(--gpen-panel-shadow);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.65rem 0.75rem 0.65rem 1rem;
		border-bottom: 1px solid var(--gpen-panel-border);
		background: color-mix(in srgb, var(--gpen-panel-accent) 7%, var(--gpen-panel-background));
	}

	h2 {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 650;
	}

	.content {
		padding: 1rem;
	}

	:where(.icon-button, .collapse-button) {
		display: inline-grid;
		place-items: center;
		flex: 0 0 auto;
		border: 0;
		color: var(--gpen-panel-foreground, #172033);
		background: transparent;
		font: inherit;
		cursor: pointer;
	}

	:where(.icon-button, .collapse-button):focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 2px;
	}

	.collapse-button {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.4rem;
		font-size: 1.1rem;
	}

	.collapse-button:hover {
		background: color-mix(in srgb, var(--gpen-panel-accent) 12%, transparent);
	}

	.icon-button {
		width: 2.75rem;
		height: 2.75rem;
		border: 1px solid var(--gpen-panel-border);
		border-radius: 0.75rem;
		background: var(--gpen-panel-background);
		box-shadow: var(--gpen-panel-shadow);
		font-size: 1.15rem;
	}

	.icon-button:hover {
		border-color: var(--gpen-panel-accent);
		color: var(--gpen-panel-accent);
	}

	@media (prefers-reduced-motion: no-preference) {
		.panel,
		.icon-button,
		.collapse-button {
			transition:
				box-shadow 120ms ease,
				border-color 120ms ease,
				background-color 120ms ease,
				color 120ms ease;
		}
	}
</style>
