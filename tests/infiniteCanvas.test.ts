import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  applyInfiniteCanvas,
  hasInfiniteCanvas,
  type InfiniteCanvas,
} from "../src/lib/scenel/infiniteCanvas.ts";

/**
 * `infiniteCanvas.ts` has no viewport/world coordinate math — that lives in
 * `layers/layerView.ts` (`mapLayerPoint` / `unmapClientPoint` /
 * `pivotAtViewportCenter`, covered by `tests/layerView.test.ts`). What is
 * testable here is the spacer contract: the surface size validation, the
 * document-level singleton, and `destroy`. The fake document only implements
 * the few members the module touches, so the unit test stays DOM-free.
 */

type FakeCanvasElement = {
  readonly tagName: string;
  readonly attributes: Map<string, string>;
  className: string;
  readonly style: { cssText: string };
  removed: boolean;
  setAttribute(name: string, value: string): void;
  remove(): void;
};

type FakeDocument = {
  readonly appended: FakeCanvasElement[];
  readonly body: { append(element: FakeCanvasElement): void } | undefined;
  createElement(tagName: string): FakeCanvasElement;
};

function installFakeDocument(options: { withBody?: boolean } = {}): FakeDocument {
  const appended: FakeCanvasElement[] = [];
  const doc: FakeDocument = {
    appended,
    body:
      options.withBody === false
        ? undefined
        : {
            append(element: FakeCanvasElement): void {
              appended.push(element);
            },
          },
    createElement(tagName: string): FakeCanvasElement {
      const element: FakeCanvasElement = {
        tagName,
        attributes: new Map<string, string>(),
        className: "",
        style: { cssText: "" },
        removed: false,
        setAttribute(name: string, value: string): void {
          element.attributes.set(name, value);
        },
        remove(): void {
          element.removed = true;
          const index = appended.indexOf(element);
          if (index >= 0) appended.splice(index, 1);
        },
      };
      return element;
    },
  };
  (globalThis as { document?: unknown }).document = doc;
  return doc;
}

function elementOf(handle: InfiniteCanvas): FakeCanvasElement {
  return handle.element as unknown as FakeCanvasElement;
}

let doc: FakeDocument;

beforeEach(() => {
  doc = installFakeDocument();
});

afterEach(() => {
  // The singleton lives in the module; drop it before the fake document goes away.
  if (hasInfiniteCanvas()) applyInfiniteCanvas().destroy();
  delete (globalThis as { document?: unknown }).document;
});

describe("infinite canvas spacer", () => {
  test("is absent before the first apply", () => {
    expect(hasInfiniteCanvas()).toBe(false);
  });

  test("appends one spacer with the default surface size", () => {
    const handle = applyInfiniteCanvas();
    const element = elementOf(handle);

    expect(hasInfiniteCanvas()).toBe(true);
    expect(doc.appended).toEqual([element]);
    expect(element.tagName).toBe("div");
    expect(element.className).toBe("gpen-canvas-space");
    expect(element.attributes.get("data-gpen-canvas-space")).toBe("");
    expect(element.style.cssText).toContain("width:200000px;height:200000px");
  });

  test("accepts an explicit surface size", () => {
    const element = elementOf(applyInfiniteCanvas({ surface: 512 }));

    expect(element.style.cssText).toContain("width:512px;height:512px");
  });

  test("falls back to the default when the surface is not a usable number", () => {
    for (const surface of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const element = elementOf(applyInfiniteCanvas({ surface }));
      expect(element.style.cssText).toContain("width:200000px;height:200000px");
      applyInfiniteCanvas().destroy();
    }
  });

  test("keeps a single spacer across repeated applies", () => {
    const first = applyInfiniteCanvas();
    const second = applyInfiniteCanvas();

    expect(second.element).toBe(first.element);
    expect(doc.appended).toHaveLength(1);
  });

  test("destroy removes the node and clears the singleton", () => {
    const handle = applyInfiniteCanvas();
    const element = elementOf(handle);

    handle.destroy();

    expect(hasInfiniteCanvas()).toBe(false);
    expect(element.removed).toBe(true);
    expect(doc.appended).toHaveLength(0);
    // A second destroy is a no-op (the singleton already moved on).
    handle.destroy();
  });

  test("can be applied again after destroy", () => {
    const first = applyInfiniteCanvas();
    first.destroy();

    const second = applyInfiniteCanvas();

    expect(second.element).not.toBe(first.element);
    expect(doc.appended).toHaveLength(1);
  });

  test("is a no-op when there is no document", () => {
    delete (globalThis as { document?: unknown }).document;

    const handle = applyInfiniteCanvas();

    expect(handle.element).toBeNull();
    expect(hasInfiniteCanvas()).toBe(false);
    expect(() => handle.destroy()).not.toThrow();
  });

  test("is a no-op when the document has no body", () => {
    installFakeDocument({ withBody: false });

    const handle = applyInfiniteCanvas();

    expect(handle.element).toBeNull();
    expect(hasInfiniteCanvas()).toBe(false);
    expect(doc.appended).toHaveLength(0);
  });
});
