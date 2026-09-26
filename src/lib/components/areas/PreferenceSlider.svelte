<script lang="ts">
	import InputSlider from '#lib/components/widgets/inputs/InputSlider.svelte';
	import type { Dimension } from '#lib/inputs/units';
	import PreferenceRow from './PreferenceRow.svelte';

	// 「标签 + 数值滑条」的偏好行。设置面板里 7 行是同一个形状，差异只在标签 /
	// 量纲 / 上下限与回写目标。`InputSlider` 对非法文本会下发 `undefined`，
	// 这里把「只回传有限数」的守卫收敛到一处，调用方只关心数值本身。
	interface Props {
		label: string;
		value: number;
		onchange: (value: number) => void;
		/** 控件自身的无障碍名；缺省与 `label` 相同（可见标签即无障碍名）。 */
		ariaLabel?: string;
		/** 标签的悬停说明（原生 `title`）。 */
		hint?: string;
		units?: Dimension;
		min?: number;
		max?: number;
		step?: number;
	}

	let { label, value, onchange, ariaLabel, hint, units, min, max, step }: Props = $props();
</script>

<PreferenceRow {label} {hint}>
	<InputSlider
		{value}
		{units}
		{min}
		{max}
		{step}
		aria-label={ariaLabel ?? label}
		onvalidvalue={(next) => {
			if (typeof next === 'number') onchange(next);
		}}
	/>
</PreferenceRow>