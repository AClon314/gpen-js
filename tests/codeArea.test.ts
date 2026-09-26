import { describe, expect, test } from "bun:test";

import { EditorSelection } from "@codemirror/state";

import {
  clampSelectionToLength,
  minimalTextChange,
} from "../src/lib/components/widgets/inputs/codeEditorView";
import { formatDebugValue } from "../src/lib/components/codeArea/format";
import {
  codeAreaPanelId,
  codeAreaSourceIdOf,
  getCodeAreaSource,
  isCodeAreaPanelId,
  listCodeAreaSources,
  mergeCodeAreaSnapshot,
  readCodeAreaSource,
  registerCodeAreaSource,
  type CodeAreaSource,
} from "../src/lib/components/codeArea/source";

describe("formatDebugValue", () => {
  test("formats plain JSON shapes", () => {
    const result = formatDebugValue({ a: 1, b: [true, null], c: "x" });
    expect(result.truncated).toBe(false);
    expect(result.omitted).toBe(0);
    expect(result.text).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ],\n  "c": "x"\n}');
  });

  test("each JSON value kind maps to a stable text form (table-driven)", () => {
    // 「类型判定 → 转换 → 兜底」三段各自吃一类输入：这里的表把每一类的输出钉死，
    // 以后拆 toSafeData 时行为漂移会立刻挂在这一张表上。
    class Named {}
    const cases: readonly [label: string, value: unknown, text: string][] = [
      ["null", null, "null"],
      ["boolean", true, "true"],
      ["number", 42, "42"],
      ["string", "hi", '"hi"'],
      ["array", [1, "a"], '[\n  1,\n  "a"\n]'],
      ["plain object", { k: 1 }, '{\n  "k": 1\n}'],
      ["undefined", undefined, '"<undefined>"'],
      ["bigint", 7n, '"<bigint 7n>"'],
      ["symbol with description", Symbol("tag"), '"<symbol tag>"'],
      ["symbol without description", Symbol(), '"<symbol >"'],
      ["named function", function named() {}, '"<function named>"'],
      ["date", new Date("2026-09-21T00:00:00.000Z"), '"<Date 2026-09-21T00:00:00.000Z>"'],
      ["regexp", /ab+c/g, '"<RegExp ab+c>"'],
      ["error", new Error("boom"), '{\n  "name": "Error",\n  "message": "boom"\n}'],
      ["promise", Promise.resolve(1), '"<Promise>"'],
      ["map", new Map([["k", 1]]), '{\n  "<Map>": [\n    [\n      "k",\n      1\n    ]\n  ]\n}'],
      ["set", new Set([1]), '{\n  "<Set>": [\n    1\n  ]\n}'],
      ["class instance", new Named(), "{}"],
    ];

    for (const [label, value, text] of cases) {
      expect(formatDebugValue(value).text, label).toBe(text);
    }
  });

  test("renders values JSON cannot express as markers", () => {
    const result = formatDebugValue({
      missing: undefined,
      fn: function named() {},
      arrow: () => {},
      big: 10n,
      sym: Symbol("tag"),
      date: new Date("2026-09-21T00:00:00.000Z"),
      re: /ab+c/g,
      err: new Error("boom"),
      list: new Set([1]),
      map: new Map([["k", "v"]]),
    });
    const text = result.text;
    expect(text).toContain('"<undefined>"');
    expect(text).toContain('"<function named>"');
    // 匿名箭头函数也会拿到推断出来的名字（对象字面量属性）。
    expect(text).toContain('"<function arrow>"');
    expect(text).toContain('"<bigint 10n>"');
    expect(text).toContain('"<symbol tag>"');
    expect(text).toContain('"<Date 2026-09-21T00:00:00.000Z>"');
    expect(text).toContain('"<RegExp ab+c>"');
    expect(text).toContain('"message": "boom"');
    expect(text).toContain('"<Set>"');
    expect(text).toContain('"<Map>"');
  });

  test("marks cycles and keeps repeated-but-acyclic references", () => {
    const shared = { value: 1 };
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    const result = formatDebugValue({ cyclic, shared, again: shared });
    expect(result.text).toContain('"<circular>"');
    // 同一个对象出现两次（但没有成环）应该照常展开两次，不能被误判成循环。
    expect(result.text.match(/"value": 1/g)?.length).toBe(2);
  });

  test("caps entries and depth and reports how much was dropped", () => {
    const wide = formatDebugValue(
      { list: Array.from({ length: 10 }, (_, i) => i) },
      {
        maxEntries: 3,
      },
    );
    expect(wide.omitted).toBe(7);
    expect(wide.text).toContain("省略 7 项");

    const deep = formatDebugValue({ a: { b: { c: 1 } } }, { maxDepth: 1 });
    expect(deep.omitted).toBeGreaterThan(0);
    expect(deep.text).toContain("<depth 1>");
  });

  test("truncates by maxLength and keeps the full length", () => {
    const result = formatDebugValue({ text: "x".repeat(500) }, { maxLength: 40 });
    expect(result.truncated).toBe(true);
    expect(result.fullLength).toBeGreaterThan(500);
    expect(result.text.startsWith('{\n  "text": "xxx')).toBe(true);
    expect(result.text).toContain("已截断：完整");
  });
});

describe("codeArea source registry", () => {
  const source: CodeAreaSource = {
    id: "unit-test-source",
    title: "Unit",
    read: () => ({ ok: true }),
  };

  test("panel ids round-trip and only match codearea panels", () => {
    const panelId = codeAreaPanelId("unit-test-source");
    expect(panelId).toBe("codearea:unit-test-source");
    expect(isCodeAreaPanelId(panelId)).toBe(true);
    expect(codeAreaSourceIdOf(panelId)).toBe("unit-test-source");
    expect(isCodeAreaPanelId("viewport")).toBe(false);
    expect(codeAreaSourceIdOf("viewport")).toBeUndefined();
    expect(codeAreaSourceIdOf("codearea:")).toBeUndefined();
  });

  test("registers, resolves and unregisters by identity", () => {
    const dispose = registerCodeAreaSource(source);
    expect(getCodeAreaSource("unit-test-source")).toBe(source);
    expect(listCodeAreaSources()).toContain(source);

    // 后来者覆盖同 id，但先登记的那个注销时不能把新的顺带删掉。
    const replacement: CodeAreaSource = { ...source, title: "Replacement" };
    const disposeReplacement = registerCodeAreaSource(replacement);
    dispose();
    expect(getCodeAreaSource("unit-test-source")).toBe(replacement);
    disposeReplacement();
    expect(getCodeAreaSource("unit-test-source")).toBeUndefined();
  });

  test("read failure degrades to an error tree instead of throwing", () => {
    const broken: CodeAreaSource = {
      id: "broken",
      title: "Broken",
      read() {
        throw new Error("nope");
      },
    };
    const value = readCodeAreaSource(broken) as { error?: string };
    expect(value.error).toContain("nope");
    expect((readCodeAreaSource(undefined) as { error?: string }).error).toContain("数据源不存在");
  });

  test("merges the async snapshot onto the live tree", () => {
    expect(mergeCodeAreaSnapshot({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(mergeCodeAreaSnapshot({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    // 同名的键以异步快照为准（异步是后到的、更具体的那份）。
    expect(mergeCodeAreaSnapshot({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(mergeCodeAreaSnapshot(undefined, { a: 1 })).toEqual({ value: undefined, a: 1 });
    expect(mergeCodeAreaSnapshot([1, 2], { a: 1 })).toEqual({ values: [1, 2], a: 1 });
  });
});

describe("codeEditorView helpers", () => {
  test("minimalTextChange trims the common prefix and suffix", () => {
    expect(minimalTextChange("abcdef", "abcdef")).toEqual({ from: 0, to: 0, insert: "" });
    expect(minimalTextChange("abc", "abcd")).toEqual({ from: 3, to: 3, insert: "d" });
    expect(minimalTextChange("abcd", "abc")).toEqual({ from: 3, to: 4, insert: "" });
    expect(minimalTextChange("hello world", "hello brave world")).toEqual({
      from: 6,
      to: 6,
      insert: "brave ",
    });
    // 中间一整块换掉：前缀 2 + 后缀 2。
    expect(minimalTextChange("abXYZef", "ab123ef")).toEqual({ from: 2, to: 5, insert: "123" });
  });

  test("minimalTextChange handles disjoint edge cases without overlapping", () => {
    // 全等前缀 + 完全不同：只能整段换（from 0），后缀不能与前缀重叠。
    expect(minimalTextChange("aaaa", "aabb")).toEqual({ from: 2, to: 4, insert: "bb" });
    // 空串两端。
    expect(minimalTextChange("", "x")).toEqual({ from: 0, to: 0, insert: "x" });
    expect(minimalTextChange("x", "")).toEqual({ from: 0, to: 1, insert: "" });
    // 每处都不同：整段替换。
    const change = minimalTextChange("abc", "xyz");
    expect(change.from).toBe(0);
    expect(change.to).toBe(3);
    expect(change.insert).toBe("xyz");
  });

  test("clampSelectionToLength keeps the offset and clamps it to the new length", () => {
    const selection = EditorSelection.single(5, 9);
    expect(clampSelectionToLength(selection, 100).main.head).toBe(9);
    // 文档变短：夹到新长度。
    expect(clampSelectionToLength(selection, 7).main.head).toBe(7);
    expect(clampSelectionToLength(selection, 7).main.anchor).toBe(5);
    expect(clampSelectionToLength(selection, 0).main.head).toBe(0);
    // 多光标：每个 range 都夹，主 range 不变。
    const multi = EditorSelection.create(
      [EditorSelection.cursor(1), EditorSelection.cursor(50)],
      1,
    );
    const clamped = clampSelectionToLength(multi, 10);
    expect(clamped.ranges.length).toBe(2);
    expect(clamped.mainIndex).toBe(1);
    expect(clamped.ranges[1].head).toBe(10);
  });
});
