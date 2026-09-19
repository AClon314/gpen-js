<script lang="ts">
	import '@spectrum-web-components/color-area/sp-color-area.js';
	import '@spectrum-web-components/color-field/sp-color-field.js';
	import '@spectrum-web-components/color-slider/sp-color-slider.js';

	import type { ColorArea } from '@spectrum-web-components/color-area';
	import type { ColorField } from '@spectrum-web-components/color-field';
	import type { ColorSlider } from '@spectrum-web-components/color-slider';

	import SpectrumTheme from '#lib/components/widgets/colors/SpectrumTheme.svelte';

	// SWC 的元素不是表单控件：值走 **property**（`el.color` / `el.value`），
	// 变化走 `input`（拖动中）/ `change`（提交）两个自定义事件，都 bubbles + composed。
	// 元素类本身由 SWC 的 `HTMLElementTagNameMap` 声明提供，`bind:this` 已经能拿到正确类型。

	interface ColorPickerProps {
		/** `#rrggbb`；协议侧的 `Vec3T`（0..1 浮点）在调用方换算。 */
		value?: string;
		disabled?: boolean;
		/** 无障碍标签前缀（面积图的 X/Y 轴与色相条各自加后缀）。 */
		label?: string;
		class?: string;
		style?: string;
	}

	let {
		value = $bindable('#ff0000'),
		disabled = false,
		label = '颜色',
		class: className,
		style,
	}: ColorPickerProps = $props();

	let area = $state<ColorArea>();
	let hue = $state<ColorSlider>();
	let field = $state<ColorField>();

	let scheme = $state<'light' | 'dark'>(preferredScheme());
	// 回声守卫：拖动期间 SWC 元素是真值源，绑定的 `value` 只是镜像。
	let observedValue = value;

	function preferredScheme(): 'light' | 'dark' {
		if (typeof matchMedia !== 'function') return 'dark';
		return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	/** SWC 回读的颜色格式跟着写入格式走，所以一律规范成 `#rrggbb` 小写。 */
	function normalizeHex(color: unknown): string | undefined {
		if (typeof color !== 'string') return undefined;
		const text = color.trim().toLowerCase();
		if (/^#[0-9a-f]{6}$/.test(text)) return text;
		if (/^#[0-9a-f]{3}$/.test(text)) {
			return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
		}
		const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(text);
		if (rgb !== null) {
			const hex = rgb.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0'));
			return `#${hex.join('')}`;
		}
		return undefined;
	}

	/** 把基准值推进 SWC 元素；用户拖拽产生的变化由 `observedValue` 守卫挡掉。 */
	function push(next: string) {
		if (area !== undefined) area.color = next;
		if (hue !== undefined) hue.color = next;
		if (field !== undefined) field.value = next;
	}

	/** 从任一元素回读并提交（面积图按 README 是 hex 格式，最可靠）。 */
	function pull(next: unknown) {
		const hex = normalizeHex(next);
		if (hex === undefined || hex === value) return;
		value = hex;
		observedValue = hex;
		push(hex);
	}

	$effect(() => {
		const next = value;
		if (Object.is(next, observedValue)) return;
		observedValue = next;
		push(next);
	});

	$effect(() => {
		const query = matchMedia('(prefers-color-scheme: dark)');
		const update = () => (scheme = query.matches ? 'dark' : 'light');
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	// 挂载后把初始值推进元素（SWC 元素在注册完成前是未知元素，property 得等它 upgrade）。
	$effect(() => {
		push(value);
	});
</script>

<SpectrumTheme color={scheme}>
	<div
		class={`color-picker${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}
		{style}
		data-color-picker
	>
		<div class="color-picker__body">
			<sp-color-area
				bind:this={area}
				{disabled}
				label-x={`${label}：饱和度`}
				label-y={`${label}：明度`}
				oninput={(event: Event) => pull((event.currentTarget as ColorArea).color)}
				onchange={(event: Event) => pull((event.currentTarget as ColorArea).color)}
			></sp-color-area>
			<sp-color-slider
				bind:this={hue}
				{disabled}
				label={`${label}：色相`}
				oninput={(event: Event) => pull((event.currentTarget as ColorSlider).color)}
				onchange={(event: Event) => pull((event.currentTarget as ColorSlider).color)}
			></sp-color-slider>
		</div>
		<div class="color-picker__footer">
			<!-- 预览用自己的 div：`sp-swatch` 默认是 `role="button"` + 可聚焦的可选项，
				当装饰预览会得到「可聚焦但 aria-hidden」的坏语义（要正确语义得配合 sp-swatch-group）。 -->
			<span class="color-picker__preview" style="--picked: {value}" aria-hidden="true"></span>
			<sp-color-field
				bind:this={field}
				{disabled}
				size="s"
				label={`${label}：十六进制值`}
				oninput={(event: Event) => pull((event.currentTarget as ColorField).value)}
				onchange={(event: Event) => pull((event.currentTarget as ColorField).value)}
			></sp-color-field>
		</div>
	</div>
</SpectrumTheme>

<style>
	.color-picker {
		display: inline-flex;
		box-sizing: border-box;
		flex-direction: column;
		gap: 1lh;
		padding: 1lh 1ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--gpen-panel-background);
		color: var(--gpen-panel-foreground);
		font: inherit;
	}

	.color-picker.disabled {
		opacity: 0.55;
	}

	.color-picker__body {
		display: flex;
		flex-direction: column;
		gap: 1lh;
	}

	/* SWC 元素是 shadow DOM 的，尺寸只能从外部（`:host` 级）给；
	 * 而且**必须**走它的 `--mod-*` 变量：面积图内部手柄的位移量
	 * （`.handle { transform: translate(calc(var(--mod-colorarea-width) - border)) }`）
	 * 直接读这个变量——用普通 `width` 改尺寸会让手柄错位。
	 * 布局跟 Blender 一致：方块在上，色相条在下方。 */
	.color-picker sp-color-area {
		--mod-colorarea-width: 24ch;
		--mod-colorarea-height: 24ch;
	}

	.color-picker sp-color-slider {
		width: 100%;
	}

	.color-picker__preview {
		display: inline-block;
		box-sizing: border-box;
		width: 3ch;
		height: 1lh;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius-sm);
		background: var(--picked);
	}

	.color-picker__footer {
		display: flex;
		align-items: center;
		gap: 1ch;
	}

	.color-picker sp-color-field {
		width: 12ch;
	}
</style>
