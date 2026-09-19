<script lang="ts">
	import { tick, untrack } from 'svelte';

	import { contextMenu, type MenuItem } from '#lib/components/contextMenu/contextMenu.svelte';
	import {
		addStepToValue,
		clampTo,
		decimalPlaces,
		decimalPlacesInText,
		finiteNumber,
		numericAttribute,
		softClampTo,
		stepAmount,
		stepAtCaret,
		toggleSign,
	} from '#lib/inputs/numericCaret';
	import { STD_UNITS, bindUnit } from '#lib/inputs/units';
	import type { InputProps, InputValue } from '#lib/components/widgets/inputs/types';

	// InputNumber 由 Input.svelte 在运行时 value 为 number 时选中。
	// 原生 type="number" 在 Chrome 不提供 selectionStart/setSelectionRange，做不到「按光标
	// 位权步进」；这是唯一必须偏离原生的点，因此这里用 type="text" + inputmode="decimal"
	// 自管数值语义：数值/单位/校验分别由 role="spinbutton"、aria-*、setCustomValidity 补回。
	// $bindable 保持 number | string 联合，分发壳才能原样 bind:value（内部假定运行时是 number）。
	type InputElementEvent = Event & { currentTarget: HTMLInputElement };
	type InputKeyEvent = KeyboardEvent & { currentTarget: HTMLInputElement };
	type InputFocusEvent = FocusEvent & { currentTarget: HTMLInputElement };
	type InputWheelEvent = WheelEvent & { currentTarget: HTMLInputElement };
	type InputClipboardEvent = ClipboardEvent & { currentTarget: HTMLInputElement };
	type CaretStep = { text: string; caret: number };

	let {
		value = $bindable<InputValue>(0),
		orientation = 'horizontal',
		units = STD_UNITS,
		activeUnit,
		onchange,
		oninput,
		onvalidvalue,
		onkeydown,
		onfocus,
		onwheel,
		onpaste,
		onblur,
		class: inputClass,
		// 调用方的 style 作用于**控件外框**（根节点），不往下传给内部 input：
		// 内联声明能压过组件自己的 `width: 100%`，所以 `style="width: 8ch"` 是唯一可靠的尺寸入口。
		// （`class` 仍然落在内部 input 上，见 docs/input.md。）
		style,
		'aria-label': ariaLabel,
		...rest
	}: InputProps = $props();

	// 单位：`units` 给一张量纲表（或整个注册表），`activeUnit` 是显示单位（缺省取量纲表的 base）。
	// `value` 以该量纲的**基准单位**存储，`min`/`max`/`step` 仍按显示单位表述。
	// 没给 `activeUnit` 的注册表 → `binding` 为 `undefined` → 所有换算恒等，行为与没有 units 时一致。
	const binding = $derived(bindUnit(units, activeUnit));

	function toBase(display: number): number {
		return binding === undefined ? display : binding.toBase(display);
	}

	function toDisplay(base: number): number {
		return binding === undefined ? base : binding.toDisplay(base);
	}

	// 初始化文本：绑定值是基准单位，显示要换算到 `activeUnit`。
	function initialDisplay(): InputValue {
		const base = finiteNumber(value);
		return base === undefined ? value : toDisplay(base);
	}

	let input = $state<HTMLInputElement | undefined>();
	// 用户输入过的小数位数：外部改值（滑条拖拽）时用它排版，而不是总回到 step 的位数。
	let draftDecimals: number | undefined;
	let draft = $state(formattedText(initialDisplay()));
	let focusSnapshot: number | undefined;
	let observedValue: InputValue = value;
	let observedUnitId: string | undefined = untrack(() => binding?.unit.id);
	// 指针悬浮在整个控件（含 ± 按钮与 unit）上；Blender 习惯：悬浮时按 Delete 重置为默认值。
	let hovered = $state(false);
	// 默认值取组件创建时收到的 value（还没有 bpy.props 式的属性默认值定义层，挂载初值即近似）。
	const defaultValue = (() => {
		const base = finiteNumber(value);
		return base === undefined ? 0 : toDisplay(base);
	})();
	// 当前值换算到显示单位（绑定值本身是基准单位）。
	const currentDisplay = $derived.by(() => {
		const base = finiteNumber(value);
		return base === undefined ? undefined : toDisplay(base);
	});
	// 输入框旁显示的单位：显示单位的 id（`%` / `px` 这类无换算标签就用一张单表，base 即标签）。
	const unitLabel = $derived(binding?.label ?? '');
	const ariaValueText = $derived(
		currentDisplay !== undefined && unitLabel ? `${currentDisplay} ${unitLabel}` : undefined,
	);
	// min/max 只在**校验**时体现：报告违规给原生 constraint validation，但不改绑定值。
	// 调用方想要限制后的值，自己调 `validateNumeric(value, {min, max, step})`。
	// `step` 不参与校验：步进规则（智能整数位 / 用户最大精度）会故意落在 step 网格之外。
	// 非法 = 既不是纯数字、也不是「数字 + 已知单位」的量。
	// 合法但**尚未提交**的量（`1234g` / `1234 克`）是中性的：不换算，也**不标红**；
	// 只有单位错（`12 xyz`）或压根不是数字（`1.2.3`）才进红色 `:invalid` 状态。
	const invalid = $derived(
		draft.trim() !== '' &&
			!Number.isFinite(Number(draft)) &&
			convertTypedQuantity(draft) === undefined,
	);
	// 校验后的值：只钳 min/max，**不按 step 取整**（step 不参与校验，见 docs/input.md）。
	// value 非有限（非法文本 NaN / 空）→ undefined，绝不下发 NaN。
	const validValue = $derived.by(() => {
		const current = finiteNumber(value);
		if (current === undefined) return undefined;
		return clampTo(current, boundInBase(rest.min), boundInBase(rest.max));
	});
	const validityMessage = $derived.by(() => {
		if (invalid) return '请输入一个数值';
		const current = currentDisplay;
		if (current === undefined) return '';
		const lower = numericAttribute(rest.min);
		const upper = numericAttribute(rest.max);
		if (lower !== undefined && current < lower) return `不能小于 ${lower}`;
		if (upper !== undefined && current > upper) return `不能大于 ${upper}`;
		return '';
	});

	// `min`/`max` 按显示单位表述，而 `value`/`validValue` 是基准单位：比较前换算一次
	// （温度这类仿射换算必须走 `toBase`，不能自己乘系数）。
	function boundInBase(bound: number | string | null | undefined): number | undefined {
		const display = numericAttribute(bound);
		return display === undefined ? undefined : toBase(display);
	}

	// step 的十进制位数同时是提交时的取整位数（`precision` 已并入 step）。
	function stepDecimals(): number | undefined {
		const step = numericAttribute(rest.step);
		return step === undefined ? undefined : decimalPlaces(step);
	}

	function formatValue(next: number): string {
		if (!Number.isFinite(next)) return '';
		const digits = draftDecimals ?? stepDecimals();
		return digits === undefined ? String(next) : next.toFixed(digits);
	}

	// 非法/非有限值没有文本表示（写空串）；已经等值的原文原样保留，否则按显示精度重排。
	function formattedText(next: InputValue, currentText = ''): string {
		if (typeof next !== 'number') return next;
		if (!Number.isFinite(next)) return '';
		if (currentText.trim() !== '' && Number(currentText) === next) return currentText;
		return formatValue(next);
	}

	// min/max 只做「校验」：组件不替调用方取整/钳值。`step` 只是步进量（见 `resolvedStep`）；
	// 需要限制后的值时由调用方调 `validateNumeric(value, {min,max,step})`。
	function softClamp(rawValue: number, origin: number): number {
		return softClampTo(rawValue, origin, numericAttribute(rest.min), numericAttribute(rest.max));
	}

	function readInput(element: HTMLInputElement): number {
		const rawValue = element.value.trim();
		return rawValue === '' ? Number.NaN : Number(rawValue);
	}

	function selectionCaret(element: HTMLInputElement, text: string): number {
		const start = element.selectionStart;
		if (start === null || !Number.isFinite(start)) return text.length;
		return Math.min(text.length, Math.max(0, Math.trunc(start)));
	}

	function setCaret(element: HTMLInputElement, caret: number) {
		const position = Math.min(caret, element.value.length);
		element.setSelectionRange(position, position);
	}

	function broadcastCommit(element: HTMLInputElement) {
		element.dispatchEvent(new Event('input', { bubbles: true }));
		element.dispatchEvent(new Event('change', { bubbles: true }));
	}

	// 统一写出口：draft / 绑定值 / DOM 文本一起更新，不广播（由调用方决定是否广播）。
	// `displayNext` 是**显示单位**下的数值，绑定值换算回基准单位。
	function write(element: HTMLInputElement, text: string, displayNext: number) {
		draft = text;
		value = toBase(displayNext);
		element.value = text;
	}

	// 写回 + 定位 caret + 广播 input/change（applyResult / commandCommit 共用）。
	function commit(element: HTMLInputElement, text: string, next: number, caret = text.length) {
		write(element, text, next);
		setCaret(element, caret);
		broadcastCommit(element);
	}

	// 把纯函数结果写回：soft 边界钳制（不做 step 取整）；值未变则保留纯函数给的文本（保精度）。
	// 空 / 非法文本（`Number('')` 是 0！）不写回，保持用户输入原样。
	function applyResult(element: HTMLInputElement, result: CaretStep, caret?: number) {
		const trimmed = result.text.trim();
		const raw = trimmed === '' ? Number.NaN : Number(trimmed);
		if (!Number.isFinite(raw)) return;
		const next = softClamp(raw, readInput(element));
		commit(element, Object.is(next, raw) ? result.text : formatValue(next), next, caret ?? result.caret);
	}

	// 命令式提交（Home,End / 悬浮 Delete / 右键菜单）：总是钳到边界，写回并广播 input+change。
	function commandCommit(candidate: number) {
		const element = input;
		if (element === undefined) return;
		const next = clampTo(candidate, numericAttribute(rest.min), numericAttribute(rest.max));
		commit(element, formatValue(next), next);
	}

	function boundItem(label: string, bound: number | string | null | undefined): MenuItem {
		const target = numericAttribute(bound);
		return {
			label,
			disabled: target === undefined,
			action: () => {
				if (target !== undefined) commandCommit(target);
			},
		};
	}

	function menuItems(): MenuItem[] {
		if (rest.disabled) return [];
		return [
			{ label: '重置为默认值', action: () => commandCommit(defaultValue) },
			{ separator: true },
			boundItem('设为最小值', rest.min),
			boundItem('设为最大值', rest.max),
		];
	}

	// 只在「裸 Delete」时重置：带修饰键的 Delete（Shift+Delete 剪切、Ctrl/Alt+Delete 删词等）保留原生语义。
	function isBareDelete(event: KeyboardEvent): boolean {
		return (
			event.key === 'Delete' &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey
		);
	}

	function isEditableTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable) return true;
		return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
	}

	// 步进量：缺省按 HTML `<input type=number>` 的语义取 1；显式非数值（如 step="any"）
	// 不偷偷换步长——安全忽略并输出 debug。± 按钮、「caret 贴边时的 ←/→」与
	// InputSlider 的中央分区共用这个解析结果。
	function resolvedStep(): number | undefined {
		const amount = stepAmount(rest.step);
		if (amount === undefined) console.debug('[gpen] unusable input step ignored', rest.step);
		return amount;
	}

	// ↑/↓ 与滚轮：caret 位权步进（纯函数 stepAtCaret）。
	function stepFromCaret(element: HTMLInputElement, direction: -1 | 1): number {
		const result = stepAtCaret(
			element.value,
			selectionCaret(element, element.value),
			direction,
		);
		applyResult(element, result);
		return result.caret;
	}

	// ←/→ 贴边：原生无处可移，改成按配置 step 步进（← 减、→ 增），与 ± 按钮同一出口。
	function stepFromEdge(
		element: HTMLInputElement,
		event: InputKeyEvent,
	): number | undefined {
		const text = element.value;
		const start = element.selectionStart;
		const end = element.selectionEnd;
		const boundary = event.key === 'ArrowLeft' ? 0 : text.length;
		if (
			event.shiftKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey ||
			start === null ||
			end === null ||
			start !== end ||
			start !== boundary
		) {
			return undefined;
		}

		const amount = resolvedStep();
		if (amount === undefined || !Number.isFinite(readInput(element))) return undefined;

		event.preventDefault();
		const direction = event.key === 'ArrowLeft' ? -1 : 1;
		const result = addStepToValue(text, direction, amount);
		const caret = direction === -1 ? 0 : result.caret;
		applyResult(element, result, caret);
		return caret;
	}

	// caret 在「符号区」（最左，或负号/正号之后）时，`-` / `+` 键切换正负号；
	// ↑/↓ 在负号左侧仍可按 case 5 去掉符号，`-` / `+` 则能把正数变成负数（补上符号）。
	function isSignZone(element: HTMLInputElement): boolean {
		const start = element.selectionStart;
		const end = element.selectionEnd;
		if (start === null || end === null || start !== end) return false;
		const text = element.value;
		const front = text.startsWith('-') || text.startsWith('+') ? 1 : 0;
		return start <= front;
	}

	async function handleKeydown(event: InputKeyEvent) {
		const element = event.currentTarget;
		let restoreCaret: number | undefined;

		// 支配条件：disabled 时分支 2/3/5/6 全部不可达；提到最上层，分支里不再重复判。
		if (element.disabled) {
			onkeydown?.(event);
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			if (focusSnapshot !== undefined) {
				write(element, formattedText(focusSnapshot), focusSnapshot);
			}
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			if (finiteNumber(readInput(element)) !== undefined) {
				event.preventDefault();
				restoreCaret = stepFromCaret(element, event.key === 'ArrowUp' ? 1 : -1);
			}
		} else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			restoreCaret = stepFromEdge(element, event);
		} else if (
			(event.key === '-' || event.key === '+') &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			isSignZone(element)
		) {
			event.preventDefault();
			const result = toggleSign(
				element.value,
				selectionCaret(element, element.value),
				event.key === '+' ? 'positive' : undefined,
			);
			applyResult(element, result);
			restoreCaret = result.caret;
		} else if (event.key === 'Home' || event.key === 'End') {
			const start = element.selectionStart;
			const end = element.selectionEnd;
			const boundary = event.key === 'Home' ? 0 : element.value.length;
			const bound = event.key === 'Home' ? numericAttribute(rest.min) : numericAttribute(rest.max);
			if (
				bound !== undefined &&
				start !== null &&
				end !== null &&
				start === end &&
				start === boundary
			) {
				event.preventDefault();
				commandCommit(bound);
				restoreCaret = event.key === 'Home' ? 0 : element.value.length;
			}
		}

		onkeydown?.(event);
		if (restoreCaret !== undefined) {
			// 写 element.value 会把 caret 挪到末尾，而 Svelte 的 value={draft} 更新晚一拍；
			// 同步写一次防止连续按键吃掉一步，tick 后再补一次（仅当文本未改、caret 确实被推到末尾）。
			setCaret(element, restoreCaret);
			const written = element.value;
			await tick();
			if (
				input === element &&
				element.value === written &&
				element.selectionStart === element.value.length
			) {
				setCaret(element, restoreCaret);
			}
		}
	}

	// 滚轮 = 键盘 ↑/↓（case 6），但**只在控件已激活（input 聚焦）时**；未激活时滚轮留给页面滚动。
	function handleWheel(event: InputWheelEvent) {
		const element = event.currentTarget;
		if (
			document.activeElement !== element ||
			element.disabled ||
			event.deltaY === 0 ||
			finiteNumber(readInput(element)) === undefined
		) {
			onwheel?.(event);
			return;
		}
		event.preventDefault();
		const caret = element.selectionStart ?? element.value.length;
		applyResult(element, stepAtCaret(element.value, caret, event.deltaY < 0 ? 1 : -1));
		onwheel?.(event);
	}

	function step(direction: -1 | 1) {
		const element = input;
		if (!element || element.disabled) return;

		const amount = resolvedStep();
		if (amount === undefined || !Number.isFinite(readInput(element))) return;
		applyResult(element, addStepToValue(element.value, direction, amount));
	}

	// 把「数字 + 单位后缀」的文本换算到显示单位（`' 1234克 '` → `1.234`）：未知单位、多个数字
	// 或跨量纲（质量框里粘 `12 cm`）→ `undefined`，由调用方保留原文交给 `:invalid`。
	function convertTypedQuantity(text: string): number | undefined {
		return binding?.parse(text);
	}

	// 纯数字文本（没有单位后缀）→ 显示单位的数值；空 / 非法 → undefined。
	function parsePlainNumber(text: string): number | undefined {
		const trimmed = text.trim();
		if (trimmed === '') return undefined;
		const next = Number(trimmed);
		return Number.isFinite(next) ? next : undefined;
	}

	// 换算结果的文本：不能用 `formatValue`（那会按 step 的位数取整，`3ft → 91.44cm` 会被写成 `91`），
	// 也用不上小数位缓存——`convertTypedQuantity` 已经收敛掉浮点噪音了。
	function displayText(display: number): string {
		const text = String(display);
		draftDecimals = decimalPlacesInText(text);
		return text;
	}

	function handleInput(event: InputElementEvent) {
		const element = event.currentTarget;
		// 输入过程中**不换算**：`1234g` / `1234 克` 属于未提交的编辑态，换算一律等到提交出口
		// （失焦 / Enter，见 `commitTypedQuantity`）。此处只同步纯数字的绑定值。
		draft = element.value;
		const next = readInput(element);
		if (finiteNumber(next) !== undefined) {
			value = toBase(next);
			// 记住用户输入的小数位数（包括末尾的 0），拖拽/外部改值排版时沿用。
			draftDecimals = decimalPlacesInText(element.value);
		}
		oninput?.(event);
	}

	// 把「数字 + 单位后缀」的文本换算成显示单位的数值并写回（`' 1234克 '` → `1.234`）。
	// 幂等：换算后的文本不再带单位，再调一次直接 `false`。
	function commitTypedQuantity(element: HTMLInputElement): boolean {
		const converted = convertTypedQuantity(element.value);
		if (converted === undefined) return false;
		write(element, displayText(converted), converted);
		return true;
	}

	// 粘贴是**显式赋值**（不是在编辑中的文本），所以照旧立即换算：
	// 悬浮 Ctrl+V 时控件根本没有焦点，不会再有 blur 来触发提交。
	function handlePaste(event: InputClipboardEvent) {
		const converted = convertTypedQuantity(event.clipboardData?.getData('text') ?? '');
		if (converted === undefined) {
			onpaste?.(event);
			return;
		}
		event.preventDefault();
		draftDecimals = undefined;
		commit(event.currentTarget, displayText(converted), converted);
		onpaste?.(event);
	}

	// 失焦 = 提交：手敲的单位后缀在这里换算。
	// 浏览器只对「被用户改过」的字段补发 `change`，程序化改写文本的字段不会，
	// 所以这里主动做一次，并补一个 `input` 让消费方知道绑定值变了。
	function handleBlur(event: InputFocusEvent) {
		const element = event.currentTarget;
		if (commitTypedQuantity(element)) {
			focusSnapshot = undefined;
			element.dispatchEvent(new Event('input', { bubbles: true }));
		}
		onblur?.(event);
	}

	function handleChange(event: InputElementEvent) {
		const element = event.currentTarget;
		// Enter（以及已被标脏的失焦）同样走提交换算；已换算过的文本再进这里是空操作。
		if (commitTypedQuantity(element)) {
			focusSnapshot = undefined;
			onchange?.(event);
			return;
		}
		const next = readInput(element);
		if (finiteNumber(next) !== undefined) {
			// min/max 是校验，不在提交时改值；原样写回（同值时保留用户文本）。
			write(element, formattedText(next, element.value), next);
		} else if (element.value.trim() === '') {
			// 清空：回到聚焦快照（或当前值），保持「空 → 上一个有效值」的既有行为。
			const fallback = finiteNumber(focusSnapshot) ?? currentDisplay ?? 0;
			write(element, formatValue(fallback), fallback);
		} else {
			// 非数字文本：不强改用户输入，只把绑定值标成 NaN；危险色与表单校验来自 :invalid。
			value = Number.NaN;
		}
		focusSnapshot = undefined;
		onchange?.(event);
	}

	function handleFocus(event: InputFocusEvent) {
		focusSnapshot = finiteNumber(readInput(event.currentTarget));
		onfocus?.(event);
	}

	// 非法文本交给原生约束校验：<form> 的 checkValidity/reportValidity 会拦截并显示这条消息，
	// :invalid 同时驱动危险色。这是「非法文本不强改」策略与表单体系的接缝。
	$effect(() => {
		input?.setCustomValidity(validityMessage);
	});

	// 下发校验后的值：$effect 读 `validValue` 就天然覆盖「挂载初值 / 外部改值 / 用户输入」
	// 三条路径，不需要挂在 commit() 的各个出口上。
	$effect(() => {
		onvalidvalue?.(validValue);
	});

	$effect(() => {
		const next = value;
		const unitId = binding?.unit.id;
		if (Object.is(next, observedValue) && unitId === observedUnitId) return;
		observedValue = next;
		observedUnitId = unitId;
		// 正在编辑的文本归用户所有：只在未聚焦时镜像外部变化（含 InputSlider 的拖拽）。
		if (input !== undefined && document.activeElement === input) return;
		// 非法提交后绑定值是 NaN：保留用户已输入的文本，不要清空。
		if (typeof next === 'number' && !Number.isFinite(next)) return;
		const base = finiteNumber(next);
		draft = formattedText(base === undefined ? next : toDisplay(base));
	});

	// 悬浮但 input 未聚焦时按键不会进入 handleKeydown，用 window 兜底；
	// 焦点在别的可编辑元素（页面输入框、contenteditable 等）时让路，不抢它们的 Delete / 剪切板。
	$effect(() => {
		if (!hovered) return;

		const handleWindowKeydown = (event: KeyboardEvent) => {
			if (!isBareDelete(event) || event.defaultPrevented) return;
			const element = input;
			if (element === undefined || element.disabled || event.target === element) return;
			if (isEditableTarget(event.target)) return;
			event.preventDefault();
			commandCommit(defaultValue);
		};

		// Blender 习惯：鼠标悬浮在控件上（且焦点不在可编辑元素里）时，Ctrl+C 复制内部值、
		// Ctrl+V 粘回去。用 copy/paste 事件而不是 navigator.clipboard：前者不需要权限、
		// 也不依赖异步 API，而且在没有选区的页面上照样会触发。
		// 焦点在本控件的 input 上时（正在编辑）一律让路，保留原生的选区复制/粘贴语义。
		const canUseWindowClipboard = (event: ClipboardEvent): HTMLInputElement | undefined => {
			const element = input;
			if (element === undefined || element.disabled || element.readOnly) return undefined;
			if (event.defaultPrevented || event.target === element) return undefined;
			if (isEditableTarget(event.target)) return undefined;
			return element;
		};

		const handleWindowCopy = (event: ClipboardEvent) => {
			const element = canUseWindowClipboard(event);
			if (element === undefined) return;
			const current = currentDisplay;
			// 复制的是**显示单位**下的值（所见即所拷）；非法/空值没有可拷的数值。
			if (current === undefined) return;
			event.preventDefault();
			event.clipboardData?.setData('text/plain', String(current));
		};

		const handleWindowPaste = (event: ClipboardEvent) => {
			const element = canUseWindowClipboard(event);
			if (element === undefined) return;
			const text = event.clipboardData?.getData('text/plain') ?? '';
			// 先试「数字 + 单位」（会换算到显示单位），再退回纯数字；都不是就不动。
			const next = convertTypedQuantity(text) ?? parsePlainNumber(text);
			if (next === undefined) return;
			event.preventDefault();
			commit(element, displayText(next), next);
		};

		window.addEventListener('keydown', handleWindowKeydown);
		window.addEventListener('copy', handleWindowCopy);
		window.addEventListener('paste', handleWindowPaste);
		return () => {
			window.removeEventListener('keydown', handleWindowKeydown);
			window.removeEventListener('copy', handleWindowCopy);
			window.removeEventListener('paste', handleWindowPaste);
		};
	});
</script>

<div
	class="input-widget"
	class:disabled={rest.disabled}
	use:contextMenu={menuItems}
	{style}
	data-input-widget
	data-orientation={orientation}
	role="group"
	onpointerenter={() => (hovered = true)}
	onpointerleave={() => (hovered = false)}
>
	<button
		class="input-step input-step--down"
		type="button"
		aria-label="减少"
		disabled={rest.disabled}
		onclick={() => step(-1)}
	>
		−
	</button>
	<input
		bind:this={input}
		{...rest}
		type="text"
		inputmode="decimal"
		role="spinbutton"
		class={`input-field${inputClass ? ` ${inputClass}` : ''}`}
		aria-label={ariaLabel}
		aria-valuenow={currentDisplay}
		aria-valuemin={numericAttribute(rest.min)}
		aria-valuemax={numericAttribute(rest.max)}
		aria-valuetext={ariaValueText}
		aria-invalid={validityMessage !== '' || undefined}
		value={draft}
		oninput={handleInput}
		onchange={handleChange}
		onpaste={handlePaste}
		onblur={handleBlur}
		onfocus={handleFocus}
		onkeydown={handleKeydown}
		onwheel={handleWheel}
	/>
	{#if unitLabel}
		<span class="input-unit" aria-hidden="true">{unitLabel}</span>
	{/if}
	<button
		class="input-step input-step--up"
		type="button"
		aria-label="增加"
		disabled={rest.disabled}
		onclick={() => step(1)}
	>
		+
	</button>
</div>

<style>
	.input-widget {
		box-sizing: border-box;
		display: inline-flex;
		align-items: stretch;
		width: 100%;
		height: calc(2 * var(--gpen-line-height) * 1lh);
		padding: 0 0.35ch;
		border: 1px solid var(--gpen-panel-border);
		border-radius: var(--gpen-radius);
		background: var(--input-background, var(--gpen-panel-background));
		color: var(--gpen-panel-foreground);
		font: inherit;
		/* 控件自己的行高就是 token，于是 1lh 处处同值（不受宿主页 line-height 影响）。 */
		line-height: var(--gpen-line-height, 1);
		font-variant-numeric: tabular-nums;
		user-select: none;

		&.disabled { opacity: 0.55; }
		&:focus-within {
			border-color: var(--gpen-panel-accent);
			background: var(--input-background-focus, var(--gpen-panel-background));
			box-shadow: 0 0 0 1px rgb(79 70 229 / 0.18);
		}
		&:hover:not(:focus-within) {
			border-color: var(--gpen-panel-muted);
			background: var(
				--input-background-hover,
				color-mix(in srgb, var(--gpen-panel-accent) 8%, var(--gpen-panel-background))
			);
		}

		/* 垂直形态：宽度取 --gpen-char-width（竖向控件的统一宽度，默认 6ch）；
		 * 每行高 = 2 个 token 行高（--gpen-row，与水平控件等高）：
		 * 高度不写死——作为 flex 子项时用 `flex: 1 1 auto` 撑满可用高度，多的空间全给 value；
		 * 不在 flex 父级里就退回 `min-height`（4 行 × 2lh），因此不会撑破父级卡片。 */
		&[data-orientation='vertical'] {
			--gpen-row: calc(2 * var(--gpen-line-height, 1) * 1lh);

			flex: 1 1 auto;
			flex-direction: column;
			width: calc(var(--gpen-char-width, 6) * 1ch);
			height: auto;
			min-height: calc(4 * var(--gpen-row));
			/* 四行要正好铺满控件，所以不再加纵向 padding（横向 padding 由根上那条覆盖掉）。 */
			padding: 0;

			/* ± 与 unit 固定占一行（2lh）；字号回落到根字号，`1lh` 才等于根的行高。 */
			.input-step {
				flex: 0 0 auto;
				height: var(--gpen-row);
				font-size: 1em;
			}
			.input-step--up { order: -1; }
			.input-step--down { order: 2; }
			/* 剩下的高度全给可编辑的 value。 */
			.input-field { flex: 1 1 auto; width: 100%; }
			.input-unit {
				display: grid;
				flex: 0 0 auto;
				height: var(--gpen-row);
				margin-inline: 0;
				font-size: 1em;
				place-items: center;
			}
		}
	}

	.input-step {
		display: grid;
		flex: 0 0 auto;
		place-items: center;
		padding: 0 0.5ch;
		border: 0;
		background: transparent;
		color: var(--gpen-panel-muted);
		font: inherit;
		font-size: 1.1em;
		font-weight: 700;
		cursor: pointer;
		user-select: none;

		&:hover:not(:disabled),
		&:focus-visible {
			background: color-mix(in srgb, var(--gpen-panel-accent) 16%, transparent);
			color: var(--gpen-panel-accent);
			outline: none;
		}
		&:disabled { cursor: default; opacity: 0.45; }
	}

	.input-field {
		box-sizing: border-box;
		flex: 1 1 auto;
		min-width: 0;
		padding: 0 0.4ch;
		border: 0;
		border-radius: var(--gpen-radius-sm);
		outline: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: center;
		user-select: text;

		/* 非数字文本：只提示颜色（与 setCustomValidity 同源），不改写用户输入 */
		&:invalid { background: var(--gpen-danger); }
		&:focus-visible { outline: 2px solid var(--gpen-panel-accent); outline-offset: -1px; }
		&:disabled { cursor: not-allowed; }
	}

	.input-unit {
		align-self: center;
		flex: 0 0 auto;
		margin-inline-start: 0.2ch;
		color: var(--gpen-panel-muted);
		font-size: 0.9em;
		white-space: nowrap;
		user-select: none;
	}
</style>
