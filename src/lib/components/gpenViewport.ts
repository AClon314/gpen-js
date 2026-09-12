let baselineDpr: number | undefined;
let baselineVisualScale: number | undefined;

function currentDpr(): number {
  return window.devicePixelRatio || 1;
}

function currentVisualScale(): number {
  return window.visualViewport?.scale ?? 1;
}

function normalize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  // Ignore tiny viewport rounding noise around the unzoomed baseline.
  return Math.abs(value - 1) < 0.02 ? 1 : value;
}

/** Capture the page-load baseline, not the time the workspace is opened. */
export function initializeGpenViewportZoomBaseline(): void {
  if (baselineDpr !== undefined && baselineVisualScale !== undefined) return;
  baselineDpr = currentDpr();
  baselineVisualScale = currentVisualScale();
}

/**
 * Return the external scale that should be counteracted by CSS zoom.
 *
 * A dpr ratio follows desktop/browser zoom; visualViewport.scale follows
 * mobile pinch zoom. Keeping both ratios means a browser zoom and a pinch can
 * be active together, while the page-load DPR remains the physical-display
 * baseline instead of incorrectly treating a HiDPI screen as browser zoom.
 */
export function readGpenViewportZoomFactor(): number {
  initializeGpenViewportZoomBaseline();
  return normalize(
    (currentDpr() / (baselineDpr ?? 1)) * (currentVisualScale() / (baselineVisualScale ?? 1)),
  );
}
