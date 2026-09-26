import { describe, expect, test } from "bun:test";

import {
  addStepToValue,
  clampAndRound,
  decimalPlaces,
  numericAttribute,
  significantPlace,
  stepAmount,
  stepByDigit,
  stepByPrecision,
  stepByRule,
  stepRuleAt,
  stepAtCaret,
  toggleSign,
  validateNumeric,
} from "../src/lib/inputs/numericCaret.ts";

describe("validateNumeric", () => {
  test("clamps to min/max and rounds to the step width", () => {
    expect(validateNumeric(150, { min: 0, max: 100 })).toBe(100);
    expect(validateNumeric(-5, { min: 0, max: 100 })).toBe(0);
    expect(validateNumeric(23.456, { step: 0.01 })).toBe(23.46);
    expect(validateNumeric(23.44, { min: 0, max: 100, step: 0.2 })).toBe(23.4);
    expect(validateNumeric(9.9876)).toBe(9.9876);
  });
});

describe("clampAndRound", () => {
  test("clamps, rounds to the requested width and clamps again", () => {
    expect(clampAndRound(10.014, 0, 100, 2)).toBe(10.01);
    expect(clampAndRound(10.015, 0, 100, 2)).toBe(10.02);
    expect(clampAndRound(120, 0, 100, 2)).toBe(100);
    expect(clampAndRound(-5, 0, undefined, 0)).toBe(0);
    expect(clampAndRound(9.987, undefined, undefined, 3)).toBe(9.987);
    expect(clampAndRound(-0, undefined, undefined, 0)).toBe(0);
  });

  test("leaves the value alone without a width", () => {
    expect(clampAndRound(9.9876, 0, 100, undefined)).toBe(9.9876);
  });
});

describe("decimalPlaces", () => {
  test("reads the fractional width, exponent-aware", () => {
    expect(decimalPlaces(1)).toBe(0);
    expect(decimalPlaces(30)).toBe(0);
    expect(decimalPlaces(0.2)).toBe(1);
    expect(decimalPlaces(0.001)).toBe(3);
    expect(decimalPlaces(1e-7)).toBe(7);
  });
});

describe("stepAtCaret: case 2 (digit place)", () => {
  test("steps the digit to the left of the caret", () => {
    expect(stepAtCaret("23.45", 3, 1)).toEqual({ text: "23.55", caret: 3 });
    expect(stepAtCaret("23.45", 3, -1)).toEqual({ text: "23.35", caret: 3 });
    expect(stepAtCaret("23.50", 5, -1)).toEqual({ text: "23.49", caret: 5 });
    expect(stepAtCaret("23.45", 5, 1)).toEqual({ text: "23.46", caret: 5 });
  });

  test("carries across digit groups, keeping the fractional width", () => {
    expect(stepAtCaret("23.9", 4, 1)).toEqual({ text: "24.0", caret: 4 });
    expect(stepAtCaret("9", 1, 1)).toEqual({ text: "10", caret: 2 });
  });

  test("keeps the field's decimal width instead of dropping a zero", () => {
    expect(stepAtCaret("23.49", 5, 1)).toEqual({ text: "23.50", caret: 5 });
    expect(stepAtCaret("23.49", 5, -1)).toEqual({ text: "23.48", caret: 5 });
  });
});

describe("stepAtCaret: case 3 (in front of the number)", () => {
  test("steps the leading digit in place, without inventing a new one", () => {
    expect(stepAtCaret("90", 0, 1)).toEqual({ text: "100", caret: 0 });
    expect(stepAtCaret("234", 0, 1)).toEqual({ text: "334", caret: 0 });
    expect(stepAtCaret("234", 0, -1)).toEqual({ text: "134", caret: 0 });
    expect(stepAtCaret("99", 0, 1)).toEqual({ text: "109", caret: 0 });
  });

  test("un-carries a leading 1 when stepping down", () => {
    expect(stepAtCaret("100", 0, -1)).toEqual({ text: "90", caret: 0 });
    expect(stepAtCaret("109", 0, -1)).toEqual({ text: "99", caret: 0 });
    expect(stepAtCaret("209", 0, -1)).toEqual({ text: "109", caret: 0 });
    expect(stepAtCaret("10", 0, -1)).toEqual({ text: "9", caret: 0 });
  });

  test("keeps single-digit fronts on the units place and stops at zero", () => {
    expect(stepAtCaret("1.98", 0, -1)).toEqual({ text: "0.98", caret: 0 });
    expect(stepAtCaret("0.98", 0, -1)).toEqual({ text: "0.00", caret: 0 });
    expect(stepAtCaret("0.5", 0, -1)).toEqual({ text: "0.0", caret: 0 });
  });

  test("steps into the fractional wheel at the 1 → 0.9 boundary", () => {
    expect(stepAtCaret("1.0", 0, -1)).toEqual({ text: "0.9", caret: 2 });
    expect(stepAtCaret("1.00", 0, -1)).toEqual({ text: "0.90", caret: 2 });
    // 没有小数位时仍按单位退位（整数字段能从 1 降到 0）。
    expect(stepAtCaret("1", 0, -1)).toEqual({ text: "0", caret: 0 });
    expect(stepAtCaret("1.98", 0, -1)).toEqual({ text: "0.98", caret: 0 });
    expect(stepAtCaret("0.9", 2, 1)).toEqual({ text: "1", caret: 0 });
  });

  test("preserves the sign and steps the magnitude", () => {
    expect(stepAtCaret("-89", 1, 1)).toEqual({ text: "-99", caret: 1 });
    expect(stepAtCaret("-99", 1, 1)).toEqual({ text: "-109", caret: 1 });
    expect(stepAtCaret("-109", 1, 1)).toEqual({ text: "-209", caret: 1 });
    expect(stepAtCaret("-109", 1, -1)).toEqual({ text: "-99", caret: 1 });
    expect(stepAtCaret("-1.98", 1, -1)).toEqual({ text: "-0.98", caret: 1 });
    expect(stepAtCaret("-0.98", 1, -1)).toEqual({ text: "0.00", caret: 0 });
  });
});

describe("stepAtCaret: case 4 (right of the decimal point)", () => {
  test("activates the fractional wheel", () => {
    expect(stepAtCaret("23.", 3, 1)).toEqual({ text: "23.0", caret: 3 });
    expect(stepAtCaret("23.0", 3, 1)).toEqual({ text: "23.1", caret: 3 });
  });

  test("walks the first non-zero fractional digit", () => {
    expect(stepAtCaret("0.18", 2, -1)).toEqual({ text: "0.08", caret: 2 });
    expect(stepAtCaret("0.08", 2, -1)).toEqual({ text: "0.07", caret: 2 });
    expect(stepAtCaret("0.009", 2, 1)).toEqual({ text: "0.01", caret: 2 });
    expect(stepAtCaret("0.09", 2, 1)).toEqual({ text: "0.1", caret: 2 });
  });

  test("extends the precision instead of collapsing to zero", () => {
    expect(stepAtCaret("0.01", 2, -1)).toEqual({ text: "0.009", caret: 2 });
    expect(stepAtCaret("0.1", 2, -1)).toEqual({ text: "0.09", caret: 2 });
  });

  test("moves in front of the number when a carry reaches the integer part", () => {
    expect(stepAtCaret("0.9", 2, 1)).toEqual({ text: "1", caret: 0 });
  });
});

describe("stepAtCaret: case 5 (left of the sign)", () => {
  test("cycles between explicit signs", () => {
    expect(stepAtCaret("-5", 0, 1)).toEqual({ text: "+5", caret: 0 });
    expect(stepAtCaret("+5", 0, 1)).toEqual({ text: "-5", caret: 0 });
    expect(stepAtCaret("-0.5", 0, -1)).toEqual({ text: "+0.5", caret: 0 });
  });

  test("an explicit plus survives digit stepping", () => {
    expect(stepAtCaret("+5", 1, 1)).toEqual({ text: "+6", caret: 1 });
  });
});

describe("stepAtCaret: guards", () => {
  test("returns non-numeric text unchanged", () => {
    expect(stepAtCaret("abc", 1, 1)).toEqual({ text: "abc", caret: 1 });
    expect(stepAtCaret("", 0, 1)).toEqual({ text: "", caret: 0 });
  });

  test("clamps an out-of-range caret", () => {
    expect(stepAtCaret("23.45", -10, 1).caret).toBe(0);
    expect(stepAtCaret("23.45", 100, 1).caret).toBe(5);
  });
});

type StepCase = [text: string, caret: number, direction: -1 | 1, outText: string, outCaret: number];

// 非数值文本直接原样返回（空串 / 空白 / 多个小数点 / 溢出指数）
const GUARDS: StepCase[] = [
  ["", 0, 1, "", 0],
  ["", 0, -1, "", 0],
  ["  ", 0, 1, "  ", 0],
  ["  ", 0, -1, "  ", 0],
  ["  ", 1, 1, "  ", 1],
  ["  ", 1, -1, "  ", 1],
  ["  ", 2, 1, "  ", 2],
  ["  ", 2, -1, "  ", 2],
  ["abc", 0, 1, "abc", 0],
  ["abc", 0, -1, "abc", 0],
  ["abc", 1, 1, "abc", 1],
  ["abc", 1, -1, "abc", 1],
  ["abc", 3, 1, "abc", 3],
  ["abc", 3, -1, "abc", 3],
  ["1.2.3", 0, 1, "1.2.3", 0],
  ["1.2.3", 0, -1, "1.2.3", 0],
  ["1.2.3", 1, 1, "1.2.3", 1],
  ["1.2.3", 1, -1, "1.2.3", 1],
  ["1.2.3", 3, 1, "1.2.3", 3],
  ["1.2.3", 3, -1, "1.2.3", 3],
  ["1.2.3", 5, 1, "1.2.3", 5],
  ["1.2.3", 5, -1, "1.2.3", 5],
  ["1e999", 0, 1, "1e999", 0],
  ["1e999", 0, -1, "1e999", 0],
  ["1e999", 1, 1, "1e999", 1],
  ["1e999", 1, -1, "1e999", 1],
  ["1e999", 5, 1, "1e999", 5],
  ["1e999", 5, -1, "1e999", 5],
];

// case 5：光标在符号左侧，切换符号（保留显式 +）
const TOGGLE: StepCase[] = [
  ["-5", 0, 1, "+5", 0],
  ["-5", 0, -1, "+5", 0],
  ["+5", 0, 1, "-5", 0],
  ["+5", 0, -1, "-5", 0],
  ["-0.5", 0, 1, "+0.5", 0],
  ["-0.5", 0, -1, "+0.5", 0],
  ["+0.5", 0, 1, "-0.5", 0],
  ["+0.5", 0, -1, "-0.5", 0],
];

// case 3：光标在数字前面（含符号后），按最左整数位步进
const FRONT: StepCase[] = [
  ["90", 0, 1, "100", 0],
  ["90", 0, -1, "80", 0],
  ["90", 1, 1, "100", 2],
  ["90", 1, -1, "80", 1],
  ["90", 2, 1, "91", 2],
  ["90", 2, -1, "89", 2],
  ["234", 0, 1, "334", 0],
  ["234", 0, -1, "134", 0],
  ["234", 1, 1, "334", 1],
  ["234", 1, -1, "134", 1],
  ["234", 2, 1, "244", 2],
  ["234", 2, -1, "224", 2],
  ["234", 3, 1, "235", 3],
  ["234", 3, -1, "233", 3],
  ["99", 0, 1, "109", 0],
  ["99", 0, -1, "89", 0],
  ["99", 1, 1, "109", 2],
  ["99", 1, -1, "89", 1],
  ["99", 2, 1, "100", 3],
  ["99", 2, -1, "98", 2],
  ["100", 0, 1, "200", 0],
  ["100", 0, -1, "90", 0],
  ["100", 1, 1, "200", 1],
  ["100", 1, -1, "0", 0],
  ["100", 2, 1, "110", 2],
  ["100", 2, -1, "90", 1],
  ["100", 3, 1, "101", 3],
  ["100", 3, -1, "99", 2],
  ["109", 0, 1, "209", 0],
  ["109", 0, -1, "99", 0],
  ["109", 1, 1, "209", 1],
  ["109", 1, -1, "9", 0],
  ["109", 2, 1, "119", 2],
  ["109", 2, -1, "99", 1],
  ["109", 3, 1, "110", 3],
  ["109", 3, -1, "108", 3],
  ["209", 0, 1, "309", 0],
  ["209", 0, -1, "109", 0],
  ["209", 1, 1, "309", 1],
  ["209", 1, -1, "109", 1],
  ["209", 2, 1, "219", 2],
  ["209", 2, -1, "199", 2],
  ["209", 3, 1, "210", 3],
  ["209", 3, -1, "208", 3],
  ["10", 0, 1, "20", 0],
  ["10", 0, -1, "9", 0],
  ["10", 1, 1, "20", 1],
  ["10", 1, -1, "0", 0],
  ["10", 2, 1, "11", 2],
  ["10", 2, -1, "9", 1],
  ["1", 0, 1, "2", 0],
  ["1", 0, -1, "0", 0],
  ["1", 1, 1, "2", 1],
  ["1", 1, -1, "0", 1],
  ["1.0", 0, 1, "2.0", 0],
  ["1.0", 0, -1, "0.9", 2],
  ["1.0", 1, 1, "2.0", 1],
  ["1.0", 1, -1, "0.0", 1],
  ["1.0", 2, 1, "1.1", 2],
  ["1.0", 2, -1, "0.9", 2],
  ["1.0", 3, 1, "1.1", 3],
  ["1.0", 3, -1, "0.9", 3],
  ["1.00", 0, 1, "2.00", 0],
  ["1.00", 0, -1, "0.90", 2],
  ["1.00", 1, 1, "2.00", 1],
  ["1.00", 1, -1, "0.00", 1],
  ["1.00", 2, 1, "1.1", 2],
  ["1.00", 2, -1, "0.9", 2],
  ["1.00", 3, 1, "1.10", 3],
  ["1.00", 3, -1, "0.90", 3],
  ["1.00", 4, 1, "1.01", 4],
  ["1.00", 4, -1, "0.99", 4],
  ["1.98", 0, 1, "2.98", 0],
  ["1.98", 0, -1, "0.98", 0],
  ["1.98", 1, 1, "2.98", 1],
  ["1.98", 1, -1, "0.98", 1],
  ["1.98", 2, 1, "2.08", 2],
  ["1.98", 2, -1, "1.88", 2],
  ["1.98", 3, 1, "2.08", 3],
  ["1.98", 3, -1, "1.88", 3],
  ["1.98", 4, 1, "1.99", 4],
  ["1.98", 4, -1, "1.97", 4],
  ["0.98", 0, 1, "1.98", 0],
  ["0.98", 0, -1, "0.00", 0],
  ["0.98", 1, 1, "1.98", 1],
  ["0.98", 1, -1, "0.00", 1],
  ["0.98", 2, 1, "1.08", 2],
  ["0.98", 2, -1, "0.88", 2],
  ["0.98", 3, 1, "1.08", 3],
  ["0.98", 3, -1, "0.88", 3],
  ["0.98", 4, 1, "0.99", 4],
  ["0.98", 4, -1, "0.97", 4],
  ["0.5", 0, 1, "1.5", 0],
  ["0.5", 0, -1, "0.0", 0],
  ["0.5", 1, 1, "1.5", 1],
  ["0.5", 1, -1, "0.0", 1],
  ["0.5", 2, 1, "0.6", 2],
  ["0.5", 2, -1, "0.4", 2],
  ["0.5", 3, 1, "0.6", 3],
  ["0.5", 3, -1, "0.4", 3],
  ["0.9", 0, 1, "1.9", 0],
  ["0.9", 0, -1, "0.0", 0],
  ["0.9", 1, 1, "1.9", 1],
  ["0.9", 1, -1, "0.0", 1],
  ["0.9", 2, 1, "1", 0],
  ["0.9", 2, -1, "0.8", 2],
  ["0.9", 3, 1, "1.0", 3],
  ["0.9", 3, -1, "0.8", 3],
  ["-89", 0, 1, "+89", 0],
  ["-89", 0, -1, "+89", 0],
  ["-89", 1, 1, "-99", 1],
  ["-89", 1, -1, "-79", 1],
  ["-89", 2, 1, "-99", 2],
  ["-89", 2, -1, "-79", 2],
  ["-89", 3, 1, "-90", 3],
  ["-89", 3, -1, "-88", 3],
  ["-99", 0, 1, "+99", 0],
  ["-99", 0, -1, "+99", 0],
  ["-99", 1, 1, "-109", 1],
  ["-99", 1, -1, "-89", 1],
  ["-99", 2, 1, "-109", 3],
  ["-99", 2, -1, "-89", 2],
  ["-99", 3, 1, "-100", 4],
  ["-99", 3, -1, "-98", 3],
  ["-109", 0, 1, "+109", 0],
  ["-109", 0, -1, "+109", 0],
  ["-109", 1, 1, "-209", 1],
  ["-109", 1, -1, "-99", 1],
  ["-109", 2, 1, "-209", 2],
  ["-109", 2, -1, "-9", 0],
  ["-109", 3, 1, "-119", 3],
  ["-109", 3, -1, "-99", 2],
  ["-109", 4, 1, "-110", 4],
  ["-109", 4, -1, "-108", 4],
  ["-1.98", 0, 1, "+1.98", 0],
  ["-1.98", 0, -1, "+1.98", 0],
  ["-1.98", 1, 1, "-2.98", 1],
  ["-1.98", 1, -1, "-0.98", 1],
  ["-1.98", 2, 1, "-2.98", 2],
  ["-1.98", 2, -1, "-0.98", 2],
  ["-1.98", 3, 1, "-2.08", 3],
  ["-1.98", 3, -1, "-1.88", 3],
  ["-1.98", 4, 1, "-2.08", 4],
  ["-1.98", 4, -1, "-1.88", 4],
  ["-1.98", 5, 1, "-1.99", 5],
  ["-1.98", 5, -1, "-1.97", 5],
  ["-0.98", 0, 1, "+0.98", 0],
  ["-0.98", 0, -1, "+0.98", 0],
  ["-0.98", 1, 1, "-1.98", 1],
  ["-0.98", 1, -1, "0.00", 0],
  ["-0.98", 2, 1, "-1.98", 2],
  ["-0.98", 2, -1, "0.00", 1],
  ["-0.98", 3, 1, "-1.08", 3],
  ["-0.98", 3, -1, "-0.88", 3],
  ["-0.98", 4, 1, "-1.08", 4],
  ["-0.98", 4, -1, "-0.88", 4],
  ["-0.98", 5, 1, "-0.99", 5],
  ["-0.98", 5, -1, "-0.97", 5],
  ["+89", 0, 1, "-89", 0],
  ["+89", 0, -1, "-89", 0],
  ["+89", 1, 1, "+99", 1],
  ["+89", 1, -1, "+79", 1],
  ["+89", 2, 1, "+99", 2],
  ["+89", 2, -1, "+79", 2],
  ["+89", 3, 1, "+90", 3],
  ["+89", 3, -1, "+88", 3],
  ["+109", 0, 1, "-109", 0],
  ["+109", 0, -1, "-109", 0],
  ["+109", 1, 1, "+209", 1],
  ["+109", 1, -1, "+99", 1],
  ["+109", 2, 1, "+209", 2],
  ["+109", 2, -1, "+9", 0],
  ["+109", 3, 1, "+119", 3],
  ["+109", 3, -1, "+99", 2],
  ["+109", 4, 1, "+110", 4],
  ["+109", 4, -1, "+108", 4],
  ["1e5", 0, 1, "100010", 0],
  ["1e5", 0, -1, "99999", 0],
  ["1e5", 1, 1, "100010", 4],
  ["1e5", 1, -1, "99990", 3],
  ["1e5", 2, 1, "100010", 0],
  ["1e5", 2, -1, "99999", 0],
  ["1e5", 3, 1, "100001", 6],
  ["1e5", 3, -1, "99999", 5],
  ["1e-5", 0, 1, "10.00001", 0],
  ["1e-5", 0, -1, "0.00000", 0],
  ["1e-5", 1, 1, "10.00001", 5],
  ["1e-5", 1, -1, "0.00000", 4],
  ["1e-5", 2, 1, "10.00001", 0],
  ["1e-5", 2, -1, "0.00000", 0],
  ["1e-5", 3, 1, "10.00001", 0],
  ["1e-5", 3, -1, "0.00000", 0],
  ["1e-5", 4, 1, "1.00001", 7],
  ["1e-5", 4, -1, "0.00000", 7],
];

// case 4：光标在小数点右侧，走第一个非零小数位 / 空小数补 0 / 反向扩展精度
const AFTER_DOT: StepCase[] = [
  ["23.", 0, 1, "33", 0],
  ["23.", 0, -1, "13", 0],
  ["23.", 1, 1, "33", 0],
  ["23.", 1, -1, "13", 0],
  ["23.", 2, 1, "24", 1],
  ["23.", 2, -1, "22", 1],
  ["23.", 3, 1, "23.0", 3],
  ["23.", 3, -1, "23.0", 3],
  ["23.0", 0, 1, "33.0", 0],
  ["23.0", 0, -1, "13.0", 0],
  ["23.0", 1, 1, "33.0", 1],
  ["23.0", 1, -1, "13.0", 1],
  ["23.0", 2, 1, "24.0", 2],
  ["23.0", 2, -1, "22.0", 2],
  ["23.0", 3, 1, "23.1", 3],
  ["23.0", 3, -1, "22.9", 3],
  ["23.0", 4, 1, "23.1", 4],
  ["23.0", 4, -1, "22.9", 4],
  ["0.18", 0, 1, "1.18", 0],
  ["0.18", 0, -1, "0.00", 0],
  ["0.18", 1, 1, "1.18", 1],
  ["0.18", 1, -1, "0.00", 1],
  ["0.18", 2, 1, "0.28", 2],
  ["0.18", 2, -1, "0.08", 2],
  ["0.18", 3, 1, "0.28", 3],
  ["0.18", 3, -1, "0.08", 3],
  ["0.18", 4, 1, "0.19", 4],
  ["0.18", 4, -1, "0.17", 4],
  ["0.08", 0, 1, "1.08", 0],
  ["0.08", 0, -1, "0.00", 0],
  ["0.08", 1, 1, "1.08", 1],
  ["0.08", 1, -1, "0.00", 1],
  ["0.08", 2, 1, "0.09", 2],
  ["0.08", 2, -1, "0.07", 2],
  ["0.08", 3, 1, "0.18", 3],
  ["0.08", 3, -1, "0.00", 3],
  ["0.08", 4, 1, "0.09", 4],
  ["0.08", 4, -1, "0.07", 4],
  ["0.009", 0, 1, "1.009", 0],
  ["0.009", 0, -1, "0.000", 0],
  ["0.009", 1, 1, "1.009", 1],
  ["0.009", 1, -1, "0.000", 1],
  ["0.009", 2, 1, "0.01", 2],
  ["0.009", 2, -1, "0.008", 2],
  ["0.009", 3, 1, "0.109", 3],
  ["0.009", 3, -1, "0.000", 3],
  ["0.009", 4, 1, "0.019", 4],
  ["0.009", 4, -1, "0.000", 4],
  ["0.009", 5, 1, "0.010", 5],
  ["0.009", 5, -1, "0.008", 5],
  ["0.09", 0, 1, "1.09", 0],
  ["0.09", 0, -1, "0.00", 0],
  ["0.09", 1, 1, "1.09", 1],
  ["0.09", 1, -1, "0.00", 1],
  ["0.09", 2, 1, "0.1", 2],
  ["0.09", 2, -1, "0.08", 2],
  ["0.09", 3, 1, "0.19", 3],
  ["0.09", 3, -1, "0.00", 3],
  ["0.09", 4, 1, "0.10", 4],
  ["0.09", 4, -1, "0.08", 4],
  ["0.01", 0, 1, "1.01", 0],
  ["0.01", 0, -1, "0.00", 0],
  ["0.01", 1, 1, "1.01", 1],
  ["0.01", 1, -1, "0.00", 1],
  ["0.01", 2, 1, "0.02", 2],
  ["0.01", 2, -1, "0.009", 2],
  ["0.01", 3, 1, "0.11", 3],
  ["0.01", 3, -1, "0.00", 3],
  ["0.01", 4, 1, "0.02", 4],
  ["0.01", 4, -1, "0.00", 4],
  ["0.1", 0, 1, "1.1", 0],
  ["0.1", 0, -1, "0.0", 0],
  ["0.1", 1, 1, "1.1", 1],
  ["0.1", 1, -1, "0.0", 1],
  ["0.1", 2, 1, "0.2", 2],
  ["0.1", 2, -1, "0.09", 2],
  ["0.1", 3, 1, "0.2", 3],
  ["0.1", 3, -1, "0.0", 3],
  ["0.000", 0, 1, "1.000", 0],
  ["0.000", 0, -1, "0.000", 0],
  ["0.000", 1, 1, "1.000", 1],
  ["0.000", 1, -1, "0.000", 1],
  ["0.000", 2, 1, "0.1", 2],
  ["0.000", 2, -1, "0", 0],
  ["0.000", 3, 1, "0.100", 3],
  ["0.000", 3, -1, "0.000", 3],
  ["0.000", 4, 1, "0.010", 4],
  ["0.000", 4, -1, "0.000", 4],
  ["0.000", 5, 1, "0.001", 5],
  ["0.000", 5, -1, "0.000", 5],
];

// case 2：光标在某位数字右侧，按该数字位权步进（整数位 / 小数位）
const DIGIT: StepCase[] = [
  ["23.45", 0, 1, "33.45", 0],
  ["23.45", 0, -1, "13.45", 0],
  ["23.45", 1, 1, "33.45", 1],
  ["23.45", 1, -1, "13.45", 1],
  ["23.45", 2, 1, "24.45", 2],
  ["23.45", 2, -1, "22.45", 2],
  ["23.45", 3, 1, "23.55", 3],
  ["23.45", 3, -1, "23.35", 3],
  ["23.45", 4, 1, "23.55", 4],
  ["23.45", 4, -1, "23.35", 4],
  ["23.45", 5, 1, "23.46", 5],
  ["23.45", 5, -1, "23.44", 5],
  ["23.49", 0, 1, "33.49", 0],
  ["23.49", 0, -1, "13.49", 0],
  ["23.49", 1, 1, "33.49", 1],
  ["23.49", 1, -1, "13.49", 1],
  ["23.49", 2, 1, "24.49", 2],
  ["23.49", 2, -1, "22.49", 2],
  ["23.49", 3, 1, "23.59", 3],
  ["23.49", 3, -1, "23.39", 3],
  ["23.49", 4, 1, "23.59", 4],
  ["23.49", 4, -1, "23.39", 4],
  ["23.49", 5, 1, "23.50", 5],
  ["23.49", 5, -1, "23.48", 5],
  ["23.50", 0, 1, "33.50", 0],
  ["23.50", 0, -1, "13.50", 0],
  ["23.50", 1, 1, "33.50", 1],
  ["23.50", 1, -1, "13.50", 1],
  ["23.50", 2, 1, "24.50", 2],
  ["23.50", 2, -1, "22.50", 2],
  ["23.50", 3, 1, "23.6", 3],
  ["23.50", 3, -1, "23.4", 3],
  ["23.50", 4, 1, "23.60", 4],
  ["23.50", 4, -1, "23.40", 4],
  ["23.50", 5, 1, "23.51", 5],
  ["23.50", 5, -1, "23.49", 5],
  ["23.9", 0, 1, "33.9", 0],
  ["23.9", 0, -1, "13.9", 0],
  ["23.9", 1, 1, "33.9", 1],
  ["23.9", 1, -1, "13.9", 1],
  ["23.9", 2, 1, "24.9", 2],
  ["23.9", 2, -1, "22.9", 2],
  ["23.9", 3, 1, "24", 0],
  ["23.9", 3, -1, "23.8", 3],
  ["23.9", 4, 1, "24.0", 4],
  ["23.9", 4, -1, "23.8", 4],
  ["9", 0, 1, "10", 0],
  ["9", 0, -1, "8", 0],
  ["9", 1, 1, "10", 2],
  ["9", 1, -1, "8", 1],
  ["0.05", 0, 1, "1.05", 0],
  ["0.05", 0, -1, "0.00", 0],
  ["0.05", 1, 1, "1.05", 1],
  ["0.05", 1, -1, "0.00", 1],
  ["0.05", 2, 1, "0.06", 2],
  ["0.05", 2, -1, "0.04", 2],
  ["0.05", 3, 1, "0.15", 3],
  ["0.05", 3, -1, "0.00", 3],
  ["0.05", 4, 1, "0.06", 4],
  ["0.05", 4, -1, "0.04", 4],
  ["-23.45", 0, 1, "+23.45", 0],
  ["-23.45", 0, -1, "+23.45", 0],
  ["-23.45", 1, 1, "-33.45", 1],
  ["-23.45", 1, -1, "-13.45", 1],
  ["-23.45", 2, 1, "-33.45", 2],
  ["-23.45", 2, -1, "-13.45", 2],
  ["-23.45", 3, 1, "-24.45", 3],
  ["-23.45", 3, -1, "-22.45", 3],
  ["-23.45", 4, 1, "-23.55", 4],
  ["-23.45", 4, -1, "-23.35", 4],
  ["-23.45", 5, 1, "-23.55", 5],
  ["-23.45", 5, -1, "-23.35", 5],
  ["-23.45", 6, 1, "-23.46", 6],
  ["-23.45", 6, -1, "-23.44", 6],
];

// 越界光标先夹到 [0, text.length]
const CARET_CLAMP: StepCase[] = [
  ["23.45", -10, 1, "33.45", 0],
  ["23.45", -10, -1, "13.45", 0],
  ["23.45", 100, 1, "23.46", 5],
  ["23.45", 100, -1, "23.44", 5],
];

/** 逐条比对表驱动用例；失败时把输入一起放进断言标签，便于定位分支。 */
function expectStepCases(cases: StepCase[]): void {
  for (const [text, caret, direction, outText, outCaret] of cases) {
    const label = `${JSON.stringify(text)} caret=${caret} dir=${direction}`;
    expect({ [label]: stepAtCaret(text, caret, direction) }).toEqual({
      [label]: { text: outText, caret: outCaret },
    });
  }
}

describe("stepAtCaret: 分支表（位权 × 输入 × 光标）", () => {
  test("guards：非数值文本原样返回", () => {
    expectStepCases(GUARDS);
  });

  test("toggle：case 5 符号切换", () => {
    expectStepCases(TOGGLE);
  });

  test("front：case 3 数字前面（含 un-carry 与进位到小数轮）", () => {
    expectStepCases(FRONT);
  });

  test("afterDot：case 4 小数点右侧（含补 0 与精度扩展）", () => {
    expectStepCases(AFTER_DOT);
  });

  test("digit：case 2 数字右侧", () => {
    expectStepCases(DIGIT);
  });

  test("caretClamp：越界光标", () => {
    expectStepCases(CARET_CLAMP);
  });
});

describe("toggleSign", () => {
  test("cycles between explicit signs, moving the caret with it", () => {
    expect(toggleSign("5", 0)).toEqual({ text: "-5", caret: 1 });
    expect(toggleSign("-5", 0)).toEqual({ text: "+5", caret: 0 });
    expect(toggleSign("-5", 1)).toEqual({ text: "+5", caret: 1 });
    expect(toggleSign("+5", 0)).toEqual({ text: "-5", caret: 0 });
  });

  test("can force a target sign", () => {
    expect(toggleSign("5", 0, "positive")).toEqual({ text: "5", caret: 0 });
    expect(toggleSign("-5", 1, "positive")).toEqual({ text: "+5", caret: 1 });
    expect(toggleSign("5", 0, "negative")).toEqual({ text: "-5", caret: 1 });
    expect(toggleSign("-5", 0, "negative")).toEqual({ text: "-5", caret: 0 });
  });

  test("ignores non-numeric text", () => {
    expect(toggleSign("abc", 0)).toEqual({ text: "abc", caret: 0 });
    expect(toggleSign("", 0)).toEqual({ text: "", caret: 0 });
  });
});

describe("addStepToValue", () => {
  test("adds a fixed amount in both directions and may cross zero", () => {
    expect(addStepToValue("23.45", 1, 0.01)).toEqual({ text: "23.46", caret: 5 });
    expect(addStepToValue("23.45", -1, 0.1)).toEqual({ text: "23.35", caret: 5 });
    expect(addStepToValue("0", -1, 1)).toEqual({ text: "-1", caret: 2 });
    expect(addStepToValue("9", 1, 1)).toEqual({ text: "10", caret: 2 });
  });

  test("keeps the caret at the end and ignores non-numeric text", () => {
    expect(addStepToValue("abc", 1, 1)).toEqual({ text: "abc", caret: 3 });
    expect(addStepToValue("", 1, 1)).toEqual({ text: "", caret: 0 });
  });
});

describe("significantPlace", () => {
  test("reads the leading digit place, snap-safe at powers of ten", () => {
    expect(significantPlace(1.12)).toBe(0);
    expect(significantPlace(0.12)).toBe(-1);
    expect(significantPlace(0.02)).toBe(-2);
    expect(significantPlace(100)).toBe(2);
    expect(significantPlace(0.001)).toBe(-3);
    expect(significantPlace(-42.5)).toBe(1);
    expect(significantPlace(0)).toBe(0);
  });
});

describe("stepByDigit", () => {
  test("the documented descent refines itself instead of hitting 0", () => {
    let value = "1.12";
    const seen: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      value = stepByDigit(value, -1).text;
      seen.push(value);
    }
    expect(seen).toEqual(["0.12", "0.02", "0.01", "0.009"]);
  });

  test("takes the power of ten down a place, up stays on the place", () => {
    expect(stepByDigit("100", -1).text).toBe("90");
    expect(stepByDigit("1", -1).text).toBe("0.9");
    expect(stepByDigit("0.001", -1).text).toBe("0.0009");
    expect(stepByDigit("9", 1).text).toBe("10");
    expect(stepByDigit("0.12", 1).text).toBe("0.22");
  });

  test("applies soft bounds and keeps an explicit plus", () => {
    expect(stepByDigit("5", 1, { lower: 0, upper: 5 }).text).toBe("5");
    // 起点在界外就完全不钳：填成 150 后还能自由走（与 scrubValue 同一套语义）。
    expect(stepByDigit("95", 1, { lower: 0, upper: 100 }).text).toBe("100");
    expect(stepByDigit("150", 1, { lower: 0, upper: 100 }).text).toBe("250");
    expect(stepByDigit("+5", 1).text).toBe("+6");
    expect(stepByDigit("abc", 1).value).toBeNaN();
  });
});

describe("stepByPrecision", () => {
  test("respects the digits the user typed, trailing zeros included", () => {
    let value = "0.499";
    const seen: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      value = stepByPrecision(value, 1).text;
      seen.push(value);
    }
    expect(seen).toEqual(["0.500", "0.501", "0.502"]);
    expect(stepByPrecision("5", 1).text).toBe("6");
    expect(stepByPrecision("5.0", 1).text).toBe("5.1");
    expect(stepByPrecision("5.0", -1).text).toBe("4.9");
  });
});

describe("stepRuleAt", () => {
  test("splits the bar into three thirds", () => {
    expect(stepRuleAt(0)).toBe("digit");
    expect(stepRuleAt(0.32)).toBe("digit");
    expect(stepRuleAt(1 / 3)).toBe("step");
    expect(stepRuleAt(0.5)).toBe("step");
    expect(stepRuleAt(2 / 3)).toBe("step");
    expect(stepRuleAt(0.67)).toBe("precision");
    expect(stepRuleAt(1)).toBe("precision");
    expect(stepRuleAt(Number.NaN)).toBe("step");
  });
});

describe("stepByRule", () => {
  test("dispatches, falling back to precision without a usable step", () => {
    expect(stepByRule("1.12", -1, "digit").text).toBe("0.12");
    expect(stepByRule("0.499", 1, "precision").text).toBe("0.500");
    expect(stepByRule("23.45", 1, "step", { step: 0.1 }).text).toBe("23.55");
    expect(stepByRule("23.45", 1, "step").text).toBe("23.46");
    expect(stepByRule("23.45", 1, "step", { step: Number.NaN }).text).toBe("23.46");
  });
});

describe("stepAmount / numericAttribute", () => {
  test("stepAmount defaults to the HTML 1 and rejects unusable values", () => {
    expect(stepAmount(undefined)).toBe(1);
    expect(stepAmount(null)).toBe(1);
    expect(stepAmount("")).toBe(1);
    expect(stepAmount(0.5)).toBe(0.5);
    expect(stepAmount("2")).toBe(2);
    expect(stepAmount("any")).toBeUndefined();
    expect(stepAmount(0)).toBeUndefined();
    expect(stepAmount(-1)).toBeUndefined();
  });

  test("numericAttribute reads optional min/max/step attributes", () => {
    expect(numericAttribute("2.5")).toBe(2.5);
    expect(numericAttribute(-3)).toBe(-3);
    expect(numericAttribute(null)).toBeUndefined();
    expect(numericAttribute(undefined)).toBeUndefined();
    expect(numericAttribute("")).toBeUndefined();
    expect(numericAttribute("any")).toBeUndefined();
  });
});
