import { describe, expect, test } from "bun:test";

import { createEditHistory } from "../src/lib/history";

describe("edit history basics", () => {
  test("undo walks back through commits and redo walks forward", () => {
    const history = createEditHistory<string>({ limit: 10 });
    history.commit("a");
    history.commit("b");

    expect(history.canUndo()).toBe(true);
    expect(history.undo("current")).toBe("b");
    expect(history.undo("b")).toBe("a");
    expect(history.undo("a")).toBeUndefined();
    expect(history.canUndo()).toBe(false);

    expect(history.redo("a")).toBe("b");
    expect(history.redo("b")).toBe("current");
    expect(history.redo("current")).toBeUndefined();
  });

  test("a new commit clears the redo branch", () => {
    const history = createEditHistory<string>({ limit: 10 });
    history.commit("a");
    expect(history.undo("current")).toBe("a");
    expect(history.canRedo()).toBe(true);

    history.commit("b");
    expect(history.canRedo()).toBe(false);
    expect(history.undo("current")).toBe("b");
  });

  test("depths report the retained history", () => {
    const history = createEditHistory<string>({ limit: 10 });
    expect(history.undoDepth()).toBe(0);
    history.commit("a");
    history.commit("b");
    expect(history.undoDepth()).toBe(2);
    history.undo("c");
    expect(history.undoDepth()).toBe(1);
    expect(history.redoDepth()).toBe(1);
  });
});

describe("edit history budget", () => {
  test("keeps only the newest `limit` entries and evicts the oldest", () => {
    const evicted: string[] = [];
    const history = createEditHistory<string>({
      limit: 3,
      onEvict: (state) => evicted.push(state),
    });
    for (const state of ["a", "b", "c", "d", "e"]) history.commit(state);

    expect(history.undoDepth()).toBe(3);
    expect(evicted).toEqual(["a", "b"]);
    // Newest three survive, oldest first when undoing.
    expect(history.undo("current")).toBe("e");
    expect(history.undo("e")).toBe("d");
    expect(history.undo("d")).toBe("c");
    expect(history.undo("c")).toBeUndefined();
  });

  test("`maxEntries` caps a larger `limit`", () => {
    const history = createEditHistory<number>({ limit: 100, maxEntries: 2 });
    for (const value of [1, 2, 3]) history.commit(value);
    expect(history.undoDepth()).toBe(2);
  });

  test("a zero budget keeps nothing but stays usable", () => {
    const history = createEditHistory<string>({ limit: 0 });
    history.commit("a");
    expect(history.canUndo()).toBe(false);
    expect(history.undo("current")).toBeUndefined();
  });

  test("eviction keeps reporting across the ring wrap-around", () => {
    const evicted: number[] = [];
    const history = createEditHistory<number>({
      limit: 3,
      onEvict: (state) => evicted.push(state),
    });
    for (const value of [1, 2, 3, 4, 5, 6, 7]) history.commit(value);

    expect(evicted).toEqual([1, 2, 3, 4]);
    expect(history.undoDepth()).toBe(3);
    // The ring wrapped twice; the surviving order must still be oldest → newest.
    expect(history.undo("x")).toBe(7);
    expect(history.undo(7)).toBe(6);
    expect(history.undo(6)).toBe(5);
  });

  test("clearing the redo branch reports its entries too", () => {
    const evicted: string[] = [];
    const history = createEditHistory<string>({
      limit: 5,
      onEvict: (state) => evicted.push(state),
    });
    history.commit("a");
    history.undo("current");
    history.commit("b");
    expect(evicted).toContain("current");
  });
});

describe("edit history coalescing", () => {
  test("coalesceWith replaces the newest entry instead of pushing", () => {
    const history = createEditHistory<number>({ limit: 10 });
    history.commit(1);
    history.commit(2, { coalesceWith: (newest) => newest + 10 });
    history.commit(3, { coalesceWith: (newest) => newest + 10 });

    expect(history.undoDepth()).toBe(1);
    // 1 → (replace with 1+10=11) → (replace with 11+10=21)
    expect(history.undo(99)).toBe(21);
  });

  test("coalescing into an empty history behaves like a plain commit", () => {
    const history = createEditHistory<number>({ limit: 10 });
    history.commit(5, { coalesceWith: () => 99 });
    expect(history.undo(0)).toBe(5);
  });
});

describe("edit history clear", () => {
  test("clear drops both stacks and reports every entry", () => {
    const evicted: string[] = [];
    const history = createEditHistory<string>({
      limit: 5,
      onEvict: (state) => evicted.push(state),
    });
    history.commit("a");
    history.commit("b");
    // `undo` moves "b" out of the undo ring and into the redo stack.
    history.undo("current");

    history.clear();
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(evicted.sort()).toEqual(["a", "current"]);
  });

  test("stays usable after clear", () => {
    const history = createEditHistory<string>({ limit: 5 });
    history.commit("a");
    history.clear();
    history.commit("b");
    expect(history.undo("c")).toBe("b");
  });
});
