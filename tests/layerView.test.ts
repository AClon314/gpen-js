import { describe, expect, test } from "bun:test";

import { createLayerView, pivotAtViewportCenter } from "../src/lib/layers/layerView";

describe("layer view pivot", () => {
  test("maps the viewport center into layer-local coordinates", () => {
    expect(
      pivotAtViewportCenter({ left: 0, top: 100 }, { x: 0, y: 0 }, { width: 800, height: 600 }),
    ).toEqual({ x: 400, y: 200 });
  });

  test("accounts for a panned (pinched) visual viewport", () => {
    expect(
      pivotAtViewportCenter({ left: 60, top: 90 }, { x: 60, y: 90 }, { width: 206, height: 457 }),
    ).toEqual({ x: 103, y: 228.5 });
  });

  test("handles a layer that starts above the viewport", () => {
    expect(
      pivotAtViewportCenter({ left: -20, top: -900 }, { x: 0, y: 0 }, { width: 400, height: 300 }),
    ).toEqual({ x: 220, y: 1050 });
  });
});

describe("layer view canvas target", () => {
  test("keeps rotation without touching the DOM", () => {
    const view = createLayerView({ kind: "canvas" });
    expect(view.element).toBeNull();
    expect(view.rotation()).toBe(0);

    expect(view.setRotation(20)).toBe(true);
    expect(view.rotation()).toBe(20);

    view.restore();
    expect(view.rotation()).toBe(0);
  });
});
