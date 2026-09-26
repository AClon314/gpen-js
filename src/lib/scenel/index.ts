/**
 * Scene-level rendering surfaces (`scenel/`).
 *
 * Naming decision (Step 4-3): this directory used to be `canvas/`. It does
 * **not** map 1:1 onto the gpen-protocol (Blender) layer model:
 *
 * - the protocol has no canvas / scene / viewport / surface entity
 *   (`protocol/v1/gpen/*.tsp`);
 * - its layer container is the `Gpen` data-block — `Gpen.layers`,
 *   `Gpen.groups`, `Gpen.nodes` + `child_indices`, indexed by
 *   `LayerTreeNode.item_index` / `parent_index` — not a canvas;
 * - layer kinds live on the layer payload (`Layer.mime_type` =
 *   `text/html` | `application/gpen`, `Layer.render_by` = `js` | `wgpu`),
 *   not on a rendering surface.
 *
 * What is left here is the runtime view band that *displays* those layers:
 * the infinite-canvas camera spacer (`infiniteCanvas.ts`) and the stroke
 * drawing surface (`strokeCanvas.ts`). `layers/` owns the domain model
 * (including `layers/web.ts`, the `text/html` layer detection moved out of
 * here); `scenel/` owns where that model is shown. See `ARCHITECTURE.md` §1.
 */
export * from "./infiniteCanvas.js";
export * from "./strokeCanvas.js";
