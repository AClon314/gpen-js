<svelte:options
	customElement={{
		tag: 'gpen-button',
		shadow: 'open',
		props: {
			label: { reflect: true, type: 'String' },
			disabled: { reflect: true, type: 'Boolean' }
		}
	}}
/>

<script lang="ts">
	let { label = 'Click me', disabled = false } = $props();
	let clicks = $state(0);

	function handleClick() {
		if (disabled) return;
		clicks += 1;
		$host().dispatchEvent(
			new CustomEvent('gpen-click', {
				detail: { clicks, label },
				bubbles: true,
				composed: true
			})
		);
	}
</script>

<button type="button" {disabled} onclick={handleClick}>
	<span class="label">{label}</span>
	<span class="badge">{clicks}</span>
</button>

<style>
	button {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.9rem;
		border: 0;
		border-radius: 999px;
		background: linear-gradient(135deg, #4f46e5, #7c3aed);
		color: #fff;
		font: 600 14px/1.2 system-ui, sans-serif;
		cursor: pointer;
		box-shadow: 0 8px 20px rgb(79 70 229 / 0.28);
	}
	button:hover:not(:disabled) {
		filter: brightness(1.08);
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.badge {
		min-width: 1.4rem;
		padding: 0.15rem 0.4rem;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.2);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
</style>
