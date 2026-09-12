export type WebLayerMetrics = {
  tag: string;
  area: number;
  textLength: number;
};

const EXCLUDED_TAGS = new Set(["script", "style", "link", "meta", "noscript", "template"]);
const MIN_AREA = 1;
const MIN_TEXT_LENGTH = 1;

/**
 * Combine the area and text shares of one candidate.
 *
 * Both columns are normalized independently. A missing column (a zero total)
 * contributes zero rather than producing NaN.
 */
export function webLayerScore(metrics: WebLayerMetrics, totals: WebLayerMetrics): number {
  const areaRatio = totals.area > 0 ? metrics.area / totals.area : 0;
  const textRatio = totals.textLength > 0 ? metrics.textLength / totals.textLength : 0;
  return Math.min(2, Math.max(0, areaRatio + textRatio));
}

function getComputedStyleFor(element: Element): CSSStyleDeclaration | undefined {
  const view = element.ownerDocument.defaultView;
  if (view) return view.getComputedStyle(element);
  if (typeof getComputedStyle === "function") return getComputedStyle(element);
  return undefined;
}

function getViewportSize(element: Element): { width: number; height: number } {
  const view = element.ownerDocument.defaultView;
  return {
    width: view?.innerWidth ?? 0,
    height: view?.innerHeight ?? 0,
  };
}

function isHardExcluded(element: HTMLElement, style: CSSStyleDeclaration, rect: DOMRect): boolean {
  if (element.matches(".gpen-overlay, [data-version], [data-instance]")) return true;
  if (EXCLUDED_TAGS.has(element.tagName.toLowerCase())) return true;
  if (style.display === "none" || style.visibility === "hidden") return true;
  if (element.getAttribute("aria-hidden")?.toLowerCase() === "true") return true;

  if (style.position === "fixed") {
    const viewport = getViewportSize(element);
    const fillsViewportWidth = viewport.width > 0 && rect.width >= viewport.width * 0.9;
    const fillsViewportHeight = viewport.height > 0 && rect.height >= viewport.height * 0.9;
    if (fillsViewportWidth || fillsViewportHeight) return true;
  }

  return false;
}

function isTransparentWrapper(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  rect: DOMRect,
): boolean {
  return (
    style.display === "contents" ||
    (rect.width === 0 && rect.height === 0 && element.children.length > 0)
  );
}

function collectCandidates(root: ParentNode, candidates: HTMLElement[]): void {
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement)) continue;

    const style = getComputedStyleFor(child);
    if (!style) continue;
    const rect = child.getBoundingClientRect();
    if (isHardExcluded(child, style, rect)) continue;

    if (isTransparentWrapper(child, style, rect)) {
      collectCandidates(child, candidates);
      continue;
    }

    candidates.push(child);
  }
}

function metricsFor(element: HTMLElement): WebLayerMetrics {
  const width = element.scrollWidth || element.offsetWidth;
  const height = element.scrollHeight || element.offsetHeight;
  const text = element.textContent?.trim().replace(/\s+/g, "") ?? "";

  return {
    tag: element.tagName.toLowerCase(),
    area: Math.max(0, width * height),
    textLength: text.length,
  };
}

/**
 * Guess the document's main web layer from the element children of `root`.
 * The default root is the document body; display-contents and zero-sized
 * wrappers are traversed so a framework root does not hide the actual layer.
 */
export function guessWebLayer(root?: ParentNode): HTMLElement | null {
  try {
    const source = root ?? (typeof document !== "undefined" ? document.body : undefined);
    if (!source) return null;

    const candidates: HTMLElement[] = [];
    collectCandidates(source, candidates);
    console.debug("[gpen] guessWebLayer", candidates);
    if (candidates.length === 0) return null;

    const metrics = candidates.map((candidate) => metricsFor(candidate));
    const totals: WebLayerMetrics = {
      tag: "total",
      area: metrics.reduce((sum, value) => sum + value.area, 0),
      textLength: metrics.reduce((sum, value) => sum + value.textLength, 0),
    };

    let bestIndex = -1;
    let bestScore = 0;
    for (const [index, value] of metrics.entries()) {
      const score = webLayerScore(value, totals);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex < 0 || bestScore <= 0) return null;
    const best = metrics[bestIndex];
    if (!best || (best.area < MIN_AREA && best.textLength < MIN_TEXT_LENGTH)) return null;
    return candidates[bestIndex] ?? null;
  } catch (error) {
    console.debug("[gpen] ignored failure: guess web layer", error);
    return null;
  }
}
