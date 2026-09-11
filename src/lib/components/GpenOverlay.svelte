<script lang="ts">
	import GpenWorkspace from './GpenWorkspace.svelte';
	import Moveable from 'moveable';

	let open = $state(false);
	let ballEl = $state<HTMLButtonElement | undefined>(undefined);
	let moveable: Moveable | undefined;

	const BALL_SIZE = 3.25; // rem, matches .floating-button
	const EDGE_MARGIN = 0.75; // rem gap from the viewport edges
	const SNAP_DISTANCE = 12; // px snap threshold applied via Moveable guidelines

	function toggle() {
		open = !open;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (open && event.key === 'Escape') {
			toggle();
		}
	}

	// Moveable moves the floating ball (move-only, resize/rotate handles off)
	// and snaps it to the viewport edges. It is active only while the ball is
	// shown; the workspace uses the same Moveable-free modes.
	$effect(() => {
		if (open) {
			moveable?.destroy();
			moveable = undefined;
			return;
		}
		const el = ballEl;
		if (!el) return;

		const viewport = el.ownerDocument.defaultView;
		const rootEl = el.ownerDocument.documentElement;
		const bounds = {
			left: EDGE_MARGIN * 16,
			top: EDGE_MARGIN * 16,
			right: (viewport?.innerWidth ?? rootEl.clientWidth) - BALL_SIZE * 16 - EDGE_MARGIN * 16,
			bottom:
				(viewport?.innerHeight ?? rootEl.clientHeight) - BALL_SIZE * 16 - EDGE_MARGIN * 16
		};

		moveable = new Moveable(el.ownerDocument.body, {
			target: el,
			// Move only. All resize/rotate/scale/pinch handles are disabled so
			// the ball stays an opaque round button while still being draggable.
			draggable: true,
			throttleDrag: 0,
			edge: true,
			snappable: true,
			snapDirections: { left: true, right: true, top: true, bottom: true },
			elementGuidelines: [rootEl],
			resizable: false,
			rotatable: false,
			scalable: false,
			warpable: false,
			pinchable: false,
			origin: false,
			groupable: false,
			clippable: false,
			zoom: 1,
			bounds
		});

		moveable.on('drag', ({ target, left, top }) => {
			const node = target as HTMLElement;
			if (typeof left === 'number' && typeof top === 'number') {
				node.style.left = `${Math.round(left)}px`;
				node.style.top = `${Math.round(top)}px`;
				node.style.right = 'auto';
				node.style.bottom = 'auto';
			}
		});

		return () => {
			moveable?.destroy();
			moveable = undefined;
		};
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<div class="overlay" role="dialog" aria-label="gpen 工作区">
		<GpenWorkspace />

		<button
			class="close-button"
			type="button"
			aria-label="关闭 gpen"
			title="关闭 gpen"
			onclick={toggle}
		>
			<span aria-hidden="true">×</span>
		</button>
	</div>
{:else}
	<button
		bind:this={ballEl}
		class="floating-button"
		style="left: calc(100% - {BALL_SIZE + 1}rem); top: calc(100% - {BALL_SIZE + 1.75}rem); right: auto; bottom: auto;"
		type="button"
		aria-label="打开 gpen"
		title="打开 gpen（可拖动，吸附边缘）"
		onclick={toggle}
	>
		<span aria-hidden="true">✦</span>
	</button>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 10;
		isolation: isolate;
	}

	:where(.floating-button, .close-button) {
		border: 1px solid var(--gpen-panel-border, #cbd5e1);
		color: var(--gpen-panel-foreground, #1e293b);
		font: 600 1rem/1 system-ui, sans-serif;
		cursor: pointer;
	}

	:where(.floating-button, .close-button):focus-visible {
		outline: 2px solid var(--gpen-panel-accent, #4f46e5);
		outline-offset: 3px;
	}

	.floating-button {
		position: fixed;
		z-index: 10;
		display: grid;
		place-items: center;
		width: 3.25rem;
		height: 3.25rem;
		padding: 0;
		border-color: transparent;
		border-radius: 50%;
		background: linear-gradient(135deg, #4f46e5, #7c3aed);
		box-shadow: 0 8px 20px rgb(79 70 229 / 0.3);
		color: #fff;
		font-size: 1.35rem;
		touch-action: none; /* let Moveable handle pointer drags */
		user-select: none;
	}

	.floating-button:hover {
		filter: brightness(1.08);
	}

	.close-button {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		z-index: 30;
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		border-radius: 0.4rem;
		background: rgb(255 255 255 / 0.94);
		box-shadow: 0 2px 8px rgb(15 23 42 / 0.16);
		font-size: 1.5rem;
	}

	.close-button:hover {
		background: #fff;
		color: #4f46e5;
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
