<script lang="ts">
	import { tick } from 'svelte';

	import InputNumber from '#lib/components/widgets/inputs/InputNumber.svelte';
	import {
		finiteNumber,
		numericAttribute,
		stepAmount,
		stepByRule,
		stepRuleAt,
		type StepRule,
	} from '#lib/inputs/numericCaret';
	import { consumeScrubSteps } from '#lib/inputs/numericScrub';
	import type { InputProps, InputValue } from '#lib/components/widgets/inputs/types';

	// InputSlider = InputNumber + 浮层（Blender 风滑条）。
	// 点击 / 轻触走原生 focus 行为，激活 InputNumber 编辑模式；长按或拖拽不激活编辑模式，
	// 由本组件直接把绑定值当作滑条值步进。编辑模式中（input 已聚焦）拖拽让位给原生选区。
	//
	// 拖拽把滑条沿轴平均分成三段（`stepRuleAt`）：靠近 − 的 1/3 用「智能整数位」，
	// 中央 1/3 用 props.step，靠近 + 的 1/3 用「用户最大精度」。
	// **规则在 pointerdown 时按落点选定，松开前不再变**（拖到别的分区不会换规则）；
	// 步进是离散的：每 6px 走一步，方向由拖拽位移的符号决定。
	let {
		value = $bindable<InputValue>(0),
		orientation = 'horizontal',
		unit = '',
		...rest
	}: InputProps = $props();

	const DRAG_THRESHOLD = 4; // 视为拖拽而非点击的像素阈值
	const LONG_PRESS_MS = 250; // 无位移长按进入拖拽的毫秒数
	const SLIDER_RULES = ['digit', 'step', 'precision'] as const; // 沿轴从 − 到 +

	let root = $state<HTMLDivElement | undefined>();
	let scrubbing = $state(false);
	let locked = $state(false);
	// pointerdown 落点选定的步进规则（= 分区），整个拖拽期间锁定；
	// 靠近 − 用 digit、中央用 step、靠近 + 用 precision。
	let downRule = $state<StepRule>('step');
	let pending = false;
	let accumulated = 0; // 相对起点的总位移
	let consumed = 0; // 已经兑换成步进的那部分位移（余量留着，避免抖动）
	let startX = 0;
	let startY = 0;
	let pointerId: number | undefined;
	let pointerType = '';
	let longPressTimer: ReturnType<typeof setTimeout> | undefined;

	const vertical = $derived(orientation === 'vertical');
	const lower = $derived(numericAttribute(rest.min));
	const upper = $derived(numericAttribute(rest.max));
	const hasRange = $derived(lower !== undefined && upper !== undefined);
	const ratio = $derived.by(() => {
		if (lower === undefined || upper === undefined || upper === lower) return 0;
		const current = finiteNumber(value) ?? lower;
		return Math.min(1, Math.max(0, (current - lower) / (upper - lower)));
	});

	function innerInput(): HTMLInputElement | undefined {
		return root?.querySelector('input') ?? undefined;
	}

	// 指针沿拖拽轴的位置：0 = 减号端，1 = 加号端（垂直形态向上为加）。
	function pointerRatio(event: PointerEvent): number {
		const rect = root?.getBoundingClientRect();
		if (rect === undefined || rect.width === 0 || rect.height === 0) return 0.5;
		const raw = vertical
			? 1 - (event.clientY - rect.top) / rect.height
			: (event.clientX - rect.left) / rect.width;
		return Math.min(1, Math.max(0, raw));
	}

	function clearLongPress() {
		if (longPressTimer !== undefined) {
			clearTimeout(longPressTimer);
			longPressTimer = undefined;
		}
	}

	// 一次离散步进：纯函数算文本，写回内部 input 并广播 `input`，让 InputNumber
	// 同步 draft / 绑定值 / draftDecimals（消费方回调与手工编辑同路径）。
	function applyStep(direction: -1 | 1) {
		const element = innerInput();
		if (element === undefined) return;
		const result = stepByRule(element.value, direction, downRule, {
			step: stepAmount(rest.step),
			lower,
			upper,
		});
		if (!Number.isFinite(result.value) || result.text === element.value) return;
		element.value = result.text;
		element.dispatchEvent(new Event('input', { bubbles: true }));
	}

	// 每走满一步的像素数就兑换一步（纯函数给出步数与余量），余量留给下一次，
	// 所以来回微动不会反复触发。
	function stepAccumulated() {
		const { steps, consumed: nextConsumed } = consumeScrubSteps(accumulated, consumed);
		consumed = nextConsumed;
		const direction: -1 | 1 = steps < 0 ? -1 : 1;
		for (let index = 0; index < Math.abs(steps); index += 1) applyStep(direction);
	}

	// 规则已经由 handlePointerDown 按落点定好，这里只管进入 scrub 状态。
	function beginScrub() {
		if (scrubbing) return;
		scrubbing = true;
		clearLongPress();
		innerInput()?.blur(); // 拖拽不激活 InputNumber 编辑模式
		// 直到确认拖拽才捕获指针：pointerdown 就捕获会让兼容鼠标事件改派到 wrapper，
		// 输入框拿不到 mousedown，点击就无法进入编辑模式。
		// 指针已在别处释放时 setPointerCapture 会抛 NotFoundError：放弃捕获与指针锁，
		// 退回「指针 - 起点」的绝对坐标拖拽（handlePointerMove 不依赖捕获）。
		if (pointerId !== undefined) {
			try {
				root?.setPointerCapture(pointerId);
			} catch (error) {
				console.debug('[gpen] pointer capture unavailable', error);
				return;
			}
		}
		requestPointerLock();
	}
	// 指针锁定后 cursor 不再受屏幕边缘约束，movementX 可以无限累积（Blender 式无限拉）。
	// 锁定失败就退回「指针 - 起点」的绝对坐标拖拽。
	// 触屏优先的设备（`pointer: coarse`，含 Android Chrome）不做指针锁：那里的 Pointer Lock
	// 仍是半成品——movementX/Y 的轴、缩放、灵敏度都不可靠，锁上会得到乱跳的位移；
	// 这些设备（无论手指还是鼠标）都走「指针捕获 + 绝对坐标」。
	function canLockPointer(): boolean {
		if (typeof window.matchMedia !== 'function') return true;
		return !window.matchMedia('(pointer: coarse)').matches;
	}

	function requestPointerLock() {
		const element = root;
		if (element === undefined || typeof element.requestPointerLock !== 'function') return;
		// 只对鼠标申请指针锁：touch/pen 上锁定会弹出「按 ESC 退出」提示，且本来就有屏幕边界。
		if (pointerType !== 'mouse') return;
		if (!canLockPointer()) return;
		// WebDriver 的合成事件里 movementX/Y 是无效值（指针锁定后 clientX 冻结、movement 乱跳），
		// 锁上反而算错；只在真实浏览器（非 webdriver）启用无限拖拽。
		if (navigator.webdriver) return;
		void Promise.resolve(element.requestPointerLock()).catch((error: unknown) => {
			console.debug('[gpen] pointer lock unavailable', error);
			return;
		});
	}

	function handlePointerDown(event: PointerEvent) {
		if (rest.disabled) return;
		if (event.target instanceof HTMLElement && event.target.closest('button')) return;
		// 多指：第一根手指已经进入「待拖拽 / 拖拽中」时忽略后来者，否则第二根手指
		// 会顶掉 pointerId 与落点规则，把正在进行的拖拽抢走（触屏上很常见）。
		if (pending) return;
		// 已经在编辑模式（input 聚焦）时让位：拖拽交给原生文本选区。
		const active = document.activeElement;
		if (active instanceof HTMLInputElement && root?.contains(active)) return;

		pending = true;
		pointerId = event.pointerId;
		pointerType = event.pointerType;
		accumulated = 0;
		consumed = 0;
		downRule = stepRuleAt(pointerRatio(event));
		startX = event.clientX;
		startY = event.clientY;
		clearLongPress();
		longPressTimer = setTimeout(() => {
			longPressTimer = undefined;
			beginScrub();
		}, LONG_PRESS_MS);
	}

	function handlePointerMove(event: PointerEvent) {
		if (!pending || event.pointerId !== pointerId) return;
		if (!scrubbing) {
			const delta = vertical ? startY - event.clientY : event.clientX - startX;
			if (Math.abs(delta) < DRAG_THRESHOLD) return;
			beginScrub();
		}
		if (!scrubbing) return;
		if (locked) {
			// 锁定后指针不再移动（clientX/Y 冻结），只能靠相对位移累加。
			accumulated += vertical ? -event.movementY : event.movementX;
		} else {
			// 未锁定（touch / pen / 触屏优先设备）：绝对坐标。分区不在移动中重采样。
			accumulated = vertical ? startY - event.clientY : event.clientX - startX;
		}
		stepAccumulated();
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

	// 每一步已经广播过 `input`，这里只补一次 `change`（拖拽结束的提交语义）。
	async function finishScrub() {
		if (!scrubbing) return;
		scrubbing = false;
		await tick();
		innerInput()?.dispatchEvent(new Event('change', { bubbles: true }));
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
	data-step-rule={downRule}
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
	<!-- 三段分区（智能整数位 / 配置 step / 用户最大精度）：悬浮或拖拽时显形。 -->
	<div class="slider-zones" aria-hidden="true">
		{#each SLIDER_RULES as candidate (candidate)}
			<span class="slider-zone" class:active={candidate === downRule}></span>
		{/each}
	</div>
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

		/* 垂直：宽度跟随 InputNumber（--gpen-char-width），高度由 InputNumber 的
		 * min-height / flex 决定（这里不再重复写 4 行，也不写 height: 100%）。 */
		&.vertical {
			display: flex;
			flex: 1 1 auto;
			flex-direction: column;
			width: fit-content;
			max-width: calc(var(--gpen-char-width, 6) * 1ch);
			height: auto;
			touch-action: pan-x;

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

		&:hover .slider-zones,
		&.scrubbing .slider-zones {
			opacity: 1;
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

	.slider-zones {
		position: absolute;
		z-index: 0;
		display: flex;
		inset: 1px;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}

	.slider-zone {
		flex: 1 1 0;
		border-inline-end: 1px dashed color-mix(in srgb, var(--gpen-panel-border) 80%, transparent);

		&:last-child { border-inline-end: 0; }
		&.active {
			background: color-mix(in srgb, var(--gpen-panel-accent) 12%, transparent);
		}
	}

	/* 垂直形态：− 在下、+ 在上，所以第一段（智能整数位）放在最下面。 */
	.vertical .slider-zones {
		flex-direction: column-reverse;
	}

	.vertical .slider-zone {
		border-inline-end: 0;
		border-block-end: 1px dashed color-mix(in srgb, var(--gpen-panel-border) 80%, transparent);

		&:last-child { border-block-end: 0; }
	}
</style>
