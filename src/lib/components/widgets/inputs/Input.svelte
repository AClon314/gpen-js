<script lang="ts">
	import InputNumber from '#lib/components/widgets/inputs/InputNumber.svelte';
	import InputSlider from '#lib/components/widgets/inputs/InputSlider.svelte';
	import type { InputProps, InputValue } from '#lib/components/widgets/inputs/types';

	// 分发壳：只有 number（和将来的 color）需要自研控件，其余 type 一律交给原生 <input>。
	// 显式传 type 时以 type 为准，否则回退到运行时 value 的类型。
	// orientation / unit / slider 是数值分支专用的扩展 props，原生分支静默忽略。
	let {
		value = $bindable<InputValue>(''),
		type,
		orientation,
		unit,
		slider,
		...rest
	}: InputProps = $props();
	const numeric = $derived(type === 'number' || (type === undefined && typeof value === 'number'));
</script>

{#if numeric && slider}
	<InputSlider bind:value {orientation} {unit} {...rest} />
{:else if numeric}
	<InputNumber bind:value {orientation} {unit} {...rest} />
{:else}
	<input {type} bind:value {...rest} />
{/if}
