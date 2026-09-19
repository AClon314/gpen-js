const DEFAULT_SURFACE = 200_000;
const MIN_SURFACE = 1;
const SPACE_ATTRIBUTE = "data-gpen-canvas-space";

export type InfiniteCanvas = {
  /** The spacer node (null when there is no document to append it to). */
  readonly element: HTMLDivElement | null;
  destroy(): void;
};

type ActiveCanvas = {
  element: HTMLDivElement;
  handle: InfiniteCanvas;
};

/**
 * Document-level spacer that expands the page's natural scroll range, so the
 * user can pan the camera by scrolling. There is exactly one: `apply` is
 * idempotent and `destroy` only removes the node.
 *
 * Why a spacer and not a wrapper (measured, see handoff §2.1): a wrapper has to
 * move the host content into `surface > origin`, which changes its document
 * coordinates, fakes `scrollY` (100000) and `scrollHeight`, breaks
 * `body > main` selectors, hides the scrollbar and jumps the page on open.
 * The spacer touches none of that: content coordinates stay 0-based,
 * `scrollY = 0` still means the top of the page and the scrollbar stays.
 *
 * Limitation (accepted, paired with immersive mode): the spacer starts at the
 * document origin and scroll cannot be negative, so page pixels with `x <
 * rail width` or `y < menu height` can never scroll into the viewport hole.
 * Immersive mode hides the chrome so those pixels are visible/interactive
 * anyway.
 */
export function applyInfiniteCanvas(options: { surface?: number } = {}): InfiniteCanvas {
  if (activeCanvas) return activeCanvas.handle;

  const doc = typeof document === "undefined" ? undefined : document;
  const body = doc?.body;
  if (!doc || !body) return { element: null, destroy() {} };

  const size = validSurface(options.surface);
  const element = doc.createElement("div");
  element.setAttribute(SPACE_ATTRIBUTE, "");
  element.className = "gpen-canvas-space";
  // `position: absolute` makes it relative to the initial containing block
  // (document origin) even though it is a body child, and `pointer-events:
  // none` keeps it out of hit testing.
  element.style.cssText = `position:absolute;top:0;left:0;width:${size}px;height:${size}px;pointer-events:none`;
  body.append(element);

  const handle: InfiniteCanvas = {
    element,
    destroy() {
      if (activeCanvas?.handle !== handle) return;
      activeCanvas = undefined;
      element.remove();
    },
  };
  activeCanvas = { element, handle };
  return handle;
}

let activeCanvas: ActiveCanvas | undefined;

/** True while the page is in the large-scroll camera mode. */
export function hasInfiniteCanvas(): boolean {
  return activeCanvas !== undefined;
}

function validSurface(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= MIN_SURFACE
    ? value
    : DEFAULT_SURFACE;
}
