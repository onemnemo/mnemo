/**
 * Finding the edge under the pointer.
 *
 * Elements need nothing like this: they are real DOM, so the browser's own hit test already found
 * one before the event was dispatched, and `closest('.mm-node')` reads the answer. Edges have no DOM
 * at readable zoom, where they are drawn to a canvas, so they are found geometrically. Doing it
 * geometrically in both substrates rather than only in the one that needs it is what stops an edge
 * from becoming unclickable at exactly the zoom people work at.
 *
 * A click is not a frame. This walks the edge list, which is the one place in the module allowed to
 * be proportional to the document, and it still rejects almost all of it on a bounding-box test
 * before measuring anything.
 */

import { anchorsFor, edgeShape, type ElementBox } from "../canvas/edge-paths"
import type { Point, SceneEdge } from "../model/scene"

/** How many straight pieces a curve is measured as. Sub-pixel at any zoom a human clicks at. */
const CURVE_SAMPLES = 24

/** Click target around an edge's centreline, in screen pixels. Callers divide by zoom to reach canvas. */
export const EDGE_HIT_PIXELS = 7

export interface EdgeHitInput {
  readonly edges: readonly SceneEdge[]
  readonly boxOf: (id: string) => ElementBox | undefined
  readonly point: Point
  /** Canvas-space slack. The caller divides its pixel target by the zoom. */
  readonly tolerance: number
}

/**
 * The nearest edge within tolerance, or null.
 *
 * Nearest rather than first, because edges leaving one parent fan out from the same point and a
 * first-match would hand back whichever happened to be earlier in the document every time.
 */
export function hitEdge(input: EdgeHitInput): string | null {
  const { edges, boxOf, point, tolerance } = input
  let best: string | null = null
  let bestDistance = tolerance

  for (const edge of edges) {
    const from = boxOf(edge.fromId)
    const to = boxOf(edge.toId)
    if (!from || !to) {
      continue
    }
    if (!nearBounds(point, from, to, tolerance)) {
      continue
    }

    const distance = distanceToEdge(edge, from, to, point)
    if (distance <= bestDistance) {
      bestDistance = distance
      best = edge.id
    }
  }

  return best
}

/** The union of both endpoint boxes, grown by the tolerance. Every routing stays inside it. */
function nearBounds(point: Point, from: ElementBox, to: ElementBox, tolerance: number): boolean {
  const minX = Math.min(from.x, to.x) - tolerance
  const minY = Math.min(from.y, to.y) - tolerance
  const maxX = Math.max(from.x + from.width, to.x + to.width) + tolerance
  const maxY = Math.max(from.y + from.height, to.y + to.height) + tolerance
  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY
}

function distanceToEdge(edge: SceneEdge, from: ElementBox, to: ElementBox, point: Point): number {
  // The centreline, not the drawn shape: a taper is a ribbon around this same curve, and measuring
  // to the ribbon would make a thick branch easier to hit at the trunk than at the twig.
  const shape = edgeShape(edge.routing ?? "curve", anchorsFor(from, to))
  const stroke = shape.stroke

  if (stroke.kind === "polyline") {
    return distanceToPolyline(stroke.points, point)
  }
  if (stroke.kind === "cubic") {
    return distanceToCubic(
      { x: stroke.sx, y: stroke.sy },
      { x: stroke.c1x, y: stroke.c1y },
      { x: stroke.c2x, y: stroke.c2y },
      { x: stroke.tx, y: stroke.ty },
      point,
    )
  }
  // A ribbon is never produced by `edgeShape`, only by `branchShape`, so this is unreachable in
  // practice and is here so a future routing cannot make the function silently return zero.
  return Number.POSITIVE_INFINITY
}

function distanceToCubic(p0: Point, p1: Point, p2: Point, p3: Point, point: Point): number {
  let previous = p0
  let best = Number.POSITIVE_INFINITY

  for (let i = 1; i <= CURVE_SAMPLES; i += 1) {
    const t = i / CURVE_SAMPLES
    const u = 1 - t
    const current = {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    }
    best = Math.min(best, distanceToSegment(previous, current, point))
    previous = current
  }

  return best
}

function distanceToPolyline(points: readonly Point[], point: Point): number {
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < points.length; i += 1) {
    best = Math.min(best, distanceToSegment(points[i - 1], points[i], point))
  }
  return best
}

export function distanceToSegment(a: Point, b: Point, point: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y)
  }

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
}
