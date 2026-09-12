<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import {
		contextMenu,
		close as closeMenu,
		menuState,
		open as openMenu,
		type MenuItem
	} from '#lib/components/contextMenu/contextMenu.svelte';

	type InputValue = number | string;
	type Orientation = 'horizontal' | 'vertical';
	type PointerMode = 'pending' | 'scrubbing' | 'longpress' | 'cancelled';

	interface InputProps {
		value?: InputValue;
		min?: number;
		max?: number;
		step?: number;
		precision?: number;
		unit?: string;
		orientation?: Orientation;
		disabled?: boolean;
		label?: string;
		onchange?: (value: InputValue) => void;
	}

	interface PointerSession {
		pointerId: number;
		pointerType: string;
		startX: number;
		startY: number;
		lastX: number;
		lastY: number;
		startValue: InputValue;
		rawValue: number;
		mode: PointerMode;
		moved: boolean;
		pointerLocked: boolean;
	}

	let {
		value = $bindable<InputValue>(0),
		min,
		max,
		step,
		precision,
		unit = '',
		orientation = 'horizontal',
		disabled = false,
		label,
		onchange
	}: InputProps = $props();

	let field = $state<HTMLDivElement | undefined>(undefined);
	let valueElement = $state<HTMLSpanElement | undefined>(undefined);
	let editInput = $state<HTMLInputElement | undefined>(undefined);
	let longPressTimer: number | undefined;
	let activePointer: PointerSession | undefined;

	let editing = $state(false);
	let draft = $state('');
	let editOriginalValue: InputValue | undefined;
	let interactionMode = $state<'idle' | 'scrubbing'>('idle');

	const LONG_PRESS_MS = 450;
	const POINTER_MOVE_THRESHOLD = 6;
	const SCRUB_PIXELS_PER_STEP = 8;

	const isNumeric = $derived(typeof value === 'number');
	const displayValue = $derived(formatDisplayValue(value, precision, step));
	const ariaValueText = $derived(unit ? `${displayValue} ${unit}` : displayValue);
	const numericValue = $derived(typeof value === 'number' ? value : undefined);
	const numericMin = $derived(isNumeric && isFiniteNumber(min) ? min : undefined);
	const numericMax = $derived(isNumeric && isFiniteNumber(max) ? max : undefined);
	const inputRole = $derived(isNumeric ? 'spinbutton' : 'textbox');

	// The action owns the anonymous registry id; reading it back from the DOM
	// lets the touch long-press open the very same menu as the right click.
	const inputMenuProvider = () => inputMenuItems();
	const menuOpen = $derived(menuState.visible && menuState.id === field?.dataset.contextMenuId);

	function isFiniteNumber(candidate: number | undefined): candidate is number {
		return candidate !== undefined && Number.isFinite(candidate);
	}

	function decimalPlaces(candidate: number): number {
		if (!Number.isFinite(candidate)) return 0;
		const text = Math.abs(candidate).toString().toLowerCase();
		const [coefficient, exponentText] = text.split('e');
		const fractionLength = coefficient.includes('.') ? coefficient.split('.')[1].length : 0;
		const exponent = exponentText ? Number(exponentText) : 0;
		return Math.min(12, Math.max(0, fractionLength - exponent));
	}

	function configuredStep(): number | undefined {
		return isFiniteNumber(step) && step > 0 ? step : undefined;
	}

	function configuredPrecision(): number | undefined {
		return isFiniteNumber(precision) && precision >= 0
			? Math.min(12, Math.floor(precision))
			: undefined;
	}

	function roundToPrecision(candidate: number): number {
		const digits = configuredPrecision();
		if (digits === undefined) return Object.is(candidate, -0) ? 0 : candidate;
		return Number(candidate.toFixed(digits));
	}

	function numericBounds(): { lower?: number; upper?: number } {
		if (isFiniteNumber(min) && isFiniteNumber(max)) {
			return { lower: Math.min(min, max), upper: Math.max(min, max) };
		}
		return {
			lower: isFiniteNumber(min) ? min : undefined,
			upper: isFiniteNumber(max) ? max : undefined
		};
	}

	function normalizeNumeric(rawValue: number, snapStep = configuredStep()): number {
		if (!Number.isFinite(rawValue)) return 0;

		const bounds = numericBounds();
		let next = rawValue;
		if (snapStep !== undefined && snapStep > 0) {
			const anchor = bounds.lower ?? 0;
			next = anchor + Math.round((next - anchor) / snapStep) * snapStep;
		}

		next = roundToPrecision(next);
		if (bounds.lower !== undefined) next = Math.max(bounds.lower, next);
		if (bounds.upper !== undefined) next = Math.min(bounds.upper, next);
		return Object.is(next, -0) ? 0 : next;
	}

	function formatNumber(candidate: number): string {
		const explicitPrecision = configuredPrecision();
		const inferredPrecision = Math.max(
			decimalPlaces(candidate),
			configuredStep() === undefined ? 0 : decimalPlaces(configuredStep() as number)
		);
		const digits = explicitPrecision ?? inferredPrecision;
		if (digits === 0) return String(Math.round(candidate));
		return candidate.toFixed(digits);
	}

	function formatDisplayValue(candidate: InputValue, _precision?: number, _step?: number): string {
		return typeof candidate === 'number' ? formatNumber(candidate) : candidate;
	}

	function formatEditableValue(candidate: InputValue): string {
		return typeof candidate === 'number' ? formatNumber(candidate) : candidate;
	}

	function setValue(nextValue: InputValue, notify = true) {
		const previousValue = value;
		value = nextValue;
		if (notify && previousValue !== nextValue) onchange?.(nextValue);
	}

	function commitNumericValue(rawValue: number, snapStep = configuredStep()) {
		setValue(normalizeNumeric(rawValue, snapStep));
	}

	function clearLongPressTimer() {
		if (longPressTimer !== undefined) {
			window.clearTimeout(longPressTimer);
			longPressTimer = undefined;
		}
	}

	function resetValue() {
		if (typeof value === 'number') {
			const resetTo = isFiniteNumber(min) ? min : 0;
			commitNumericValue(resetTo);
		} else {
			setValue('');
		}
	}

	function inputMenuItems(): MenuItem[] {
		if (disabled) return [];

		const items: MenuItem[] = [{ label: '重置', action: resetValue }];
		if (typeof value !== 'number') return items;

		items.push(
			{ separator: true },
			{
				label: '设为最小值',
				disabled: () => !isFiniteNumber(min),
				action: () => {
					if (isFiniteNumber(min)) commitNumericValue(min);
				}
			},
			{
				label: '设为最大值',
				disabled: () => !isFiniteNumber(max),
				action: () => {
					if (isFiniteNumber(max)) commitNumericValue(max);
				}
			}
		);
		return items;
	}

	function openInputContextMenu(clientX: number, clientY: number) {
		const id = field?.dataset.contextMenuId;
		if (id !== undefined) openMenu(id, clientX, clientY);
	}

	function startEditing() {
		if (disabled || editing || interactionMode === 'scrubbing') return;
		closeMenu();
		editOriginalValue = value;
		draft = formatEditableValue(value);
		editing = true;
		void tick().then(() => {
			if (!editing || !editInput) return;
			editInput.focus();
			editInput.select();
		});
	}

	function cancelEditing() {
		if (!editing) return;
		const originalValue = editOriginalValue;
		if (originalValue !== undefined) setValue(originalValue);
		editing = false;
		editOriginalValue = undefined;
	}

	function submitEditing() {
		if (!editing) return;
		const originalValue = editOriginalValue ?? value;
		if (typeof originalValue === 'number') {
			const text = draft.trim();
			const parsed = text === '' ? Number.NaN : Number(text);
			if (Number.isFinite(parsed)) commitNumericValue(parsed);
			else setValue(originalValue);
		} else {
			setValue(draft);
		}
		editing = false;
		editOriginalValue = undefined;
	}

	function handleEditKeydown(event: KeyboardEvent) {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			submitEditing();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			cancelEditing();
		}
	}

	function stopInputPointerEvent(event: PointerEvent) {
		event.stopPropagation();
	}

	function setPointerCapture(event: PointerEvent) {
		try {
			field?.setPointerCapture(event.pointerId);
		} catch (error) {
			console.debug('[gpen] ignored rejection: Input setPointerCapture', error);
			return;
		}
	}

	function releasePointerCapture(session: PointerSession) {
		try {
			if (field?.hasPointerCapture(session.pointerId)) field.releasePointerCapture(session.pointerId);
		} catch (error) {
			console.debug('[gpen] ignored rejection: Input releasePointerCapture', error);
			return;
		}
	}

	function exitPointerLock() {
		try {
			if (field && document.pointerLockElement === field) document.exitPointerLock();
		} catch (error) {
			console.debug('[gpen] ignored rejection: Input exitPointerLock', error);
			return;
		}
	}

	function requestPointerLock() {
		if (!field || typeof field.requestPointerLock !== 'function') return;
		try {
			const result = field.requestPointerLock();
			void Promise.resolve(result).catch((error: unknown) => {
				console.debug('[gpen] ignored rejection: Input requestPointerLock', error);
				return;
			});
		} catch (error) {
			console.debug('[gpen] ignored rejection: Input requestPointerLock', error);
			return;
		}
	}

	function startScrubbing(session: PointerSession, lockPointer: boolean) {
		if (typeof session.startValue !== 'number') {
			session.mode = 'cancelled';
			return;
		}
		session.mode = 'scrubbing';
		session.rawValue = session.startValue;
		interactionMode = 'scrubbing';
		clearLongPressTimer();
		if (lockPointer && session.pointerType === 'mouse') requestPointerLock();
	}

	function createPointerSession(event: PointerEvent): PointerSession {
		return {
			pointerId: event.pointerId,
			pointerType: event.pointerType,
			startX: event.clientX,
			startY: event.clientY,
			lastX: event.clientX,
			lastY: event.clientY,
			startValue: value,
			rawValue: typeof value === 'number' ? value : 0,
			mode: 'pending',
			moved: false,
			pointerLocked: false
		};
	}

	function isValueArea(event: PointerEvent): boolean {
		const fieldRect = field?.getBoundingClientRect();
		const valueRect = valueElement?.getBoundingClientRect();
		if (!fieldRect || !valueRect) return true;

		if (orientation === 'vertical') {
			return event.clientY >= valueRect.top && event.clientY <= valueRect.bottom;
		}
		return event.clientX >= valueRect.left && event.clientX <= valueRect.right;
	}

	function scrubBaseStep(): number {
		const configured = configuredStep();
		if (configured !== undefined) return configured;
		const digits = configuredPrecision();
		return digits === undefined ? 1 : 10 ** -digits;
	}

	function scrubModifier(event: PointerEvent | KeyboardEvent): number {
		let modifier = 1;
		if (event.shiftKey) modifier *= 0.1;
		if (event.ctrlKey || event.metaKey) modifier *= 10;
		return modifier;
	}

	function scrubSnapStep(event: PointerEvent | KeyboardEvent): number | undefined {
		const configured = configuredStep();
		const precisionStep = configuredPrecision();
		const base = configured ?? (precisionStep === undefined ? undefined : 10 ** -precisionStep);
		return base === undefined ? undefined : base * scrubModifier(event);
	}

	function updateScrub(event: PointerEvent, session: PointerSession) {
		let axisDelta: number;
		if (session.pointerLocked) {
			axisDelta = orientation === 'vertical' ? -event.movementY : event.movementX;
		} else if (orientation === 'vertical') {
			axisDelta = session.lastY - event.clientY;
		} else {
			axisDelta = event.clientX - session.lastX;
		}

		session.lastX = event.clientX;
		session.lastY = event.clientY;
		if (!Number.isFinite(axisDelta) || axisDelta === 0) return;

		session.moved = true;
		session.rawValue += (axisDelta / SCRUB_PIXELS_PER_STEP) * scrubBaseStep() * scrubModifier(event);
		setValue(normalizeNumeric(session.rawValue, scrubSnapStep(event)));
		event.preventDefault();
	}

	function handlePointerDown(event: PointerEvent) {
		if (disabled) return;
		if (event.button === 2) {
			event.preventDefault();
			cancelPointerInteraction();
			openInputContextMenu(event.clientX, event.clientY);
			return;
		}
		if (event.button !== 0) return;
		if (activePointer && activePointer.pointerId !== event.pointerId) return;
		closeMenu();
		if (editing) return;

		const session = createPointerSession(event);
		activePointer = session;
		setPointerCapture(event);

		if (typeof value === 'number' && event.pointerType !== 'touch' && !isValueArea(event)) {
			event.preventDefault();
			startScrubbing(session, true);
			return;
		}

		if (event.pointerType === 'touch') {
			longPressTimer = window.setTimeout(() => {
				longPressTimer = undefined;
				if (activePointer?.pointerId === session.pointerId && !session.moved) {
					if (typeof session.startValue === 'number') startScrubbing(session, false);
					else session.mode = 'longpress';
				}
			}, LONG_PRESS_MS);
		}
	}

	function handlePointerMove(event: PointerEvent) {
		const session = activePointer;
		if (!session || session.pointerId !== event.pointerId) return;

		if (session.mode === 'pending') {
			const movedDistance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
			if (movedDistance > POINTER_MOVE_THRESHOLD) {
				session.moved = true;
				clearLongPressTimer();
				session.mode = 'cancelled';
			}
			return;
		}

		if (session.mode === 'scrubbing') updateScrub(event, session);
		if (session.mode === 'longpress') {
			session.moved = true;
			session.mode = 'cancelled';
		}
	}

	function finishPointerSession(event: PointerEvent, cancelled: boolean) {
		const session = activePointer;
		if (!session || session.pointerId !== event.pointerId) return;
		activePointer = undefined;
		clearLongPressTimer();

		const showLongPressMenu =
			!cancelled &&
			(session.mode === 'scrubbing' || session.mode === 'longpress') &&
			session.pointerType === 'touch' &&
			!session.moved;
		if (cancelled && session.mode === 'scrubbing') setValue(session.startValue);
		releasePointerCapture(session);
		exitPointerLock();
		interactionMode = 'idle';

		if (showLongPressMenu) {
			openInputContextMenu(event.clientX, event.clientY);
			return;
		}
		if (!cancelled && session.mode === 'pending' && !session.moved) startEditing();
		event.preventDefault();
	}

	function handlePointerUp(event: PointerEvent) {
		finishPointerSession(event, false);
	}

	function handlePointerCancel(event: PointerEvent) {
		finishPointerSession(event, true);
	}

	function cancelPointerInteraction() {
		const session = activePointer;
		if (!session) return;
		activePointer = undefined;
		clearLongPressTimer();
		if (session.mode === 'scrubbing') setValue(session.startValue);
		releasePointerCapture(session);
		exitPointerLock();
		interactionMode = 'idle';
	}

	function handleContextMenu(event: MouseEvent) {
		if (disabled) return;
		event.preventDefault();
		event.stopPropagation();
		cancelPointerInteraction();
		openInputContextMenu(event.clientX, event.clientY);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (disabled) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			if (editing) cancelEditing();
			else cancelPointerInteraction();
			closeMenu();
			return;
		}
		if (event.key === 'Enter' || event.key === 'F2') {
			event.preventDefault();
			startEditing();
			return;
		}
		if (!isNumeric) return;

		let direction = 0;
		if (event.key === 'ArrowRight' || event.key === 'ArrowUp') direction = 1;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') direction = -1;
		if (direction !== 0) {
			event.preventDefault();
			const baseStep = configuredStep() ?? 1;
			const next = Number(value) + direction * baseStep * scrubModifier(event);
			commitNumericValue(next, scrubSnapStep(event));
			return;
		}
		if (event.key === 'Home' && isFiniteNumber(min)) {
			event.preventDefault();
			commitNumericValue(min);
		}
		if (event.key === 'End' && isFiniteNumber(max)) {
			event.preventDefault();
			commitNumericValue(max);
		}
	}

	function handleWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		if (editing) cancelEditing();
		else cancelPointerInteraction();
		closeMenu();
	}

	function handleWindowBlur() {
		cancelPointerInteraction();
	}

	function handlePointerLockChange() {
		const session = activePointer;
		if (!session) {
			if (document.pointerLockElement === field) exitPointerLock();
			return;
		}
		if (session.mode !== 'scrubbing') return;
		const locked = document.pointerLockElement === field;
		if (session.pointerLocked && !locked) {
			cancelPointerInteraction();
			return;
		}
		session.pointerLocked = locked;
	}

	function handlePointerLockError() {
		if (activePointer?.mode === 'scrubbing') {
			activePointer.pointerLocked = false;
			console.debug('[gpen] pointer lock unavailable: Input fallback scrub');
		}
	}

	function handleDocumentPointerDown(event: PointerEvent) {
		if (activePointer?.mode !== 'scrubbing' || event.button !== 2) return;
		event.preventDefault();
		cancelPointerInteraction();
		openInputContextMenu(event.clientX, event.clientY);
	}

	onMount(() => {
		document.addEventListener('pointerdown', handleDocumentPointerDown, true);
		document.addEventListener('pointerlockchange', handlePointerLockChange);
		document.addEventListener('pointerlockerror', handlePointerLockError);
		return () => {
			document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
			document.removeEventListener('pointerlockchange', handlePointerLockChange);
			document.removeEventListener('pointerlockerror', handlePointerLockError);
		};
	});

	onDestroy(() => {
		clearLongPressTimer();
		closeMenu();
		if (activePointer) {
			releasePointerCapture(activePointer);
			exitPointerLock();
			activePointer = undefined;
		}
	});
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onblur={handleWindowBlur}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerCancel}
/>

<div class="input-shell" class:disabled>
	{#if label}
		<span class="input-label">{label}</span>
	{/if}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		bind:this={field}
		class="input-widget"
		class:vertical={orientation === 'vertical'}
		class:numeric={isNumeric}
		class:editing
		class:scrubbing={interactionMode === 'scrubbing'}
		use:contextMenu={inputMenuProvider}
		data-input-widget
		data-context-menu-touch-opt-out
		data-orientation={orientation}
		role={inputRole}
		tabindex={disabled ? undefined : 0}
		aria-label={label ?? '输入值'}
		aria-valuenow={numericValue}
		aria-valuemin={numericMin}
		aria-valuemax={numericMax}
		aria-valuetext={ariaValueText}
		aria-orientation={isNumeric ? orientation : undefined}
		aria-disabled={disabled}
		aria-haspopup="menu"
		aria-expanded={menuOpen}
		onpointerdown={handlePointerDown}
		oncontextmenu={handleContextMenu}
		onkeydown={handleKeydown}
	>
		<span class="input-side input-side-start" aria-hidden="true">−</span>
		<span bind:this={valueElement} class="input-value-area">
			{#if editing}
				<input
					bind:this={editInput}
					class="edit-input"
					type="text"
					inputmode={isNumeric ? 'decimal' : 'text'}
					aria-label={label ? `${label}（编辑）` : '编辑值'}
					autocomplete="off"
					spellcheck="false"
					bind:value={draft}
					onkeydown={handleEditKeydown}
					onblur={submitEditing}
					onpointerdown={stopInputPointerEvent}
				/>
			{:else}
				<span class="input-value-text">{displayValue}</span>
				{#if unit}
					<span class="input-unit">{unit}</span>
				{/if}
			{/if}
		</span>
		<span class="input-side input-side-end" aria-hidden="true">+</span>
	</div>
</div>

<style>
	.input-shell {
		display: inline-flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.35lh;
		color: var(--gpen-panel-foreground);
		font: inherit;
	}

	.input-shell.disabled {
		opacity: 0.55;
	}

	.input-label {
		font-weight: 600;
		line-height: 1.25;
	}

	.input-widget {
		box-sizing: border-box;
		display: inline-flex;
		align-items: stretch;
		justify-content: space-between;
		width: 22ch;
		min-width: 12ch;
		min-height: 3lh;
		padding: 0 0.35ch;
		border: 1px solid #94a3b8;
		border-radius: var(--gpen-radius);
		background: #f8fafc;
		color: #0f172a;
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		user-select: none;
		touch-action: none;
		cursor: text;
	}

	.input-widget.numeric .input-side {
		cursor: ew-resize;
	}

	.input-widget.vertical {
		align-items: stretch;
		flex-direction: column;
		width: 12ch;
		min-width: 12ch;
		min-height: 11lh;
		padding: 0.3lh 0;
	}

	.input-widget.vertical.numeric .input-side {
		cursor: ns-resize;
	}

	.input-widget:hover:not(.editing) {
		border-color: #475569;
		background: #eef2ff;
	}

	.input-widget.editing {
		border-color: var(--gpen-panel-accent);
		background: var(--gpen-panel-background);
		box-shadow: 0 0 0 1px rgb(79 70 229 / 0.18);
		cursor: text;
	}

	.input-widget.scrubbing {
		border-color: #2563eb;
		background: #dbeafe;
		cursor: ew-resize;
	}

	.input-widget.vertical.scrubbing {
		cursor: ns-resize;
	}

	.input-widget:focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 1px;
	}

	.input-side {
		display: grid;
		flex: 1 1 0;
		place-items: center;
		min-width: 2ch;
		color: var(--gpen-panel-muted);
		font-size: 1.1em;
		font-weight: 700;
	}

	.input-side-start {
		justify-content: flex-start;
		padding-inline-start: 0.35ch;
	}

	.input-side-end {
		justify-content: flex-end;
		padding-inline-end: 0.35ch;
	}

	.input-widget.vertical .input-side {
		width: 100%;
		min-height: 2lh;
	}

	.input-widget.vertical .input-side-start,
	.input-widget.vertical .input-side-end {
		padding-inline: 0;
	}

	.input-value-area {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		min-width: 5ch;
		min-height: 2lh;
		padding: 0 0.4ch;
		border-radius: var(--gpen-radius-sm);
		white-space: nowrap;
	}

	.input-widget.vertical .input-value-area {
		width: 100%;
		min-height: 3lh;
		padding: 0.2lh 0.4ch;
	}

	.input-value-text {
		overflow: hidden;
		max-width: 16ch;
		text-overflow: ellipsis;
	}

	.input-unit {
		margin-inline-start: 0.35ch;
		color: var(--gpen-panel-muted);
		font-size: 0.9em;
	}

	.edit-input {
		box-sizing: border-box;
		width: 100%;
		min-width: 5ch;
		padding: 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		font-variant-numeric: tabular-nums;
		text-align: center;
		user-select: text;
	}
</style>
