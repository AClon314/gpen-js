/**
 * Toolbar/session state (`Gpen.toolbarState`, protocol field 10) — the bridge
 * between the UI's tool settings and the document.
 *
 * Why it lives in the document instead of the preferences KV: this is
 * *session/tool* state, and the protocol already models it (`ToolbarState`),
 * so it travels with the document the same way layer state does. Preferences
 * (`gpen.preferences`) hold what belongs to the user across documents; the
 * workspace KV holds panel layout. See `gpenPreferences.ts` for the table.
 *
 * `activeTool` has two homes and only one owner:
 *
 * - `GpenWorkspaceState.activeTool` (workspace KV) is the **UI truth** — it is
 *   what the tool rail highlights and what survives a reload;
 * - `ToolbarState.activeToolId` is the protocol mirror, written when the
 *   document is written.
 *
 * The mirror is deliberately one-way (`readToolbarState` never overwrites the
 * UI selection): loading a document must not yank the user's current tool
 * choice out from under them.
 */
import {
  BrushSizeUnit,
  BrushSettingsT,
  Color4T,
  EraserFlagsT,
  EraserMode,
  EraserSettingsT,
  GpencilBrushFlagsT,
  GpencilVertexMode,
  GpenT,
  LassoSettingsT,
  LassoSelectMode,
  PressureMappingT,
  ToolbarStateT,
} from "gpen-protocol/flatbuffers";

import type { GpenToolId } from "./gpenWorkspaceState.js";
import { DEFAULT_STROKE_OPACITY, DEFAULT_STROKE_RADIUS } from "../layers/strokeOps.js";

/** Brush diameter in CSS pixels. `BrushSettings.size` is a **diameter**. */
export const DEFAULT_BRUSH_SIZE = DEFAULT_STROKE_RADIUS * 2;
/** 默认笔刷强度。 */
export const DEFAULT_BRUSH_STRENGTH = 0.4;
/** 默认笔刷采样间距。 */
export const DEFAULT_BRUSH_SPACING = 0.25;
/** Eraser diameter; Blender's default eraser is noticeably larger than the brush. */
export const DEFAULT_ERASER_SIZE = 24;
/** 默认橡皮强度。 */
export const DEFAULT_ERASER_STRENGTH = 1;

/**
 * Default brush color as `Color4` (0..1 per channel), matching the light-theme
 * `--gpen-panel-accent` (`#4f46e5`). The canvas resolves the *live* token at
 * draw time; this is the value stored in the document.
 */
export const DEFAULT_BRUSH_COLOR = { r: 0x4f / 255, g: 0x46 / 255, b: 0xe5 / 255 };

/** Every tool the rail can select, mapped to the protocol's `idname` convention. */
export function toolIdName(tool: GpenToolId): string {
  return `builtin.${tool}`;
}

function createBrushSettings(): BrushSettingsT {
  return Object.assign(new BrushSettingsT(), {
    size: DEFAULT_BRUSH_SIZE,
    sizeUnit: BrushSizeUnit.BRUSH_SIZE_UNIT_CSS_PIXELS_UNSPECIFIED,
    color: Object.assign(new Color4T(), { ...DEFAULT_BRUSH_COLOR, a: 1 }),
    strength: DEFAULT_BRUSH_STRENGTH,
    pressureMapping: Object.assign(new PressureMappingT(), { radius: [], opacity: [] }),
    inputSamples: 1,
    spacing: DEFAULT_BRUSH_SPACING,
    smoothStrokeFactor: 0,
    sizeMin: 1,
    sizeMax: 256,
    presetId: "",
    drawSmoothFactor: 0,
    drawSmoothLevels: 0,
    drawSubdivide: 0,
    jitter: 0,
    drawAngle: 0,
    drawAngleFactor: 0,
    hardness: 0,
    aspectRatio: null,
    uvRandom: 0,
    capsType: 0,
    curveType: 0,
    simplifyPx: 0,
    vertexMode: GpencilVertexMode.GPENCIL_VERTEX_MODE_UNSPECIFIED,
    flags: Object.assign(new GpencilBrushFlagsT(), {
      usePressure: false,
      useStrengthPressure: false,
      useJitterPressure: false,
      stabilizeMouse: false,
      groupSettings: false,
      groupRandom: false,
      materialPinned: false,
      trimStroke: false,
      outlineStroke: false,
      useStroke: false,
      useFill: false,
    }),
    drawStrength: DEFAULT_STROKE_OPACITY,
  });
}

/**
 * Default eraser settings.
 *
 * `mode` is the single source of truth. `target` is deprecated (protocol
 * `EraserTarget`, see `../gpen-protocol/protocol/v1/brush.tsp`) but is still
 * written for readers that predate the deprecation: `HARD` derives
 * `ERASER_TARGET_POINT`. **No code branches on `target`.**
 */
function createEraserSettings(): EraserSettingsT {
  return Object.assign(new EraserSettingsT(), {
    size: DEFAULT_ERASER_SIZE,
    sizeUnit: BrushSizeUnit.BRUSH_SIZE_UNIT_CSS_PIXELS_UNSPECIFIED,
    strength: DEFAULT_ERASER_STRENGTH,
    mode: EraserMode.ERASER_MODE_HARD,
    target: 1, // ERASER_TARGET_POINT, derived from mode = HARD
    strengthFactor: 1,
    thicknessFactor: 1,
    flags: Object.assign(new EraserFlagsT(), {
      occlude: false,
      keepCaps: false,
      activeLayerOnly: true,
    }),
  });
}

/** 一份全新的协议工具栏状态（画笔 / 橡皮 / 套索默认值）。 */
export function defaultToolbarState(): ToolbarStateT {
  return Object.assign(new ToolbarStateT(), {
    tools: [],
    activeToolId: toolIdName("brush"),
    brush: createBrushSettings(),
    eraser: createEraserSettings(),
    lasso: Object.assign(new LassoSettingsT(), {
      enabled: false,
      mode: LassoSelectMode.LASSO_SELECT_MODE_SET_UNSPECIFIED,
    }),
    keymaps: [],
    workspaceStates: [],
    activeWorkspaceName: "",
    recentBrushPresetIds: [],
  });
}

/** The toolbar state of a document, or `undefined` when it has none yet. */
export function readToolbarState(document: GpenT): ToolbarStateT | undefined {
  return document.toolbarState ?? undefined;
}

/** The toolbar state of a document, creating the default when absent. */
export function ensureToolbarState(document: GpenT): ToolbarStateT {
  return document.toolbarState ?? defaultToolbarState();
}

/** Replace the toolbar state (immutably). */
export function writeToolbarState(document: GpenT, state: ToolbarStateT): GpenT {
  return Object.assign(new GpenT(), document, { toolbarState: state });
}

/** Patch the brush settings, keeping every other field of the state. */
export function writeBrushSettings(document: GpenT, patch: Partial<BrushSettingsT>): GpenT {
  const state = ensureToolbarState(document);
  const brush = Object.assign(new BrushSettingsT(), state.brush ?? createBrushSettings(), patch);
  return writeToolbarState(document, Object.assign(new ToolbarStateT(), state, { brush }));
}

/** Patch the eraser settings, keeping every other field of the state. */
export function writeEraserSettings(document: GpenT, patch: Partial<EraserSettingsT>): GpenT {
  const state = ensureToolbarState(document);
  const eraser = Object.assign(
    new EraserSettingsT(),
    state.eraser ?? createEraserSettings(),
    patch,
  );
  return writeToolbarState(document, Object.assign(new ToolbarStateT(), state, { eraser }));
}

/**
 * Brush radius in layer-local units.
 *
 * `BrushSettings.size` is a **diameter** and `Point.radius` is a **radius**;
 * this is the one place that conversion happens, so callers cannot get it
 * wrong by accident.
 */
export function brushRadiusOf(brush: BrushSettingsT | undefined): number {
  const diameter = brush?.size;
  if (typeof diameter !== "number" || !Number.isFinite(diameter) || diameter <= 0) {
    return DEFAULT_STROKE_RADIUS;
  }
  return diameter / 2;
}

/** Eraser radius in layer-local units (same diameter → radius conversion). */
export function eraserRadiusOf(eraser: EraserSettingsT | undefined): number {
  const diameter = eraser?.size;
  if (typeof diameter !== "number" || !Number.isFinite(diameter) || diameter <= 0) {
    return DEFAULT_ERASER_SIZE / 2;
  }
  return diameter / 2;
}

/** Clamp a `Color4`-shaped value into the protocol's 0..1 range. */
export function normalizeColor(color: { r: number; g: number; b: number }): {
  r: number;
  g: number;
  b: number;
} {
  const clamp = (value: number): number =>
    Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return { r: clamp(color.r), g: clamp(color.g), b: clamp(color.b) };
}

/** `Color4` (0..1) → `#rrggbb` (the form the color picker and CSS use). */
export function color4ToHex(color: { r: number; g: number; b: number } | undefined): string {
  const { r, g, b } = normalizeColor(color ?? DEFAULT_BRUSH_COLOR);
  const channel = (value: number): string =>
    Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * `#rrggbb` / `#rgb` / `rgb(...)` → `Color4` components in 0..1.
 *
 * Returns `undefined` for anything else so a caller can keep its previous
 * value instead of writing black. Kept here (not in the picker component)
 * because both the settings panel and the toolbar need the same conversion and
 * it is pure enough to unit test.
 */
export function hexToColor4(value: unknown): { r: number; g: number; b: number } | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  let hex: string | undefined;
  if (/^#[0-9a-f]{6}$/.test(text)) hex = text.slice(1);
  else if (/^#[0-9a-f]{3}$/.test(text)) {
    hex = `${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  } else {
    const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(text);
    if (rgb === null) return undefined;
    hex = rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("");
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  };
}

/** `Color4` (0..1) → a CSS `rgba()` string the canvas can use directly. */
export function color4ToCss(color: { r: number; g: number; b: number } | undefined): string {
  const { r, g, b } = normalizeColor(color ?? DEFAULT_BRUSH_COLOR);
  const channel = (value: number): number => Math.round(value * 255);
  return `rgb(${channel(r)} ${channel(g)} ${channel(b)})`;
}
