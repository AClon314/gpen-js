const DEFAULT_SURFACE = 200_000;

export type FakeInfiniteCanvas = {
  destroy(): void;
};

type AppliedCanvas = {
  element: HTMLElement;
  originalParent: Node;
  originalNextSibling: ChildNode | null;
  surface: HTMLDivElement;
  origin: HTMLDivElement;
  window: Window;
  scrollX: number;
  scrollY: number;
  history: History;
  scrollRestoration: string | undefined;
  html: HTMLElement;
  originalScrollbarWidth: string;
  originalScrollbarPriority: string;
  scrollbarWidthChanged: boolean;
  scrollbarStyle: HTMLStyleElement | undefined;
  destroyed: boolean;
};

const activeCanvases = new WeakMap<HTMLElement, FakeInfiniteCanvas>();

function noopCanvas(): FakeInfiniteCanvas {
  return { destroy() {} };
}

function attempt(label: string, action: () => void): boolean {
  try {
    action();
    return true;
  } catch (error) {
    console.debug(`[gpen] ignored failure: ${label}`, error);
    return false;
  }
}

function validNumber(value: number | undefined, fallback: number, minimum: number): number {
  return value !== undefined && Number.isFinite(value) && value >= minimum ? value : fallback;
}

function restoreAppliedCanvas(state: AppliedCanvas): void {
  if (state.destroyed) return;
  state.destroyed = true;
  activeCanvases.delete(state.element);

  let elementRestored = state.element.parentNode === state.originalParent;
  if (!elementRestored) {
    elementRestored = attempt("restore web layer position", () => {
      const reference =
        state.originalNextSibling?.parentNode === state.originalParent
          ? state.originalNextSibling
          : null;
      state.originalParent.insertBefore(state.element, reference);
    });
  } else {
    attempt("restore web layer order", () => {
      const reference =
        state.originalNextSibling?.parentNode === state.originalParent
          ? state.originalNextSibling
          : null;
      if (state.element.nextSibling !== reference) {
        state.originalParent.insertBefore(state.element, reference);
      }
    });
  }

  // Do not remove a wrapper that still owns the host: a changed parent or a
  // hostile DOM mutation should not accidentally detach the host from the page.
  if (state.element.parentNode !== state.origin || elementRestored) {
    attempt("remove infinite canvas surface", () => state.surface.remove());
  }

  if (state.scrollbarStyle) {
    attempt("remove infinite canvas scrollbar style", () => state.scrollbarStyle?.remove());
  }

  if (state.scrollbarWidthChanged) {
    attempt("restore html scrollbar width", () => {
      if (state.originalScrollbarWidth) {
        state.html.style.setProperty(
          "scrollbar-width",
          state.originalScrollbarWidth,
          state.originalScrollbarPriority,
        );
      } else {
        state.html.style.removeProperty("scrollbar-width");
      }
    });
  }

  if (state.scrollRestoration !== undefined) {
    attempt("restore history scroll restoration", () => {
      state.history.scrollRestoration = state.scrollRestoration as ScrollRestoration;
    });
  }

  attempt("restore document scroll position", () => {
    state.window.scrollTo(state.scrollX, state.scrollY);
  });
}

/**
 * Put a web layer in a large document-sized surface and move the camera to its
 * center. The returned handle is idempotent and restores the DOM and browser
 * state captured before the move.
 */
export function applyFakeInfiniteCanvas(
  element: HTMLElement,
  options?: { surface?: number; origin?: number; hideScrollbar?: boolean },
): FakeInfiniteCanvas {
  const existing = activeCanvases.get(element);
  if (existing) return existing;

  const ownerDocument = element.ownerDocument;
  const view = ownerDocument.defaultView;
  const originalParent = element.parentNode;
  const html = ownerDocument.documentElement;
  if (!view || !originalParent || !html) return noopCanvas();

  const surfaceSize = validNumber(options?.surface, DEFAULT_SURFACE, Number.MIN_VALUE);
  const origin = validNumber(options?.origin, surfaceSize / 2, 0);
  const hideScrollbar = options?.hideScrollbar !== false;
  const state: AppliedCanvas = {
    element,
    originalParent,
    originalNextSibling: element.nextSibling,
    surface: ownerDocument.createElement("div"),
    origin: ownerDocument.createElement("div"),
    window: view,
    scrollX: view.scrollX,
    scrollY: view.scrollY,
    history: view.history,
    scrollRestoration: undefined,
    html,
    originalScrollbarWidth: html.style.getPropertyValue("scrollbar-width"),
    originalScrollbarPriority: html.style.getPropertyPriority("scrollbar-width"),
    scrollbarWidthChanged: false,
    scrollbarStyle: undefined,
    destroyed: false,
  };

  try {
    state.surface.className = "gpen-infinite-surface";
    state.surface.style.position = "relative";
    state.surface.style.width = `${surfaceSize}px`;
    state.surface.style.height = `${surfaceSize}px`;

    state.origin.className = "gpen-infinite-origin";
    state.origin.style.position = "absolute";
    state.origin.style.left = `${origin}px`;
    state.origin.style.top = `${origin}px`;
    state.origin.style.width = "100vw";
    state.origin.style.height = "100vh";

    state.surface.append(state.origin);
    originalParent.insertBefore(state.surface, element);
    state.origin.append(element);

    if (hideScrollbar) {
      state.scrollbarStyle = ownerDocument.createElement("style");
      state.scrollbarStyle.setAttribute("data-gpen-infinite-scrollbar", "");
      state.scrollbarStyle.textContent = "html::-webkit-scrollbar { display: none; }";
      (ownerDocument.head ?? ownerDocument.documentElement).append(state.scrollbarStyle);

      html.style.setProperty("scrollbar-width", "none");
      state.scrollbarWidthChanged = true;
    }

    if ("scrollRestoration" in state.history) {
      state.scrollRestoration = state.history.scrollRestoration;
      state.history.scrollRestoration = "manual";
    }

    view.scrollTo(origin, origin);

    const handle: FakeInfiniteCanvas = {
      destroy() {
        restoreAppliedCanvas(state);
      },
    };
    activeCanvases.set(element, handle);
    return handle;
  } catch (error) {
    console.debug("[gpen] ignored failure: apply fake infinite canvas", error);
    restoreAppliedCanvas(state);
    return noopCanvas();
  }
}
