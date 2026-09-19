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

  /** Map a layer-local point to current client (layout viewport) coordinates. */
  toClientPoint(local: LayerPoint): LayerPoint;

  /** Map current client coordinates to a layer-local point (pointer sampling). */
  toLayerPoint(client: LayerPoint): LayerPoint;

  /** Put the host element back exactly as it was before the first rotation. */
  restore(): void;
}

export interface LayerPoint {
  x: number;
  y: number;
}

/**
 * Everything the coordinate mapping needs: the rotation pivot (layer-local),
 * the rotation angle, the element origin in document coordinates and the
 * current page scroll. Pure data so the math can be unit tested.
 */
export interface LayerPointMapping {
  /** Layer-local coordinate the viewport center had when the rotation was set. */
  pivot: LayerPoint;
  /** View rotation in degrees (clockwise on screen, y-down CSS convention). */
  rotation: number;
  /** Unrotated element origin in **document** coordinates (`rect.left + scrollX`). */
  origin: LayerPoint;
  /** Current page scroll (`window.scrollX/scrollY`). */
  scroll: LayerPoint;
}

type ElementLayerState = {
  rotation: number;
  pivot: LayerPoint;
  origin: LayerPoint;
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
    pivot: { x: 0, y: 0 },
    origin: { x: 0, y: 0 },
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

  // Measure the unrotated box so the pivot is real layer-local geometry.
  // Removing the inline `rotate` and reading `getBoundingClientRect` in the
  // same task means no frame is painted in between. The same measurement
  // captures the element origin in document coordinates, which the coordinate
  // mapping needs (and which must be taken *without* our rotation, since the
  // rotated rect is an AABB of the rotated content).
  style.removeProperty("rotate");
  const rect = element.getBoundingClientRect();
  const scroll = currentScroll();
  state.pivot = pivotAtViewportCenter(rect, viewportOffset(), viewportSize());
  state.origin = { x: rect.left + scroll.x, y: rect.top + scroll.y };

  if (degrees === 0) {
    clearRotation(element, state);
    state.rotation = 0;
    return true;
  }

  style.setProperty("transform-origin", `${state.pivot.x}px ${state.pivot.y}px`);
  style.setProperty("rotate", `${degrees}deg`);
  state.rotation = degrees;
  return true;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Current page scroll in layout coordinates (0 when there is no window). */
export function currentScroll(): LayerPoint {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return { x: window.scrollX, y: window.scrollY };
}

/**
 * `layerToClient`: map a layer-local point to current client coordinates.
 *
 *   client = origin - scroll + pivot + R(θ)·(local - pivot)
 *
 * `origin - scroll` is the element origin in client coordinates, so with θ = 0
 * the result is simply `origin - scroll + local`. The pivot term makes the
 * rotation match CSS `transform-origin: pivot`, which rotates *around* the
 * pivot instead of around the layer origin. (`tmp/handoff.md` wrote the formula
 * without `+ pivot`; that variant is only correct for `pivot = (0, 0)`.)
 *
 * θ is clockwise on screen (y-down CSS convention), so
 * `R(θ)·(dx, dy) = (dx·cosθ - dy·sinθ, dx·sinθ + dy·cosθ)`.
 */
export function mapLayerPoint(local: LayerPoint, mapping: LayerPointMapping): LayerPoint {
  const radians = toRadians(mapping.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = local.x - mapping.pivot.x;
  const dy = local.y - mapping.pivot.y;
  return {
    x: mapping.origin.x - mapping.scroll.x + mapping.pivot.x + dx * cos - dy * sin,
    y: mapping.origin.y - mapping.scroll.y + mapping.pivot.y + dx * sin + dy * cos,
  };
}

/** Inverse of `mapLayerPoint` (client → layer-local). */
export function unmapClientPoint(client: LayerPoint, mapping: LayerPointMapping): LayerPoint {
  const radians = toRadians(mapping.rotation);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = client.x - (mapping.origin.x - mapping.scroll.x) - mapping.pivot.x;
  const dy = client.y - (mapping.origin.y - mapping.scroll.y) - mapping.pivot.y;
  return {
    x: mapping.pivot.x + dx * cos + dy * sin,
    y: mapping.pivot.y - dx * sin + dy * cos,
  };
}

/** Project a layer onto a layer view. Element views are shared per element. */
export function createLayerView(target: LayerViewTarget): LayerView {
  if (target.kind === "canvas") {
    // Canvas layers have no DOM element, so there is nothing to measure: the
    // origin is the document origin and the pivot is (0, 0). Rotation then
    // happens around the document origin instead of the viewport center — a
    // documented gap (see docs/stroke.md); the element target is used whenever
    // a web layer could be guessed, which is the normal path.
    const mapping = { pivot: { x: 0, y: 0 }, rotation: 0, origin: { x: 0, y: 0 } };
    return {
      kind: "canvas",
      element: null,
      rotation: () => mapping.rotation,
      setRotation(degrees) {
        mapping.rotation = degrees;
        return true;
      },
      toClientPoint(local) {
        return mapLayerPoint(local, { ...mapping, scroll: currentScroll() });
      },
      toLayerPoint(client) {
        return unmapClientPoint(client, { ...mapping, scroll: currentScroll() });
      },
      restore() {
        mapping.rotation = 0;
      },
    };
  }

  const element = target.element;
  const state = readState(element);
  // Capture the unrotated origin (and pivot) right away, so the coordinate
  // mapping works at rotation 0 too. `applyElementRotation(…, 0)` measures the
  // box without applying any rotation.
  applyElementRotation(element, state, 0);
  const mapping = (): LayerPointMapping => ({
    pivot: state.pivot,
    rotation: state.rotation,
    origin: state.origin,
    scroll: currentScroll(),
  });
  return {
    kind: "element",
    element,
    rotation: () => state.rotation,
    setRotation(degrees) {
      return applyElementRotation(element, state, degrees);
    },
    toClientPoint(local) {
      return mapLayerPoint(local, mapping());
    },
    toLayerPoint(client) {
      return unmapClientPoint(client, mapping());
    },
    restore() {
      clearRotation(element, state);
      state.rotation = 0;
      state.pivot = { x: 0, y: 0 };
      state.origin = { x: 0, y: 0 };
    },
  };
}
