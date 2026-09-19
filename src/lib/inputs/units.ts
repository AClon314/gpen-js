/**
 * Units of measure, DOM/Svelte-free: a two-layer registry, a cached lookup
 * index, and the convert / parse / format helpers on top of it.
 *
 * - **registry** (`Registry`): `dimension name → dimension table`, e.g.
 *   `{ length: …, mass: … }`;
 * - **dimension table** (`Dimension`): `{ base, units, alias? }`, where `units`
 *   is `unit id → factor` for linear units and `unit id → { toBase, fromBase }`
 *   for anything a single factor cannot express (temperature).
 *
 * Direction is pinned: `1 unit = factor base units` (`cm: 0.01`, `m: 1`). The
 * base unit must itself be listed in `units` with the value `1`, so "which unit
 * is the base" is readable from the table alone.
 *
 * Aliases are per dimension (`alias`), never one global table: `oz` is an ounce
 * of mass but could be a fluid ounce of volume, so an alias without its
 * dimension is ambiguous. Unit ids are ASCII (`m`, `cm`, `ft`, `K`, `C`) and
 * are matched case-insensitively after full-width → half-width normalization.
 *
 * Lookups never rebuild per call: the first `findUnit` on a registry builds a
 * `Map` once and caches it in a module-level `WeakMap` keyed by the registry
 * object. That makes `Registry` effectively immutable — build one, then only
 * read from it (keep a second object if you need a variant).
 *
 * Details/tables: `docs/units.md`.
 */

/**
 * A non-linear unit, given as a pair of inverse transforms:
 * `toBase(1 unit) = base value`, `fromBase` its exact inverse (temperature).
 */
export type UnitConverter = {
  toBase: (value: number) => number;
  fromBase: (value: number) => number;
};

/** `1 unit = factor base units` (linear), or an explicit converter pair. */
export type UnitFactor = number | UnitConverter;

/** One dimension table (`length`, `mass`, `temperature`, …). */
export interface Dimension {
  /** Base unit id; it must also be present in `units` with the value `1`. */
  base: string;
  /** Unit id → conversion. Ids are ASCII (`m` / `cm` / `ft` / `kg` / `K` / `C`). */
  units: Record<string, UnitFactor>;
  /** Alias → unit id (paste / display); keep locale aliases (`厘米`) per dimension. */
  alias?: Record<string, string>;
}

/** `dimension name → dimension table` (the key is a dimension, not a unit id). */
export type Registry = Record<string, Dimension>;

/**
 * What callers may hand to `findUnit` / `parseQuantity`: either a whole registry
 * or a single dimension table (`STD_UNITS` vs `STD_UNITS.length`). A bare table
 * carries no dimension name, so it is wrapped under its own `base` id (the name
 * is then only an opaque tag used for equality checks — never displayed).
 */
export type UnitSource = Registry | Dimension;

/** A unit found in a registry, with its dimension and base unit attached. */
export interface ResolvedUnit {
  /** Dimension name (`length`). */
  dimension: string;
  /** Base unit id of that dimension (`m`). */
  base: string;
  /** Canonical unit id as declared in the table (`cm`), never the alias. */
  id: string;
  /** Value in this unit → value in its base unit. */
  toBase: (value: number) => number;
  /** Value in the base unit → value in this unit. */
  fromBase: (value: number) => number;
}

/**
 * Compatibility normalization (NFKC) so pasted text matches: full-width forms
 * become ASCII (`１２ｃｍ` → `12cm`), the CJK unit characters become their
 * letter form (`㎝` → `cm`, `℃` → `°C`), ideographic space becomes a plain
 * space. Trimming / lower-casing stay in `normalizeUnitKey` / `parseQuantity`.
 */
function normalizeText(text: string): string {
  return text.normalize("NFKC");
}

/**
 * Lookup key for a unit id / alias: NFKC-normalized, trimmed, lower-cased.
 * Exported so callers can compare a raw `activeUnit` prop with a
 * `ResolvedUnit.id`.
 */
export function normalizeUnitKey(text: string): string {
  return normalizeText(text).trim().toLowerCase();
}

/** `Map` index of a registry: normalized unit id / alias → resolved unit. */
const INDEX_CACHE = new WeakMap<Registry, Map<string, ResolvedUnit>>();

/** Wrappers for bare dimension tables, cached so the index cache stays warm. */
const REGISTRY_CACHE = new WeakMap<Dimension, Registry>();

/** Is this a single dimension table rather than a registry of dimensions? */
export function isDimensionTable(source: UnitSource): source is Dimension {
  const table = source as Dimension;
  return typeof table.base === "string" && typeof table.units === "object" && table.units !== null;
}

/**
 * Normalize a `UnitSource` into a registry. A bare dimension table is wrapped
 * (and the wrapper cached) so repeated `findUnit` calls reuse the same index
 * instead of rebuilding it for a fresh object every time.
 */
export function toRegistry(source: UnitSource): Registry {
  if (!isDimensionTable(source)) return source;
  let registry = REGISTRY_CACHE.get(source);
  if (registry === undefined) {
    registry = { [source.base]: source };
    REGISTRY_CACHE.set(source, registry);
  }
  return registry;
}

function resolveUnit(
  dimension: string,
  table: Dimension,
  id: string,
  factor: UnitFactor,
): ResolvedUnit {
  if (typeof factor === "number") {
    return {
      dimension,
      base: table.base,
      id,
      toBase: (value) => value * factor,
      fromBase: (value) => value / factor,
    };
  }
  return { dimension, base: table.base, id, toBase: factor.toBase, fromBase: factor.fromBase };
}

/** Build the lookup index in one pass over unit ids, then one over aliases. */
function buildIndex(registry: Registry): Map<string, ResolvedUnit> {
  const index = new Map<string, ResolvedUnit>();
  for (const [dimension, table] of Object.entries(registry)) {
    for (const [id, factor] of Object.entries(table.units ?? {})) {
      const key = normalizeUnitKey(id);
      if (key === "" || index.has(key)) continue;
      index.set(key, resolveUnit(dimension, table, id, factor));
    }
  }
  // Aliases second: a declared unit id always wins over an alias of the same
  // spelling, and an alias is dropped when its target is missing.
  for (const [dimension, table] of Object.entries(registry)) {
    for (const [alias, id] of Object.entries(table.alias ?? {})) {
      const key = normalizeUnitKey(alias);
      if (key === "" || index.has(key)) continue;
      const target = index.get(normalizeUnitKey(id));
      if (target === undefined || target.dimension !== dimension) continue;
      index.set(key, target);
    }
  }
  return index;
}

/**
 * Find a unit by id or alias (case-insensitive, full-width tolerant). Returns
 * `undefined` for unknown text — including `constructor` / `toString` /
 * `__proto__` pasted from a page: the index is a `Map`, so prototype members
 * can never be hit.
 */
export function findUnit(registry: UnitSource, unitIdOrAlias: string): ResolvedUnit | undefined {
  const key = normalizeUnitKey(unitIdOrAlias);
  if (key === "") return undefined;
  const normalized = toRegistry(registry);
  let index = INDEX_CACHE.get(normalized);
  if (index === undefined) {
    index = buildIndex(normalized);
    INDEX_CACHE.set(normalized, index);
  }
  return index.get(key);
}

/**
 * Convert `value` between two units of the **same dimension**; `undefined` when
 * they differ, when a side is missing, or when `value` is not finite (callers
 * must never receive `NaN` — see `docs/input.md`).
 */
export function convertValue(
  value: number,
  from: ResolvedUnit | undefined,
  to: ResolvedUnit | undefined,
): number | undefined {
  if (from === undefined || to === undefined) return undefined;
  if (from.dimension !== to.dimension) return undefined;
  if (!Number.isFinite(value)) return undefined;
  const converted = to.fromBase(from.toBase(value));
  return Number.isFinite(converted) ? converted : undefined;
}

/** `12`, `12cm`, `1e3 m`, `-40 c`, `１２ｃｍ` — a number plus an optional unit. */
const QUANTITY_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(\S*)$/;

/**
 * Parse user input / pasted text into a number and a unit: `'12 cm'`,
 * `'12cm'`, `'12 厘米'`, `'1e3 m'`, `'  12 CM '`, `'１２ｃｍ'`. The text is
 * normalized (NFKC, trimmed, lower-cased) first; the space between the
 * number and the unit may be present or absent.
 *
 * `undefined` when the text is not exactly one number + one known unit —
 * including a bare number (`'12'`), two numbers (`'12 3 m'`), an unknown unit
 * (`'12 xyz'`), or a dimension that does not match `expectDimension` (a paste
 * of `'12 cm'` into a mass field). Callers decide what a rejected paste means
 * (usually: keep the raw text and let `:invalid` do its job).
 */
export function parseQuantity(
  text: string,
  registry: UnitSource,
  options: { expectDimension?: string } = {},
): { value: number; unit: ResolvedUnit } | undefined {
  const normalized = normalizeUnitKey(text);
  const match = QUANTITY_PATTERN.exec(normalized);
  if (match === null) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return undefined;
  const unitText = match[2] ?? "";
  if (unitText === "") return undefined;
  const unit = findUnit(registry, unitText);
  if (unit === undefined) return undefined;
  if (options.expectDimension !== undefined && unit.dimension !== options.expectDimension) {
    return undefined;
  }
  return { value, unit };
}

/** Display precision for a value with no explicit `decimals` (float noise). */
const DISPLAY_PRECISION = 12;

function formatNumber(value: number, decimals: number | undefined): string {
  let rounded: number;
  if (decimals === undefined || !Number.isFinite(decimals)) {
    rounded = Number(value.toPrecision(DISPLAY_PRECISION));
  } else {
    const width = Math.min(100, Math.max(0, Math.trunc(decimals)));
    rounded = Number(value.toFixed(width));
  }
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Format a value for display: `'12 cm'`, `'0.12 cm'` (float noise rounded off),
 * `'0.3333 m'` with `decimals = 4`. `value` is already in `unit` — this does not
 * convert (use `convertValue` first). `decimals` is a **maximum** width, not a
 * fixed one: trailing zeros are dropped (`formatQuantity(2.5, m, 2)` → `'2.5 m'`).
 */
export function formatQuantity(value: number, unit: ResolvedUnit, decimals?: number): string {
  if (!Number.isFinite(value)) return `${String(value)} ${unit.id}`;
  return `${formatNumber(value, decimals)} ${unit.id}`;
}

/**
 * A display unit plus everything a numeric input needs around it: the two
 * display ↔ base conversions and "parse a typed quantity into this unit".
 *
 * Keeping this here (rather than in the component) means the same behavior is
 * unit-tested without a DOM, and the next widget that needs units
 * (e.g. a CodeMirror extension) does not re-derive it.
 */
export interface UnitBinding {
  /** The display unit; `value` in the input is stored in this unit's base. */
  unit: ResolvedUnit;
  /** What the input renders next to the value (`kg` / `cm`). */
  label: string;
  /** Display value → base value. */
  toBase: (display: number) => number;
  /** Base value → display value. */
  toDisplay: (base: number) => number;
  /**
   * `'1234克'` / `'  1234 克 '` → the same quantity in `unit` (`1234 g → 1.234 kg`).
   * `undefined` for anything that is not exactly one number + one known unit of
   * the same dimension — the caller keeps the raw text and lets `:invalid` fire.
   */
  parse: (text: string) => number | undefined;
}

/**
 * Significant digits kept after a conversion (`12 in → 30.48 cm`, not
 * `30.479999999999997 cm`). Rounding lives here so every caller of `parse` gets
 * a display-ready number without repeating `toPrecision`.
 */
const CONVERTED_PRECISION = 12;

/**
 * Resolve the display unit of `source` and bundle the conversions around it.
 *
 * `activeUnit` defaults to the dimension table's own `base`, so a bare
 * `units={STD_UNITS.mass}` means "show kg". Returns `undefined` when no display
 * unit can be determined (a whole registry without `activeUnit`), which callers
 * treat as "no units": every conversion is the identity.
 */
export function bindUnit(source: UnitSource, activeUnit?: string): UnitBinding | undefined {
  const unit =
    activeUnit === undefined
      ? isDimensionTable(source)
        ? findUnit(source, source.base)
        : undefined
      : findUnit(source, activeUnit);
  if (unit === undefined) return undefined;
  return {
    unit,
    label: unit.id,
    toBase: unit.toBase,
    toDisplay: unit.fromBase,
    parse: (text: string): number | undefined => {
      const parsed = parseQuantity(text, source, { expectDimension: unit.dimension });
      if (parsed === undefined) return undefined;
      const converted = convertValue(parsed.value, parsed.unit, unit);
      return converted === undefined
        ? undefined
        : Number(converted.toPrecision(CONVERTED_PRECISION));
    },
  };
}

/** The registry the components use by default (length / mass / temperature). */
export const STD_UNITS: Registry = {
  length: {
    base: "m",
    units: {
      m: 1,
      cm: 0.01,
      mm: 0.001,
      km: 1000,
      in: 0.0254,
      ft: 0.3048,
      yd: 0.9144,
      mi: 1609.344,
      nmi: 1852,
    },
    alias: {
      米: "m",
      厘米: "cm",
      毫米: "mm",
      千米: "km",
      公里: "km",
      英寸: "in",
      英尺: "ft",
      码: "yd",
      英里: "mi",
      海里: "nmi",
    },
  },
  mass: {
    base: "kg",
    units: {
      kg: 1,
      g: 0.001,
      mg: 0.000001,
      t: 1000,
      lb: 0.45359237,
      oz: 0.028349523125,
    },
    alias: {
      千克: "kg",
      公斤: "kg",
      克: "g",
      毫克: "mg",
      吨: "t",
      磅: "lb",
      盎司: "oz",
      lbs: "lb",
    },
  },
  temperature: {
    base: "K",
    units: {
      K: 1,
      C: {
        toBase: (celsius) => celsius + 273.15,
        fromBase: (kelvin) => kelvin - 273.15,
      },
      F: {
        toBase: (fahrenheit) => ((fahrenheit - 32) * 5) / 9 + 273.15,
        fromBase: (kelvin) => ((kelvin - 273.15) * 9) / 5 + 32,
      },
    },
    alias: {
      开尔文: "K",
      摄氏度: "C",
      摄氏: "C",
      华氏度: "F",
      华氏: "F",
      "°c": "C",
      "°f": "F",
    },
  },
};
