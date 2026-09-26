/**
 * Read-only stroke queries: resolve the active drawable layer and collect the
 * strokes a renderer or the eraser should look at.
 *
 * These functions are pure and never allocate a new document. Frames are
 * visited in ascending `frameNumber`; a drawing referenced by more than one
 * frame is only emitted once (Blender lets several frames share one drawing,
 * and rendering it twice would double the ink).
 */
import { GpenT, LayerT, LayerTreeNodeKind } from "gpen-protocol/flatbuffers";
import type { StrokeT } from "gpen-protocol/flatbuffers";

import { isDrawableLayer } from "../protocol/defaults";

const LAYER_NODE_KIND = LayerTreeNodeKind.LAYER_TREE_NODE_KIND_LAYER_UNSPECIFIED;

/**
 * Return the active layer if it is a drawable layer, otherwise `undefined`.
 * Used by renderers to decide whether the canvas has a real target.
 */
export function activeDrawableLayer(document: GpenT): LayerT | undefined {
  const node = document.nodes[document.activeNodeIndex];
  if (!node || node.type !== LAYER_NODE_KIND) return undefined;
  const layer = document.layers[node.itemIndex];
  return layer && isDrawableLayer(layer) ? layer : undefined;
}

/**
 * Strokes of one layer in draw order.
 *
 * Frames are visited in ascending `frameNumber`; a drawing referenced by more
 * than one frame is only emitted once.
 */
export function strokesOfLayer(document: GpenT, layer: LayerT): StrokeT[] {
  const frames = [...layer.frames].sort((a, b) => a.frameNumber - b.frameNumber);
  const seen = new Set<number>();
  const strokes: StrokeT[] = [];
  for (const frame of frames) {
    const drawingIndex = frame.drawingIndex;
    if (seen.has(drawingIndex)) continue;
    seen.add(drawingIndex);
    const drawing = document.drawings[drawingIndex]?.drawing;
    if (drawing) strokes.push(...drawing.strokes);
  }
  return strokes;
}

/** All strokes of every drawable layer, in `document.layers` order. */
export function strokesOfDocument(document: GpenT): StrokeT[] {
  const strokes: StrokeT[] = [];
  for (const layer of document.layers) {
    if (isDrawableLayer(layer)) strokes.push(...strokesOfLayer(document, layer));
  }
  return strokes;
}
