/**
 * Stroke write path: turn sampled pointer input (in layer-local coordinates)
 * into protocol data and append / erase it on the active drawable layer.
 *
 * This is the minimal write path (T4) — no fill, no pressure curve, no
 * multi-frame timeline, no brush presets. It is pure data: every function
 * returns a new document and never mutates its input, so it composes with the
 * undo snapshot stack in `components/GpenWorkspace.svelte` and can be unit
 * tested without a DOM.
 *
 * Where a stroke lives (protocol `gpen.tsp` / `drawing.tsp` / `layer.tsp`):
 *
 *   Gpen.drawings: DrawingSlot[]     <- the stroke payload lives here
 *   Layer.frames:  Frame[]           <- frame.drawingIndex indexes `drawings`
 *   Drawing.strokes: Stroke[]        <- the actual stroke
 *
 * The implementation is split by stage — input builders (`strokeCreate`),
 * read-only queries (`strokeQuery`), geometry (`strokeGeometry`) and edits
 * (`strokeEdit`) — and this module keeps the public surface stable for the
 * barrel `layers/index.ts`.
 */
export * from "./strokeCreate.js";
export * from "./strokeQuery.js";
export * from "./strokeEdit.js";
export {
  /** Shortest distance from `point` to a stroke's polyline, in layer-local units. */
  distanceToStroke,
  /** Strokes whose polyline passes within `radius` of `point` (tangency hits). */
  strokesHitByCircle,
} from "./strokeGeometry.js";
