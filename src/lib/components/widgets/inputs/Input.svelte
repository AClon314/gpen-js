<script lang="ts">
	import InputSlider from '#lib/components/widgets/inputs/InputSlider.svelte';
	import type { InputProps, InputValue } from '#lib/components/widgets/inputs/types';

	// 分发壳：`number`（和将来的 `color`）一律用自研控件，其余 type 交给原生 <input>。
	// 数值统一走 InputSlider（Blender 风滑条，也支持点击输入）；要纯数值框时直接
	// import `InputNumber.svelte`，不从分发壳走。
	let {
		value = $bindable<InputValue>(''),
		type,
		orientation,
		unit,
		...rest
	}: InputProps = $props();
	const numeric = $derived(type === 'number' || (type === undefined && typeof value === 'number'));
</script>

{#if numeric}
	<InputSlider bind:value {orientation} {unit} {...rest} />
{:else}
	<input {type} bind:value {...rest} />
{/if}
