/**
 * Shortening a stroke at its ends, so it stops under an arrowhead instead of running on to the tip.
 *
 * Distances are straight-line distances from the original end, which is what an arrowhead's base
 * sits at. A line too short for its trims comes back as null rather than turning inside out.
 *
 * A curve's trimmed end slides straight back along the way it arrives, towards its handle, rather than
 * being cut where the curve crosses that distance: a curve still bending there would meet the head off
 * its axis, and turning the head to meet it skews the arrow.
 */

import type { Point } from "../model/scene"

export interface Cubic {
  readonly sx: number
  readonly sy: number
  readonly c1x: number
  readonly c1y: number
  readonly c2x: number
  readonly c2y: number
  readonly tx: number
  readonly ty: number
}

export function quadAsCubic(start: Point, bend: Point, end: Point): Cubic {
  return {
    sx: start.x,
    sy: start.y,
    c1x: start.x + (2 / 3) * (bend.x - start.x),
    c1y: start.y + (2 / 3) * (bend.y - start.y),
    c2x: end.x + (2 / 3) * (bend.x - end.x),
    c2y: end.y + (2 / 3) * (bend.y - end.y),
    tx: end.x,
    ty: end.y,
  }
}

/** Null when the trims use up the whole curve, which then has nothing left to stroke. */
export function trimCubic(curve: Cubic, fromStart: number, fromEnd: number): Cubic | null {
  const start = Math.max(0, fromStart)
  const end = Math.max(0, fromEnd)
  if (start === 0 && end === 0) return curve
  if (start + end >= Math.hypot(curve.tx - curve.sx, curve.ty - curve.sy)) return null

  const s = { x: curve.sx, y: curve.sy }
  const c1 = { x: curve.c1x, y: curve.c1y }
  const c2 = { x: curve.c2x, y: curve.c2y }
  const t = { x: curve.tx, y: curve.ty }
  const leaving = heading(s, [c1, c2, t])
  const arriving = heading(t, [c2, c1, s])
  const s2 = back(s, leaving, start)
  const t2 = back(t, arriving, end)
  const h1 = handle(c1, s, s2, leaving, start)
  const h2 = handle(c2, t, t2, arriving, end)
  return { sx: s2.x, sy: s2.y, c1x: h1.x, c1y: h1.y, c2x: h2.x, c2y: h2.y, tx: t2.x, ty: t2.y }
}

/**
 * The unit direction a curve points in at `end`, from the nearest control point that is not on it, and
 * +x when there is none. Caps take their angle from this too, so a head and its stroke share one axis.
 */
export function heading(end: Point, inward: readonly Point[]): Point {
  const from = inward.find((point) => distance(point, end) > 1e-9)
  if (!from) return { x: 1, y: 0 }
  const length = distance(from, end)
  return { x: (end.x - from.x) / length, y: (end.y - from.y) / length }
}

function back(end: Point, direction: Point, by: number): Point {
  return { x: end.x - direction.x * by, y: end.y - direction.y * by }
}

// A handle longer than the trim stays where it is, so the rest of the curve keeps its shape; a shorter
// one is kept a third of its length behind the moved end, still on the axis.
function handle(control: Point, end: Point, moved: Point, direction: Point, by: number): Point {
  if (by === 0) return control
  const reach = distance(control, end)
  return back(moved, direction, Math.max(reach - by, reach / 3))
}

/** Null when the trims use up a straight line; an elbow keeps at least its middle legs. */
export function trimPolyline(points: readonly Point[], fromStart: number, fromEnd: number): readonly Point[] | null {
  const start = Math.max(0, fromStart)
  const end = Math.max(0, fromEnd)
  if (points.length < 2 || (start === 0 && end === 0)) return points

  const last = points.length - 1
  if (points.length === 2) {
    const length = distance(points[0], points[1])
    if (start + end >= length) return null
    return [toward(points[0], points[1], start), toward(points[1], points[0], end)]
  }

  // Each trim stays on its own end leg: an arrowhead longer than an elbow's last leg sits over the
  // corner, and cutting round the corner would leave the other leg poking out beside it.
  const out = points.slice()
  out[0] = toward(points[0], points[1], Math.min(start, distance(points[0], points[1])))
  out[last] = toward(points[last], points[last - 1], Math.min(end, distance(points[last], points[last - 1])))
  // A used-up end leg would leave a zero-length segment for the rail offset to take a normal from.
  if (samePoint(out[last], out[last - 1])) out.pop()
  if (samePoint(out[0], out[1])) out.shift()
  return out.length < 2 ? null : out
}

function samePoint(a: Point, b: Point): boolean {
  return distance(a, b) < 1e-9
}

function toward(from: Point, to: Point, by: number): Point {
  const length = distance(from, to)
  if (length === 0 || by <= 0) return from
  const t = Math.min(1, by / length)
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
