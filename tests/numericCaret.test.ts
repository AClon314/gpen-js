import { describe, expect, test } from "bun:test";

import {
  addStepToValue,
  clampAndRound,
  decimalPlaces,
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
