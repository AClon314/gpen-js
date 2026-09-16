<script lang="ts">
	import { tick } from 'svelte';

	import InputNumber from '#lib/components/widgets/inputs/InputNumber.svelte';
	import { decimalPlaces, decimalPlacesInText } from '#lib/inputs/numericCaret';
	import { scrubValue } from '#lib/inputs/numericScrub';
	import type { InputProps, InputValue } from '#lib/components/widgets/inputs/types';

	// InputSlider = InputNumber + 浮层（Blender 风滑条）。
	// 点击 / 轻触走原生 focus 行为，激活 InputNumber 编辑模式；长按或拖拽不激活编辑模式，
	// 由本组件直接把绑定值当作滑条值连续调整。编辑模式中（input 已聚焦）拖拽让位给原生选区。
	let {
		value = $bindable<InputValue>(0),
		orientation = 'horizontal',
		unit = '',
		slider: _slider,
		...rest
	}: InputProps = $props();

	const DRAG_THRESHOLD = 4; // 视为拖拽而非点击的像素阈值
	const LONG_PRESS_MS = 250; // 无位移长按进入拖拽的毫秒数

	let root = $state<HTMLDivElement | undefined>();
	let scrubbing = $state(false);
	let locked = $state(false);
	let pending = false;
	let accumulated = 0;
	let startX = 0;
	let startY = 0;
	let startValue = 0;
	// 拖拽精度来自**当前值本身的小数位数**：`10`/`100` → `1`，`9.98` → `0.01`，
	// `9.987` → `0.001`。开始拖拽时锁定，避免拖到 `10` 时精度突然变粗。
	let scrubDecimals = 0;
	let pointerId: number | undefined;
	let pointerType = '';
	let longPressTimer: ReturnType<typeof setTimeout> | undefined;

	const vertical = $derived(orientation === 'vertical');
	const lower = $derived(attributeNumber(rest.min));
	const upper = $derived(attributeNumber(rest.max));
	const hasRange = $derived(lower !== undefined && upper !== undefined);
	const ratio = $derived.by(() => {
		if (lower === undefined || upper === undefined || upper === lower) return 0;
		const current = typeof value === 'number' && Number.isFinite(value) ? value : lower;
		return Math.min(1, Math.max(0, (current - lower) / (upper - lower)));
	});

	function attributeNumber(candidate: number | string | null | undefined): number | undefined {
		if (candidate === '' || candidate === null || candidate === undefined) return undefined;
		const parsed = Number(candidate);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	function innerInput(): HTMLInputElement | undefined {
		return root?.querySelector('input') ?? undefined;
	}

	function currentNumber(): number {
		return typeof value === 'number' && Number.isFinite(value) ? value : 0;
	}

	// 拖拽精度取**当前输入文本**的小数位（包含用户敲的尾零：`18.0` → 0.1），而不是解析后的值。
	function textDecimals(): number {
		const text = innerInput()?.value;
		if (text !== undefined && text.trim() !== '' && Number.isFinite(Number(text))) {
			return decimalPlacesInText(text);
		}
		return decimalPlaces(currentNumber());
	}

	function clearLongPress() {
		if (longPressTimer !== undefined) {
			clearTimeout(longPressTimer);
			longPressTimer = undefined;
		}
	}

	function beginScrub() {
		if (scrubbing) return;
		scrubbing = true;
		scrubDecimals = textDecimals();
		clearLongPress();
		innerInput()?.blur(); // 拖拽不激活 InputNumber 编辑模式
		// 直到确认拖拽才捕获指针：pointerdown 就捕获会让兼容鼠标事件改派到 wrapper，
		// 输入框拿不到 mousedown，点击就无法进入编辑模式。
		if (pointerId !== undefined) root?.setPointerCapture(pointerId);
		requestPointerLock();
	}
	// 指针锁定后 cursor 不再受屏幕边缘约束，movementX 可以无限累积（Blender 式无限拉）。
	// 锁定失败就退回「指针 - 起点」的绝对坐标拖拽。
	function requestPointerLock() {
		const element = root;
		if (element === undefined || typeof element.requestPointerLock !== 'function') return;
		// 只对鼠标申请指针锁：touch/pen 上锁定会弹出「按 ESC 退出」提示，且本来就有屏幕边界。
		if (pointerType !== 'mouse') return;
		// WebDriver 的合成事件里 movementX/Y 是无效值（指针锁定后 clientX 冻结、movement 乱跳），
		// 锁上反而算错；只在真实浏览器（非 webdriver）启用无限拖拽。
		if (navigator.webdriver) return;
		void Promise.resolve(element.requestPointerLock()).catch((error: unknown) => {
			console.debug('[gpen] pointer lock unavailable', error);
			return;
		});
	}

	function dragDelta(event: PointerEvent): number {
		return vertical ? startY - event.clientY : event.clientX - startX;
	}

	function handlePointerDown(event: PointerEvent) {
		if (rest.disabled) return;
		if (event.target instanceof HTMLElement && event.target.closest('button')) return;
		// 已经在编辑模式（input 聚焦）时让位：拖拽交给原生文本选区。
		const active = document.activeElement;
		if (active instanceof HTMLInputElement && root?.contains(active)) return;

		pending = true;
		pointerId = event.pointerId;
		pointerType = event.pointerType;
		accumulated = 0;
		startX = event.clientX;
		startY = event.clientY;
		startValue = currentNumber();
		clearLongPress();
		longPressTimer = setTimeout(() => {
			longPressTimer = undefined;
			beginScrub();
		}, LONG_PRESS_MS);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!pending || event.pointerId !== pointerId) return;
		if (!scrubbing) {
			if (Math.abs(dragDelta(event)) < DRAG_THRESHOLD) return;
			beginScrub();
		}
		if (!scrubbing) return;
		if (locked) {
			// 锁定后 clientX/Y 冻结，只能靠相对位移累加（可以拉过屏幕边缘）。
			accumulated += vertical ? -event.movementY : event.movementX;
		} else {
			accumulated = vertical ? startY - event.clientY : event.clientX - startX;
		}
		value = scrubValue(startValue, accumulated, scrubDecimals, startValue, lower, upper);
	}

	function releasePointer(event: PointerEvent): boolean {
		if (event.pointerId !== pointerId) return false;
		clearLongPress();
		pending = false;
		pointerId = undefined;
		if (root?.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
		if (document.pointerLockElement === root) document.exitPointerLock();
		return true;
	}

	async function finishScrub() {
		if (!scrubbing) return;
		scrubbing = false;
		// 等 InputNumber 的「value → draft」镜像 effect flush，再广播给消费方。
		await tick();
		const element = innerInput();
		if (element === undefined) return;
		element.dispatchEvent(new Event('input', { bubbles: true }));
		element.dispatchEvent(new Event('change', { bubbles: true }));
	}

	async function handlePointerUp(event: PointerEvent) {
		if (!releasePointer(event)) return;
		await finishScrub();
	}

	function handlePointerCancel(event: PointerEvent) {
		if (!releasePointer(event)) return;
		void finishScrub();
	}

	// ESC / 失焦会掉指针锁：此时若仍在 scrub，就把当前值当作拖拽结束提交。
	$effect(() => {
		const handleLockChange = () => {
			const isLocked = document.pointerLockElement === root;
			if (locked && !isLocked && scrubbing) void finishScrub();
			locked = isLocked;
		};
		document.addEventListener('pointerlockchange', handleLockChange);
		return () => document.removeEventListener('pointerlockchange', handleLockChange);
	});
</script>

<div
	class="input-slider"
	class:scrubbing
	class:vertical
	bind:this={root}
	data-input-slider
	data-orientation={orientation}
	role="group"
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
>
	{#if hasRange}
		<div
			class="slider-fill"
			style:width={vertical ? undefined : `${ratio * 100}%`}
			style:height={vertical ? `${ratio * 100}%` : undefined}
		></div>
	{/if}
	<InputNumber bind:value {orientation} {unit} {...rest} />
</div>

<style>
	.input-slider {
		position: relative;
		display: block;
		box-sizing: border-box;
		width: 100%;
		/* 横向滑条把纵向留给页面滚动，纵向滑条反过来；拖拽本身由 pointer capture 接管。 */
		touch-action: pan-y;
		user-select: none;

		&.vertical {
			touch-action: pan-x;
			width: 2ch;

			.slider-fill { inset-block: auto; inset-inline: 1px; bottom: 1px; }
			&.scrubbing { cursor: ns-resize; }
		}
		&.scrubbing {
			cursor: ew-resize;

			:global(input) { user-select: none; }
		}

		/* 让 InputNumber 铺满滑条，并把它的背景交给浮层（变量覆盖而非改子组件样式）。 */
		:global(.input-widget) {
			--input-background: transparent;
			--input-background-hover: transparent;
			--input-background-focus: transparent;
			position: relative;
			z-index: 1;
		}
	}

	.slider-fill {
		position: absolute;
		z-index: 0;
		inset-block: 1px;
		inset-inline-start: 1px;
		border-radius: var(--gpen-radius);
		background: color-mix(in srgb, var(--gpen-panel-accent) 22%, transparent);
		pointer-events: none;
	}
</style>
