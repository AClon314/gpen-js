<script lang="ts">
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-brush.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-close.js';
	import '@spectrum-web-components/icons-workflow/icons/sp-icon-maximize.js';
	import { onDestroy, onMount } from 'svelte';
	import { applyFakeInfiniteCanvas, guessWebLayer } from '#lib/canvas/index';
	import { draggable, type DragPosition } from '#lib/gestures/index';
	import { createInstanceId } from '#lib/instanceId';
	import GpenWorkspace from './GpenWorkspace.svelte';
	import {
		createDefaultGpenWorkspaceState,
		createLocalStorageGpenWorkspaceStateStorage,
		normalizeGpenWorkspaceState,
		serializeGpenWorkspaceState
	} from './gpenWorkspaceState';
	import { initializeGpenViewportZoomBaseline } from './gpenViewport';

	let workspaceState = $state(createDefaultGpenWorkspaceState());
	let overlayEl = $state<HTMLDivElement | undefined>(undefined);
	let storageReady = $state(false);
	let infiniteCanvas: ReturnType<typeof applyFakeInfiniteCanvas> | undefined;

	const workspaceStorage = createLocalStorageGpenWorkspaceStateStorage();
	const BALL_SIZE = 3.25; // rem, matches .floating-button
	const EDGE_MARGIN = 0.75; // rem gap from the viewport edges
	const BALL_DRAG_THRESHOLD = 8; // CSS px, filters touch/mouse jitter from drags
	const instanceId = createInstanceId();

	function openWorkspace() {
		workspaceState.open = true;
		workspaceState.collapsed = false;
	}

	/**
	 * 最小化 = 把指针/触摸/键盘交还给网页：工作区整体隐藏（连带退出命中测试），
	 * 只留两个图标按钮。`blur` 是为了不把软键盘/焦点留在工具栏按钮上。
	 */
	function minimizeWorkspace() {
		workspaceState.collapsed = true;
		const active = document.activeElement;
		if (active instanceof HTMLElement) active.blur();
	}

	function persistBallPosition(position: DragPosition) {
		workspaceState.ballPosition = { x: Math.round(position.x), y: Math.round(position.y) };
	}

	function closeWorkspace() {
		workspaceState.open = false;
		workspaceState.collapsed = false;
	}

	function restoreWorkspace() {
		workspaceState.collapsed = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (workspaceState.open && event.key === 'Escape') closeWorkspace();
	}

	// Persist one serializable state object. The adapter currently bridges to
	// localStorage (including the legacy uiScale key); a KV adapter can be
	// injected later without changing this component's state flow.
	$effect(() => {
		const snapshot = serializeGpenWorkspaceState(workspaceState);
		if (!storageReady) return;
		void workspaceStorage.save(snapshot).catch((error: unknown) => {
			console.debug('[gpen] ignored rejection: GpenOverlay state persist', error);
			return;
		});
	});

	onMount(() => {
		initializeGpenViewportZoomBaseline();
		let active = true;
		const loadState = async () => {
			try {
				const stored = await workspaceStorage.load();
				if (active && stored) {
					Object.assign(workspaceState, normalizeGpenWorkspaceState(stored, workspaceState));
				}
			} catch (error) {
				console.debug('[gpen] ignored rejection: GpenOverlay state load', error);
				return;
			} finally {
				if (active) storageReady = true;
			}
		};

		void loadState();
		return () => {
			active = false;
		};
	});

	// Keep the host page in a large document coordinate space while the gpen
	// workspace is open. The effect cleanup also runs when this component is
	// unmounted, so a route change cannot leave the host transformed.
	$effect(() => {
		if (!workspaceState.open) return;

		const layer = guessWebLayer();
		const applied = layer ? applyFakeInfiniteCanvas(layer) : undefined;
		infiniteCanvas = applied;
		return () => {
			applied?.destroy();
			if (infiniteCanvas === applied) infiniteCanvas = undefined;
		};
	});

	onDestroy(() => {
		infiniteCanvas?.destroy();
		infiniteCanvas = undefined;
	});

	// A fixed element can stop tracking the visual viewport after pinch zoom.
	// Keep the overlay itself absolute and move it in page coordinates instead:
	// pageTop/pageLeft include document scroll and visualViewport panning, while
	// width/height follow the currently visible area (including soft keyboards).
	function positionOverlay() {
		const el = overlayEl;
		if (!el) return;
		const vv = window.visualViewport;
		const top = vv?.pageTop ?? window.pageYOffset;
		const left = vv?.pageLeft ?? window.pageXOffset;
		const width = vv?.width ?? window.innerWidth;
		const height = vv?.height ?? window.innerHeight;

		el.style.top = `${Math.max(0, top)}px`;
		el.style.left = `${Math.max(0, left)}px`;
		el.style.width = `${Math.max(0, width)}px`;
		el.style.height = `${Math.max(0, height)}px`;
	}

	$effect(() => {
		if (!workspaceState.open) return;
		const el = overlayEl;
		if (!el) return;

		const vv = window.visualViewport;
		const onViewportMove = () => positionOverlay();
		positionOverlay();
		window.addEventListener('scroll', onViewportMove, { passive: true });
		window.addEventListener('resize', onViewportMove, { passive: true });
		vv?.addEventListener('scroll', onViewportMove, { passive: true });
		vv?.addEventListener('resize', onViewportMove, { passive: true });

		return () => {
			window.removeEventListener('scroll', onViewportMove);
			window.removeEventListener('resize', onViewportMove);
			vv?.removeEventListener('scroll', onViewportMove);
			vv?.removeEventListener('resize', onViewportMove);
		};
	});

</script>

<svelte:window onkeydown={handleKeydown} />

{#if workspaceState.open}
	<div
		bind:this={overlayEl}
		class="overlay gpen-overlay"
		data-version={__GPEN_VERSION__}
		data-instance={instanceId}
		class:workspace-collapsed={workspaceState.collapsed}
		role="dialog"
		aria-label="gpen 工作区"
	>
		<!-- 工作区始终挂载，最小化时只是 `visibility: hidden`：dockview 实例和面板
		     尺寸都留着，还原不需要从存储里重建布局。 -->
		<GpenWorkspace
			state={workspaceState}
			minimized={workspaceState.collapsed}
			onClose={closeWorkspace}
			onMinimize={minimizeWorkspace}
		/>

		{#if workspaceState.collapsed}
			<!-- 最小化后只留两个图标按钮：还原 / 关闭。 -->
			<div class="minimized-bar">
				<button
					class="restore-button"
					type="button"
					aria-label="还原 gpen 工作区"
					title="还原工作区"
					onclick={restoreWorkspace}
				>
					<sp-icon-maximize></sp-icon-maximize>
				</button>
				<button
					class="close-button"
					type="button"
					aria-label="关闭 gpen"
					title="关闭 gpen"
					onclick={closeWorkspace}
				>
					<sp-icon-close></sp-icon-close>
				</button>
			</div>
		{/if}
	</div>
{:else}
	<button
		use:draggable={{
			position: workspaceState.ballPosition,
			onTap: openWorkspace,
			threshold: BALL_DRAG_THRESHOLD,
			margin: EDGE_MARGIN * 16,
			onPositionChange: persistBallPosition
		}}
		class="floating-button gpen-overlay"
		data-version={__GPEN_VERSION__}
		data-instance={instanceId}
		style="left: calc(100% - {BALL_SIZE + 1}rem); top: calc(100% - {BALL_SIZE + 1.75}rem); right: auto; bottom: auto;"
		type="button"
		aria-label="打开 gpen"
		title="打开 gpen（可拖动，吸附边缘）"
	>
		<sp-icon-brush aria-hidden="true"></sp-icon-brush>
	</button>
{/if}

<style>
	.overlay {
		/* Fixed is unreliable after mobile pinch zoom. GpenOverlay positions this
		 * absolute box from visualViewport.pageTop/pageLeft instead. */
		position: absolute;
		z-index: 2147483000;
		isolation: isolate;
		overflow: hidden;
		/* 工作区铺满整个 overlay（不留外边距）。尺寸基准在这里显式声明一次，
		 * 内层才能放心用 lh / ch。 */
		font-family: var(--gpen-font-sans);
		font-size: var(--gpen-font-size);
		line-height: var(--gpen-line-height);
		pointer-events: none;
	}

	:where(.floating-button, .close-button, .restore-button) {
		border: 1px solid var(--gpen-panel-border);
		color: var(--gpen-panel-foreground);
		font: 600 1rem/var(--gpen-line-height) var(--gpen-font-sans);
		cursor: pointer;
	}

	:where(.floating-button, .close-button, .restore-button):focus-visible {
		outline: 2px solid var(--gpen-panel-accent);
		outline-offset: 3px;
	}

	.floating-button {
		position: fixed;
		z-index: 2147483000;
		display: grid;
		place-items: center;
		/* 圆形/方形控件用同一个单位（lh）才不会因 ch/lh 比例不同而变形：
		 * font-size: 1.35rem 且 line-height = --gpen-line-height → 2.4lh ≈ 52px，
		 * 与脚本中的 BALL_SIZE = 3.25rem 对应。 */
		width: 2.4lh;
		height: 2.4lh;
		padding: 0;
		border-color: transparent;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--gpen-panel-accent), #7c3aed);
		box-shadow:
			0 8px 20px color-mix(in srgb, var(--gpen-panel-accent) 32%, transparent),
			0 0 0 3px color-mix(in srgb, var(--gpen-panel-accent) 18%, transparent);
		color: #fff;
		font-size: 1.35rem;
		touch-action: none; /* let the draggable action handle pointer drags */
		user-select: none;
	}

	.floating-button:hover {
		filter: brightness(1.08);
	}

	.floating-button :global(sp-icon-brush) {
		--mod-icon-size: 1.4rem;
		color: #fff;
	}

	/* 最小化后只剩这两个图标按钮，浮在网页右上角（展开态的同类按钮在标题栏里）。 */
	.minimized-bar {
		position: absolute;
		top: 0.5lh;
		right: 1.5ch;
		z-index: 30;
		display: flex;
		align-items: center;
		gap: 0.75ch;
		pointer-events: auto;
	}

	:where(.restore-button, .close-button) {
		display: grid;
		place-items: center;
		width: 2.4lh;
		height: 2.4lh;
		padding: 0;
		border-radius: 50%;
		background: var(--gpen-panel-background);
		box-shadow: var(--gpen-panel-shadow);
	}

	.restore-button:hover {
		border-color: var(--gpen-panel-accent);
		color: var(--gpen-panel-accent);
	}

	.close-button:hover {
		border-color: var(--gpen-danger);
		background: color-mix(in srgb, var(--gpen-danger) 14%, var(--gpen-panel-background));
		color: var(--gpen-danger);
	}

	.restore-button :global(sp-icon-maximize),
	.close-button :global(sp-icon-close) {
		--mod-icon-size: 1.2rem;
		color: inherit;
	}

	@media (prefers-reduced-motion: no-preference) {
		.floating-button,
		.close-button,
		.restore-button {
			transition:
				box-shadow 120ms ease,
				filter 120ms ease,
				background-color 120ms ease,
				border-color 120ms ease,
				color 120ms ease;
		}
	}
</style>
