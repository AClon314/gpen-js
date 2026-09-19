/**
 * Layer view projection: map a protocol layer onto the host DOM (a web layer
 * element today, a gpen canvas tomorrow) and apply *view-only* transforms.
 *
 * The true value of a transform belongs in the layer model (`LayerT.transform`
 * / `parent_inverse`) and the DOM is only a projection — the same contract as
 * `applyFakeInfiniteCanvas`'s "remember originals, restore on destroy".
 *
 * Rotation recipe (handoff §2.2, measured): use the independent `rotate`
 * property, never `transform`. `rotate` does not touch the page's own
 * `transform` (`getComputedStyle(el).transform` stays unchanged), keeps hit
 * testing and native selection working, and leaves our overlay/chrome alone.
 *
 * The pivot cannot be omitted: the default pivot is the layer center, and a
 * web layer as tall as the page (e.g. `main`, 12624px) rotated 20° around its
 * center throws the segment the user is looking at out of the viewport. The
 * pivot is therefore "the layer-local coordinate that was at the viewport
 * center when the rotation was applied". Dynamic pivots (changing origin
 * mid-rotation) are out of scope here: moving `transform-origin` jumps the
 * already-rotated content, and doing it without a jump needs matrix
 * composition (see `docs/layer-view.md`).
 */
import { viewportOffset, viewportSize } from "../visualViewport.js";

export type LayerViewTarget = { kind: "element"; element: HTMLElement } | { kind: "canvas" };

export interface LayerView {
  readonly kind: LayerViewTarget["kind"];

  /** The host element for element layers, null for canvas layers. */
  readonly element: HTMLElement | null;

  /** Current view rotation in degrees. */
  rotation(): number;

  /**
   * Apply a view rotation around the current viewport center. Returns false
   * when the layer refuses the transform (it has its own `transform`).
   */
  setRotation(degrees: number): boolean;

  /** Put the host element back exactly as it was before the first rotation. */
  restore(): void;
}

type ElementLayerState = {
  rotation: number;
  originalTransformOrigin: string;
  originalTransformOriginPriority: string;
  originalRotate: string;
  originalRotatePriority: string;
};

// One record per host element, so repeated open/close cycles do not stack
// "original" snapshots and the restore target stays the pre-gpen value.
const elementStates = new WeakMap<HTMLElement, ElementLayerState>();

function readState(element: HTMLElement): ElementLayerState {
  const existing = elementStates.get(element);
  if (existing) return existing;
  const style = element.style;
  const state: ElementLayerState = {
    rotation: 0,
    originalTransformOrigin: style.getPropertyValue("transform-origin"),
    originalTransformOriginPriority: style.getPropertyPriority("transform-origin"),
    originalRotate: style.getPropertyValue("rotate"),
    originalRotatePriority: style.getPropertyPriority("rotate"),
  };
  elementStates.set(element, state);
  return state;
}

function clearRotation(element: HTMLElement, state: ElementLayerState): void {
  const style = element.style;
  style.removeProperty("rotate");
  if (state.originalRotate) {
    style.setProperty("rotate", state.originalRotate, state.originalRotatePriority);
  }
  style.removeProperty("transform-origin");
  if (state.originalTransformOrigin) {
    style.setProperty(
      "transform-origin",
      state.originalTransformOrigin,
      state.originalTransformOriginPriority,
    );
  }
}

/**
 * Layer-local coordinate that currently sits at the center of the visible
 * viewport. `rect` is the element's client-coordinate border box (measured
 * without our rotation), `offset`/`size` describe the visual viewport in the
 * same coordinates.
 */
export function pivotAtViewportCenter(
  rect: { left: number; top: number },
  offset: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: round(offset.x + size.width / 2 - rect.left),
    y: round(offset.y + size.height / 2 - rect.top),
  };
}

function applyElementRotation(
  element: HTMLElement,
  state: ElementLayerState,
  degrees: number,
): boolean {
  const view = element.ownerDocument.defaultView;
  const style = element.style;

  // Side effect ⑥ (handoff §2.2): changing `transform-origin` is only safe when
  // the page does not use `transform` itself. Refuse rather than fight it.
  const computed = view?.getComputedStyle(element);
  if (computed && computed.transform !== "none") {
    console.debug("[gpen] ignored rejection: layer view rotation (layer has its own transform)");
    return false;
  }

  if (degrees === 0) {
    clearRotation(element, state);
    state.rotation = 0;
    return true;
  }

  // Measure the unrotated box so the pivot is real layer-local geometry.
  // Removing the inline `rotate` and reading `getBoundingClientRect` in the
  // same task means no frame is painted in between.
  style.removeProperty("rotate");
  const rect = element.getBoundingClientRect();
  const pivot = pivotAtViewportCenter(rect, viewportOffset(), viewportSize());

  style.setProperty("transform-origin", `${pivot.x}px ${pivot.y}px`);
  style.setProperty("rotate", `${degrees}deg`);
  state.rotation = degrees;
  return true;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Project a layer onto a layer view. Element views are shared per element. */
export function createLayerView(target: LayerViewTarget): LayerView {
  if (target.kind === "canvas") {
    let rotation = 0;
    return {
      kind: "canvas",
      element: null,
      rotation: () => rotation,
      setRotation(degrees) {
        rotation = degrees;
        return true;
      },
      restore() {
        rotation = 0;
      },
    };
  }

  const element = target.element;
  const state = readState(element);
  return {
    kind: "element",
    element,
    rotation: () => state.rotation,
    setRotation(degrees) {
      return applyElementRotation(element, state, degrees);
    },
    restore() {
      clearRotation(element, state);
      state.rotation = 0;
    },
  };
}
