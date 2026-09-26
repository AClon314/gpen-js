/** 网页层候选的度量（标签、面积、文本长度）。 */
export type WebLayerMetrics = {
  tag: string;
  area: number;
  textLength: number;
};

const EXCLUDED_TAGS = new Set(["script", "style", "link", "meta", "noscript", "template"]);
/** gpen's own chrome never counts as host content (`docs/build-targets.md`, risk R2). */
const OVERLAY_SELECTOR = ".gpen-overlay, [data-version], [data-instance], [data-gpen-canvas-space]";
const FIXED_VIEWPORT_FILL_RATIO = 0.9;
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

/** Everything the hard-exclusion rules are allowed to look at. */
type HardExclusionContext = {
  element: HTMLElement;
  style: CSSStyleDeclaration;
  rect: DOMRect;
};

type HardExclusionRule = (context: HardExclusionContext) => boolean;

function matchesOverlaySelector({ element }: HardExclusionContext): boolean {
  return element.matches(OVERLAY_SELECTOR);
}

function hasExcludedTag({ element }: HardExclusionContext): boolean {
  return EXCLUDED_TAGS.has(element.tagName.toLowerCase());
}

function isHidden({ style }: HardExclusionContext): boolean {
  return style.display === "none" || style.visibility === "hidden";
}

function isAriaHidden({ element }: HardExclusionContext): boolean {
  return element.getAttribute("aria-hidden")?.toLowerCase() === "true";
}

function fillsViewport({ element, style, rect }: HardExclusionContext): boolean {
  if (style.position !== "fixed") return false;
  const viewport = getViewportSize(element);
  const fillsWidth = viewport.width > 0 && rect.width >= viewport.width * FIXED_VIEWPORT_FILL_RATIO;
  const fillsHeight =
    viewport.height > 0 && rect.height >= viewport.height * FIXED_VIEWPORT_FILL_RATIO;
  return fillsWidth || fillsHeight;
}

/**
 * The exclusion rules, in order. Table-driven so each rule is a small predicate
 * that can be tested on its own and a new host quirk is one array entry.
 */
const HARD_EXCLUSION_RULES: readonly HardExclusionRule[] = [
  matchesOverlaySelector,
  hasExcludedTag,
  isHidden,
  isAriaHidden,
  fillsViewport,
];

/**
 * True when an element can never be the main web layer: gpen's own chrome,
 * metadata tags, hidden nodes, or a fixed layer that covers the viewport.
 */
export function isHardExcluded(
  element: HTMLElement,
  style: CSSStyleDeclaration,
  rect: DOMRect,
): boolean {
  return HARD_EXCLUSION_RULES.some((rule) => rule({ element, style, rect }));
}

/**
 * True for a wrapper that must be traversed rather than proposed as a
 * candidate: `display: contents` and zero-sized layout boxes with children.
 */
export function isTransparentWrapper(
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

/** Resolve the scan root: an explicit one, else the document body. */
function resolveWebLayerRoot(root?: ParentNode): ParentNode | undefined {
  if (root) return root;
  return typeof document !== "undefined" ? document.body : undefined;
}

/** Sum every candidate's column into the "total" row used for normalization. */
function sumMetrics(metrics: readonly WebLayerMetrics[]): WebLayerMetrics {
  return {
    tag: "total",
    area: metrics.reduce((sum, value) => sum + value.area, 0),
    textLength: metrics.reduce((sum, value) => sum + value.textLength, 0),
  };
}

/** Pick the highest-scoring candidate; `null` when none has any measurable size. */
function selectBestCandidate(
  candidates: readonly HTMLElement[],
  metrics: readonly WebLayerMetrics[],
  totals: WebLayerMetrics,
): HTMLElement | null {
  let bestIndex = -1;
  let bestScore = 0;
  metrics.forEach((value, index) => {
    const score = webLayerScore(value, totals);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  });

  if (bestIndex < 0 || bestScore <= 0) return null;
  const best = metrics[bestIndex];
  if (!best || (best.area < MIN_AREA && best.textLength < MIN_TEXT_LENGTH)) return null;
  return candidates[bestIndex] ?? null;
}

/**
 * Guess the document's main web layer from the element children of `root`.
 * The default root is the document body; display-contents and zero-sized
 * wrappers are traversed so a framework root does not hide the actual layer.
 */
export function guessWebLayer(root?: ParentNode): HTMLElement | null {
  try {
    const source = resolveWebLayerRoot(root);
    if (!source) return null;

    const candidates: HTMLElement[] = [];
    collectCandidates(source, candidates);
    console.debug("[gpen] guessWebLayer candidates", candidates);
    if (candidates.length === 0) return null;

    const metrics = candidates.map((candidate) => metricsFor(candidate));
    const totals = sumMetrics(metrics);
    console.debug("[gpen] guessWebLayer metrics", metrics);

    return selectBestCandidate(candidates, metrics, totals);
  } catch (error) {
    console.debug("[gpen] ignored failure: guess web layer", error);
    return null;
  }
}
