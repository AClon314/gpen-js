<script lang="ts">
	let {
		status,
		error = ''
	}: {
		status: string;
		error?: string;
	} = $props();
</script>

<p class="status" class:error={Boolean(error)} aria-live="polite">
	{status}{#if error}：{error}{/if}
</p>

<style>
	.status {
		min-height: 1.5lh;
		margin: 1lh 0 0;
		color: #36566b;
	}

	.status.error {
		color: #a33b3b;
	}
</style>
