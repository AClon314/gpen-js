<script lang="ts" generics="T extends string">

	// 一个「标签 + 原生 <select>」的偏好行。原生优先（AGENTS.md）：`<select>` 已经
	// 提供键盘导航、平台下拉、无障碍语义，这里只补 gpen 的 token 配色与尺寸。
	interface Props {
		label: string;
		value: T;
		options: readonly { value: T; label: string }[];
		onchange: (value: T) => void;
		/** 说明文字（title）。 */
		hint?: string;
		disabled?: boolean;
	}

	let { label, value, options, onchange, hint, disabled = false }: Props = $props();
</script>

<div class="property-row">
	<span class="property-label">{label}</span>
	<select
		class="gpen-select"
		{disabled}
		title={hint}
		aria-label={label}
		value={value}
		onchange={(event) => onchange((event.currentTarget as HTMLSelectElement).value as T)}
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
</div>

<style>
	.gpen-select {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		height: 2lh;
		padding: 0 0.5ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius-sm);
		background: var(--gpen-panel-background-raised);
		color: var(--gpen-panel-foreground);
		font: inherit;
	}

	.gpen-select:hover:not(:disabled) {
		border-color: var(--gpen-panel-accent);
	}

	.gpen-select:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 1px;
	}

	.gpen-select:disabled {
		opacity: 0.5;
	}
</style>
