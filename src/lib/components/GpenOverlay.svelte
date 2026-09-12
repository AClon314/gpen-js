<script lang="ts">
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
		{#if !workspaceState.collapsed}
			<GpenWorkspace state={workspaceState} />
		{/if}

		{#if workspaceState.collapsed}
			<button
				class="restore-button"
				type="button"
				aria-label="恢复 gpen 工作区"
				title="恢复 gpen 工作区"
				onclick={restoreWorkspace}
			>恢复 gpen</button>
		{/if}

		<button
			class="close-button"
			type="button"
			aria-label="关闭 gpen"
			title="关闭 gpen"
			onclick={closeWorkspace}
		>
			<span aria-hidden="true">×</span>
		</button>
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
		<span aria-hidden="true">✦</span>
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
		pointer-events: none;
	}

	:where(.floating-button, .close-button, .restore-button) {
		border: 1px solid var(--gpen-panel-border, #cbd5e1);
		color: var(--gpen-panel-foreground, #1e293b);
		font: 600 1rem/1 var(--gpen-font-sans);
		cursor: pointer;
	}

	:where(.floating-button, .close-button, .restore-button):focus-visible {
		outline: 2px solid var(--gpen-panel-accent, #4f46e5);
		outline-offset: 3px;
	}

	.floating-button {
		position: fixed;
		z-index: 2147483000;
		display: grid;
		place-items: center;
		/* 圆形/方形控件用同一个单位（lh）才不会因 ch/lh 比例不同而变形：
		 * font-size: 1.35rem 且 line-height: 1 → 2.4lh ≈ 52px，
		 * 与脚本中的 BALL_SIZE = 3.25rem 对应。 */
		width: 2.4lh;
		height: 2.4lh;
		padding: 0;
		border-color: transparent;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--gpen-panel-accent), #7c3aed);
		box-shadow: 0 8px 20px rgb(79 70 229 / 0.3);
		color: #fff;
		font-size: 1.35rem;
		touch-action: none; /* let the draggable action handle pointer drags */
		user-select: none;
	}

	.floating-button:hover {
		filter: brightness(1.08);
	}

	.close-button,
	.restore-button {
		position: absolute;
		z-index: 30;
		pointer-events: auto;
	}

	.close-button {
		top: 0.5lh;
		right: 1ch;
		display: grid;
		place-items: center;
		width: 1.25lh;
		height: 1.25lh;
		padding: 0;
		border-radius: 0.4rem;
		background: rgb(255 255 255 / 0.94);
		box-shadow: 0 2px 8px rgb(15 23 42 / 0.16);
		font-size: 1.5rem;
	}

	.close-button:hover {
		background: var(--gpen-panel-background);
		color: var(--gpen-panel-accent);
	}

	.restore-button {
		top: 1lh;
		right: 8.5ch;
		min-height: 2.75lh;
		padding: 0 1.75ch;
		border: 1px solid var(--gpen-panel-border, #cbd5e1);
		border-radius: 0.4rem;
		background: rgb(255 255 255 / 0.94);
		box-shadow: 0 2px 8px rgb(15 23 42 / 0.16);
		color: var(--gpen-panel-foreground, #1e293b);
		font-size: 0.75rem;
	}

	.restore-button:hover {
		background: var(--gpen-panel-background);
		color: var(--gpen-panel-accent);
	}

	@media (prefers-reduced-motion: no-preference) {
		.floating-button,
		.close-button {
			transition:
				box-shadow 120ms ease,
				filter 120ms ease,
				background-color 120ms ease,
				color 120ms ease;
		}
	}
</style>
