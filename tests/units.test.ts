import { describe, expect, test } from "bun:test";

import {
  STD_UNITS,
  bindUnit,
  convertValue,
  findUnit,
  formatQuantity,
  isDimensionTable,
  normalizeUnitKey,
  parseQuantity,
  toRegistry,
} from "../src/lib/inputs/units.ts";

/** A resolved unit from `STD_UNITS`, or a loud failure (no `!` in tests). */
function unit(id: string): NonNullable<ReturnType<typeof findUnit>> {
  const resolved = findUnit(STD_UNITS, id);
  if (resolved === undefined) throw new Error(`STD_UNITS is missing the unit ${id}`);
  return resolved;
}

const m = unit("m");
const cm = unit("cm");
const ft = unit("ft");
const kg = unit("kg");
const g = unit("g");
const lb = unit("lb");
const oz = unit("oz");
const kelvin = unit("K");
const celsius = unit("C");
const fahrenheit = unit("F");

describe("findUnit", () => {
  test("resolves unit ids case-insensitively and keeps the canonical id", () => {
    expect(findUnit(STD_UNITS, "cm")).toBe(cm);
    expect(findUnit(STD_UNITS, " CM ")?.id).toBe("cm");
    expect(findUnit(STD_UNITS, "K")?.id).toBe("K");
    expect(findUnit(STD_UNITS, "k")?.id).toBe("K");
    expect(findUnit(STD_UNITS, "k")?.dimension).toBe("temperature");
  });

  test("resolves per-dimension aliases to the canonical unit", () => {
    expect(findUnit(STD_UNITS, "厘米")?.id).toBe("cm");
    expect(findUnit(STD_UNITS, "公里")).toBe(findUnit(STD_UNITS, "km"));
    expect(findUnit(STD_UNITS, "磅")?.id).toBe("lb");
    expect(findUnit(STD_UNITS, "盎司")?.id).toBe("oz");
    expect(findUnit(STD_UNITS, "°C")?.id).toBe("C");
    expect(findUnit(STD_UNITS, "华氏度")?.id).toBe("F");
    expect(findUnit(STD_UNITS, "摄氏度")).toBe(celsius);
  });

  test("ounces are not pounds", () => {
    expect(oz.id).toBe("oz");
    expect(lb.id).toBe("lb");
    expect(oz.toBase(1)).toBeCloseTo(0.028349523125, 12);
    expect(lb.toBase(1)).toBeCloseTo(0.45359237, 12);
    expect(oz.toBase(1) * 16).toBeCloseTo(lb.toBase(1), 12);
  });

  test("unknown / empty text resolves to undefined", () => {
    expect(findUnit(STD_UNITS, "xyz")).toBeUndefined();
    expect(findUnit(STD_UNITS, "")).toBeUndefined();
    expect(findUnit(STD_UNITS, "   ")).toBeUndefined();
    expect(findUnit(STD_UNITS, "12")).toBeUndefined();
  });

  test("prototype members never resolve", () => {
    for (const key of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "prototype",
    ]) {
      expect(findUnit(STD_UNITS, key)).toBeUndefined();
    }
  });

  test("the index is built once per registry (shared resolved units)", () => {
    // Same object on every hit, alias included — nothing is rebuilt per call.
    expect(findUnit(STD_UNITS, "cm")).toBe(findUnit(STD_UNITS, "cm"));
    expect(findUnit(STD_UNITS, "厘米")).toBe(findUnit(STD_UNITS, "cm"));
    expect(findUnit(STD_UNITS, "mi")?.toBase).toBe(findUnit(STD_UNITS, "MI")?.toBase);
  });

  test("normalizeUnitKey is exposed for callers", () => {
    expect(normalizeUnitKey("　ＣＭ ")).toBe("cm");
    expect(normalizeUnitKey("厘米")).toBe("厘米");
  });
});

describe("convertValue", () => {
  test("converts linearly, both directions", () => {
    expect(convertValue(1, m, cm)).toBe(100);
    expect(convertValue(100, cm, m)).toBe(1);
    expect(convertValue(30.48, cm, ft)).toBeCloseTo(1, 12);
    expect(convertValue(1, ft, cm)).toBeCloseTo(30.48, 12);
    expect(convertValue(1, m, ft)).toBeCloseTo(3.280839895013123, 12);
    expect(convertValue(1, m, m)).toBe(1);
  });

  test("converts mass units, both directions", () => {
    expect(convertValue(1, kg, g)).toBe(1000);
    expect(convertValue(2500, g, kg)).toBe(2.5);
    expect(convertValue(1, lb, g)).toBeCloseTo(453.59237, 9);
    expect(convertValue(1, lb, oz)).toBeCloseTo(16, 12);
    expect(convertValue(16, oz, lb)).toBeCloseTo(1, 12);
  });

  test("round trips converge instead of accumulating float noise", () => {
    expect(convertValue(convertValue(0.1, m, cm) ?? Number.NaN, cm, m)).toBeCloseTo(0.1, 12);
    expect(convertValue(convertValue(12.3, kg, lb) ?? Number.NaN, lb, kg)).toBeCloseTo(12.3, 12);
    expect(convertValue(convertValue(1, m, ft) ?? Number.NaN, ft, m)).toBeCloseTo(1, 15);
  });

  test("temperature uses the converter pairs", () => {
    expect(convertValue(0, celsius, kelvin)).toBe(273.15);
    expect(convertValue(273.15, kelvin, celsius)).toBe(0);
    expect(convertValue(100, celsius, fahrenheit)).toBeCloseTo(212, 12);
    expect(convertValue(32, fahrenheit, celsius)).toBeCloseTo(0, 12);
    expect(convertValue(-40, celsius, fahrenheit)).toBeCloseTo(-40, 12);
    expect(convertValue(37.5, celsius, kelvin)).toBeCloseTo(310.65, 12);
    const back = convertValue(convertValue(37.5, celsius, kelvin) ?? Number.NaN, kelvin, celsius);
    expect(back).toBeCloseTo(37.5, 12);
    const roundTrip = convertValue(
      convertValue(98.6, fahrenheit, kelvin) ?? Number.NaN,
      kelvin,
      fahrenheit,
    );
    expect(roundTrip).toBeCloseTo(98.6, 10);
  });

  test("cross-dimension / unknown sides / non-finite values give undefined", () => {
    expect(convertValue(1, m, kg)).toBeUndefined();
    expect(convertValue(1, m, kelvin)).toBeUndefined();
    expect(convertValue(1, undefined, cm)).toBeUndefined();
    expect(convertValue(1, m, undefined)).toBeUndefined();
    expect(convertValue(Number.NaN, m, cm)).toBeUndefined();
    expect(convertValue(Number.POSITIVE_INFINITY, m, cm)).toBeUndefined();
  });
});

describe("parseQuantity", () => {
  test("parses a number and a unit with any spacing", () => {
    expect(parseQuantity("12 cm", STD_UNITS)).toEqual({ value: 12, unit: cm });
    expect(parseQuantity("12cm", STD_UNITS)).toEqual({ value: 12, unit: cm });
    expect(parseQuantity("  12 CM ", STD_UNITS)).toEqual({ value: 12, unit: cm });
    expect(parseQuantity("12 厘米", STD_UNITS)).toEqual({ value: 12, unit: cm });
    expect(parseQuantity("12　厘米", STD_UNITS)).toEqual({ value: 12, unit: cm });
    expect(parseQuantity("1e3 m", STD_UNITS)).toEqual({ value: 1000, unit: m });
    expect(parseQuantity("1E3m", STD_UNITS)).toEqual({ value: 1000, unit: m });
    expect(parseQuantity("-40 摄氏度", STD_UNITS)).toEqual({ value: -40, unit: celsius });
    expect(parseQuantity(".5 in", STD_UNITS)?.value).toBe(0.5);
    expect(parseQuantity("+2 kg", STD_UNITS)?.value).toBe(2);
  });

  test("accepts full-width digits, signs and CJK unit characters", () => {
    expect(parseQuantity("１２ｃｍ", STD_UNITS)).toEqual({ value: 12, unit: cm });
    expect(parseQuantity("１２．５CM", STD_UNITS)).toEqual({ value: 12.5, unit: cm });
    expect(parseQuantity("－４０℃", STD_UNITS)).toEqual({ value: -40, unit: celsius });
    expect(parseQuantity("５ ㎝", STD_UNITS)).toEqual({ value: 5, unit: cm });
    expect(parseQuantity("２㎏", STD_UNITS)).toEqual({ value: 2, unit: kg });
    expect(parseQuantity("212℉", STD_UNITS)).toEqual({ value: 212, unit: fahrenheit });
  });

  test("keeps the dimension and base of the parsed unit", () => {
    const ozQuantity = parseQuantity("8 oz", STD_UNITS);
    expect(ozQuantity?.unit.dimension).toBe("mass");
    expect(ozQuantity?.unit.base).toBe("kg");
    expect(ozQuantity?.unit.id).toBe("oz");
  });

  test("rejects unknown units, bare numbers and malformed text", () => {
    for (const text of [
      "",
      "   ",
      "abc",
      "12",
      "12 xyz",
      "12 3 m",
      "12 m 3",
      "12.5.3 m",
      "12 c m",
      "m",
      "1e m",
      "cm 12",
      "12+3 cm",
      "1/2 in",
    ]) {
      expect(parseQuantity(text, STD_UNITS)).toBeUndefined();
    }
  });

  test("rejects prototype-key 'units'", () => {
    for (const text of ["12 constructor", "12 toString", "12 __proto__", "12 hasOwnProperty"]) {
      expect(parseQuantity(text, STD_UNITS)).toBeUndefined();
    }
  });

  test("expectDimension gates the paste", () => {
    expect(parseQuantity("12 cm", STD_UNITS, { expectDimension: "length" })).toEqual({
      value: 12,
      unit: cm,
    });
    expect(parseQuantity("12 cm", STD_UNITS, { expectDimension: "mass" })).toBeUndefined();
    expect(parseQuantity("12 kg", STD_UNITS, { expectDimension: "mass" })).toEqual({
      value: 12,
      unit: kg,
    });
    expect(parseQuantity("12 厘米", STD_UNITS, {})).toEqual({ value: 12, unit: cm });
  });
});

describe("formatQuantity", () => {
  test("rounds float noise off by default", () => {
    expect(formatQuantity(12, cm)).toBe("12 cm");
    expect(formatQuantity(0.1 + 0.2, m)).toBe("0.3 m");
    expect(formatQuantity(0.12000000000000001, cm)).toBe("0.12 cm");
    expect(formatQuantity(1 / 3, m)).toBe("0.333333333333 m");
    expect(formatQuantity(-0, m)).toBe("0 m");
    expect(formatQuantity(310.65, kelvin)).toBe("310.65 K");
  });

  test("decimals is a maximum width, not a fixed one", () => {
    expect(formatQuantity(1 / 3, m, 4)).toBe("0.3333 m");
    expect(formatQuantity(2.678, m, 2)).toBe("2.68 m");
    expect(formatQuantity(2.5, m, 2)).toBe("2.5 m");
    expect(formatQuantity(12, m, 3)).toBe("12 m");
    expect(formatQuantity(12, m, -1)).toBe("12 m");
  });

  test("survives a non-finite value instead of throwing", () => {
    expect(formatQuantity(Number.NaN, m)).toBe("NaN m");
  });
});

describe("dimension tables as a UnitSource", () => {
  test("a bare dimension table is accepted directly", () => {
    expect(findUnit(STD_UNITS.length, "cm")?.id).toBe("cm");
    expect(findUnit(STD_UNITS.mass, "盎司")?.id).toBe("oz");
    expect(findUnit(STD_UNITS.length, "kg")).toBeUndefined();
  });

  test("wrapping is cached, so the index is not rebuilt per call", () => {
    expect(findUnit(STD_UNITS.length, "cm")).toBe(findUnit(STD_UNITS.length, "厘米"));
    expect(toRegistry(STD_UNITS.length)).toBe(toRegistry(STD_UNITS.length));
  });

  test("a registry passes through untouched", () => {
    expect(toRegistry(STD_UNITS)).toBe(STD_UNITS);
    expect(isDimensionTable(STD_UNITS)).toBe(false);
    expect(isDimensionTable(STD_UNITS.length)).toBe(true);
  });

  test("parseQuantity accepts a dimension table and still rejects cross-dimension", () => {
    expect(parseQuantity("12 厘米", STD_UNITS.length)?.value).toBe(12);
    expect(parseQuantity("12 cm", STD_UNITS.mass, { expectDimension: "kg" })).toBeUndefined();
  });
});

describe("bindUnit", () => {
  test("a bare dimension table defaults the display unit to its base", () => {
    // mass 的 base 就是 kg → 显示单位与基准单位重合，换算是恒等
    const mass = bindUnit(STD_UNITS.mass);
    expect(mass?.label).toBe("kg");
    expect(mass?.toBase(1.234)).toBe(1.234);
    // 显示单位不是 base 时（cm vs m）才真的换算
    const cm = bindUnit(STD_UNITS.length, "cm");
    expect(cm?.toBase(12)).toBeCloseTo(0.12, 12);
    expect(cm?.toDisplay(0.12)).toBeCloseTo(12, 12);
  });

  test("activeUnit overrides the default and a whole registry needs it", () => {
    expect(bindUnit(STD_UNITS, "cm")?.label).toBe("cm");
    expect(bindUnit(STD_UNITS)).toBeUndefined();
    expect(bindUnit(STD_UNITS, "nope")).toBeUndefined();
  });

  test("parse trims, splits and converts into the display unit", () => {
    const mass = bindUnit(STD_UNITS.mass);
    expect(mass?.parse(" 1234克 ")).toBeCloseTo(1.234, 12);
    expect(mass?.parse("1234 克")).toBeCloseTo(1.234, 12);
    expect(mass?.parse("1 lb")).toBeCloseTo(0.45359237, 12);
    // 跨量纲 / 未知单位 / 裸数字 / 多个数字 → undefined（调用方保留原文交给 :invalid）
    expect(mass?.parse("12 cm")).toBeUndefined();
    expect(mass?.parse("12 xyz")).toBeUndefined();
    expect(mass?.parse("12")).toBeUndefined();
    expect(mass?.parse("12 3 kg")).toBeUndefined();
  });

  test("parse cleans up the float noise of a conversion", () => {
    const cm = bindUnit(STD_UNITS.length, "cm");
    expect(cm?.parse("12 in")).toBe(30.48);
    expect(cm?.parse("3 ft")).toBe(91.44);
  });
});
