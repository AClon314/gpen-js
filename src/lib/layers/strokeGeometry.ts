/**
 * Stroke geometry: distance / hit testing and the circle-cut that backs the
 * HARD eraser.
 *
 * All functions are pure and operate on layer-local coordinates. The module
 * knows nothing about documents or protocol containers, so the geometry can be
 * unit tested (and reasoned about) in isolation; the write path lives in
 * `strokeEdit.ts`.
 */
import { PointT } from "gpen-protocol/flatbuffers";
import type { StrokeT } from "gpen-protocol/flatbuffers";
import type { LayerPoint } from "./layerView";

/** Squared distance from `(px, py)` to the segment `a -> b` (no square root). */
function distanceToSegmentSquared(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    // Degenerate (zero-length) segment: fall back to the point distance.
    const ox = px - ax;
    const oy = py - ay;
    return ox * ox + oy * oy;
  }
  // Projection parameter clamped to the segment, so the nearest point of a
  // segment is never the foot of the perpendicular outside `[a, b]`.
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ox = px - cx;
  const oy = py - cy;
  return ox * ox + oy * oy;
}

/**
 * Shortest distance from `point` to a stroke's polyline, in layer-local units.
 *
 * A single-point stroke is a point; a multi-point stroke is a chain of
 * segments (distance to the *segment*, not to the infinite line), and a
 * zero-length segment degenerates to a point distance instead of producing
 * `0 / 0` NaN. Squared distances are compared and only the winner is rooted.
 * An empty stroke has no ink and reports `Infinity`.
 */
export function distanceToStroke(stroke: StrokeT, point: LayerPoint): number {
  const points = stroke.points;
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);

  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const squared = distanceToSegmentSquared(
      previous.x,
      previous.y,
      current.x,
      current.y,
      point.x,
      point.y,
    );
    if (squared < best) best = squared;
  }
  return Math.sqrt(best);
}

/** Strokes whose polyline passes within `radius` of `point` (tangency hits). */
export function strokesHitByCircle(
  strokes: readonly StrokeT[],
  point: LayerPoint,
  radius: number,
): StrokeT[] {
  return strokes.filter((stroke) => distanceToStroke(stroke, point) <= radius);
}

/** Strictly inside the circle (squared, no root). Boundary points are outside. */
function isInsideCircle(point: LayerPoint, center: LayerPoint, radius: number): boolean {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return dx * dx + dy * dy < radius * radius;
}

/**
 * Interior `t` values in `(0, 1)` where the segment `a -> b` crosses the circle.
 * Tangency (`discriminant === 0`) is treated as no crossing: the inside set is
 * a single point, so cutting there would only insert a redundant vertex.
 */
function interiorCircleRoots(
  a: LayerPoint,
  b: LayerPoint,
  center: LayerPoint,
  radius: number,
): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return [];

  const fx = a.x - center.x;
  const fy = a.y - center.y;
  const halfB = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  const discriminant = halfB * halfB - lengthSquared * c;
  if (discriminant <= 0) return [];

  const root = Math.sqrt(discriminant);
  const t0 = (-halfB - root) / lengthSquared;
  const t1 = (-halfB + root) / lengthSquared;
  const roots: number[] = [];
  if (t0 > 0 && t0 < 1) roots.push(t0);
  if (t1 > 0 && t1 < 1) roots.push(t1);
  return roots;
}

/** A point on `a -> b` at `t`, with `radius` / `opacity` lerped and rest copied. */
function interpolatePoint(a: PointT, b: PointT, t: number): PointT {
  return Object.assign(new PointT(), a, {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    radius: a.radius + (b.radius - a.radius) * t,
    opacity: a.opacity + (b.opacity - a.opacity) * t,
  });
}

/** One piece of a polyline between two consecutive circle cuts. */
interface Subsegment {
  a: PointT;
  b: PointT;
  inside: boolean;
}

/**
 * Cut one segment at its interior circle crossings and classify every piece by
 * its midpoint. Cut points are cached per segment so two adjacent pieces share
 * the same boundary object and can later be merged by identity.
 */
function segmentSubsegments(
  a: PointT,
  b: PointT,
  center: LayerPoint,
  radius: number,
): Subsegment[] {
  const cuts = [0, ...interiorCircleRoots(a, b, center, radius), 1];
  const boundary = new Map<number, PointT>();
  const boundaryAt = (t: number): PointT => {
    if (t === 0) return a;
    if (t === 1) return b;
    const cached = boundary.get(t);
    if (cached) return cached;
    const created = interpolatePoint(a, b, t);
    boundary.set(t, created);
    return created;
  };

  const pieces: Subsegment[] = [];
  for (let cut = 0; cut < cuts.length - 1; cut += 1) {
    const t0 = cuts[cut];
    const t1 = cuts[cut + 1];
    const mid = (t0 + t1) / 2;
    const inside = isInsideCircle(
      { x: a.x + (b.x - a.x) * mid, y: a.y + (b.y - a.y) * mid },
      center,
      radius,
    );
    pieces.push({ a: boundaryAt(t0), b: boundaryAt(t1), inside });
  }
  return pieces;
}

/** True when two points share the same `x`/`y` (identity merge test). */
function sameXY(p: PointT, q: PointT): boolean {
  return p.x === q.x && p.y === q.y;
}

/** Append `point` unless it repeats the run's last point. */
function pushDistinct(points: PointT[], point: PointT): void {
  if (!sameXY(points[points.length - 1], point)) points.push(point);
}

/** Keep the run only when it carries real ink (at least two points). */
function flushRun(runs: PointT[][], run: PointT[] | undefined): void {
  if (run && run.length >= 2) runs.push(run);
}

/**
 * Merge consecutive outside sub-segments into maximal runs. Sub-segments share
 * their boundary point objects, so the merge is exact rather than coordinate
 * based. A run always has at least two points; an isolated outside point of a
 * multi-point stroke is dropped, matching the "cut the stroke open" model.
 */
function mergeOutsideRuns(subsegments: readonly Subsegment[]): PointT[][] {
  const runs: PointT[][] = [];
  let run: PointT[] | undefined;

  for (const segment of subsegments) {
    if (segment.inside) {
      flushRun(runs, run);
      run = undefined;
      continue;
    }
    run ??= [segment.a];
    pushDistinct(run, segment.a);
    pushDistinct(run, segment.b);
  }
  flushRun(runs, run);
  return runs;
}

/**
 * Split a stroke's polyline into the maximal runs that lie outside the circle.
 *
 * Each segment is cut at its interior circle crossings and every sub-segment is
 * classified by its midpoint; see `mergeOutsideRuns` for the run assembly.
 */
export function splitStrokeOutsideCircle(
  stroke: StrokeT,
  center: LayerPoint,
  radius: number,
): PointT[][] {
  const points = stroke.points;
  const subsegments: Subsegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    subsegments.push(...segmentSubsegments(points[index], points[index + 1], center, radius));
  }
  return mergeOutsideRuns(subsegments);
}
