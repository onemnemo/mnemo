import { describe, expect, it } from "vitest"

import type { Point } from "../model/scene"
import { heading, quadAsCubic, trimCubic, trimPolyline, type Cubic } from "./stroke-trim"

const CURVE: Cubic = { sx: 0, sy: 0, c1x: 85, c1y: 0, c2x: 115, c2y: 100, tx: 200, ty: 100 }

function on(curve: Cubic, t: number): Point {
  const u = 1 - t
  return {
    x: u * u * u * curve.sx + 3 * u * u * t * curve.c1x + 3 * u * t * t * curve.c2x + t * t * t * curve.tx,
    y: u * u * u * curve.sy + 3 * u * u * t * curve.c1y + 3 * u * t * t * curve.c2y + t * t * t * curve.ty,
  }
}

function nearestOn(curve: Cubic, point: Point): number {
  let best = Infinity
  for (let i = 0; i <= 4000; i++) {
    const at = on(curve, i / 4000)
    best = Math.min(best, Math.hypot(at.x - point.x, at.y - point.y))
  }
  return best
}

describe("trimCubic", () => {
  it("stops the given distance short of the end and leaves the start alone", () => {
    const trimmed = trimCubic(CURVE, 0, 7)!

    expect(Math.hypot(CURVE.tx - trimmed.tx, CURVE.ty - trimmed.ty)).toBeCloseTo(7, 6)
    expect([trimmed.sx, trimmed.sy]).toEqual([0, 0])
  })

  it("pulls each trimmed end straight back along the way the curve meets it, so a head on that axis sits centred", () => {
    const trimmed = trimCubic(CURVE, 5, 9)!
    const arriving = Math.atan2(CURVE.ty - CURVE.c2y, CURVE.tx - CURVE.c2x)
    const leaving = Math.atan2(CURVE.sy - CURVE.c1y, CURVE.sx - CURVE.c1x)

    expect(Math.atan2(CURVE.ty - trimmed.ty, CURVE.tx - trimmed.tx)).toBeCloseTo(arriving, 9)
    expect(Math.atan2(CURVE.sy - trimmed.sy, CURVE.sx - trimmed.sx)).toBeCloseTo(leaving, 9)
    expect(Math.atan2(trimmed.ty - trimmed.c2y, trimmed.tx - trimmed.c2x)).toBeCloseTo(arriving, 9)
    expect(Math.atan2(trimmed.sy - trimmed.c1y, trimmed.sx - trimmed.c1x)).toBeCloseTo(leaving, 9)
  })

  it("leaves a handle longer than the trim where it is, so the rest of the curve keeps its shape", () => {
    const trimmed = trimCubic(CURVE, 9, 9)!

    expect([trimmed.c1x, trimmed.c1y, trimmed.c2x, trimmed.c2y]).toEqual([CURVE.c1x, CURVE.c1y, CURVE.c2x, CURVE.c2y])
    // Only the ends move, so the middle stays on the original curve and the rest within a fifth of the trim.
    expect(nearestOn(CURVE, on(trimmed, 0.5))).toBeLessThan(0.05)
    for (const t of [0.1, 0.25, 0.75, 0.9]) {
      expect(nearestOn(CURVE, on(trimmed, t))).toBeLessThan(9 / 4)
    }
  })

  it("keeps a handle shorter than the trim on the axis behind the moved end", () => {
    const stubby: Cubic = { sx: 0, sy: 0, c1x: 60, c1y: 0, c2x: 97, c2y: 40, tx: 100, ty: 40 }
    const trimmed = trimCubic(stubby, 0, 9)!

    expect(trimmed.ty).toBeCloseTo(40, 9)
    expect(trimmed.c2y).toBeCloseTo(40, 9)
    expect(trimmed.c2x).toBeLessThan(trimmed.tx)
  })

  it("takes the heading from the next control point when a handle sits on its end, as a cap does", () => {
    const flat: Cubic = { sx: 0, sy: 0, c1x: 50, c1y: 50, c2x: 100, c2y: 0, tx: 100, ty: 0 }
    const trimmed = trimCubic(flat, 0, 10)!
    const cap = heading({ x: 100, y: 0 }, [{ x: 100, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 0 }])

    expect(Math.atan2(flat.ty - trimmed.ty, flat.tx - trimmed.tx)).toBeCloseTo(Math.atan2(cap.y, cap.x), 9)
  })

  it("leaves nothing to stroke when the trims use up the curve, rather than turning it inside out", () => {
    const short: Cubic = { sx: 0, sy: 0, c1x: 2, c1y: 0, c2x: 4, c2y: 0, tx: 6, ty: 0 }

    expect(trimCubic(short, 10, 10)).toBeNull()
    expect(trimCubic(short, 3, 3)).toBeNull()
    expect(trimCubic(short, 0, 5.9)).not.toBeNull()
  })

  it("leaves nothing of a zero-length curve that is trimmed, and keeps one that is not", () => {
    const point: Cubic = { sx: 4, sy: 4, c1x: 4, c1y: 4, c2x: 4, c2y: 4, tx: 4, ty: 4 }
    expect(trimCubic(point, 3, 3)).toBeNull()
    expect(trimCubic(point, 0, 0)).toBe(point)
  })

  it("draws a quadratic as the same curve in cubic form", () => {
    const start = { x: 0, y: 0 }
    const bend = { x: 50, y: 80 }
    const end = { x: 100, y: 0 }
    const cubic = quadAsCubic(start, bend, end)
    const mid = on(cubic, 0.5)

    expect(mid.x).toBeCloseTo(50, 6)
    expect(mid.y).toBeCloseTo(40, 6)
  })
})

describe("trimPolyline", () => {
  it("shortens a straight line along itself", () => {
    const [start, end] = trimPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 4, 10)!

    expect(start).toEqual({ x: 4, y: 0 })
    expect(end).toEqual({ x: 90, y: 0 })
  })

  it("leaves nothing to stroke on a line no longer than its trims", () => {
    expect(trimPolyline([{ x: 0, y: 0 }, { x: 6, y: 0 }], 6, 2)).toBeNull()
    expect(trimPolyline([{ x: 0, y: 0 }, { x: 6, y: 0 }], 3, 3)).toBeNull()
  })

  it("keeps each trim on its own end leg of an elbow, so the corner is never cut", () => {
    const elbow = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 40 },
      { x: 53, y: 40 },
    ]
    const trimmed = trimPolyline(elbow, 5, 10)!

    // The used-up last leg is dropped rather than left as a zero-length segment at the corner.
    expect(trimmed).toEqual([{ x: 5, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }])
  })

  it("drops a used-up first leg the same way", () => {
    const elbow = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 40 },
      { x: 60, y: 40 },
    ]
    expect(trimPolyline(elbow, 9, 0)).toEqual([{ x: 2, y: 0 }, { x: 2, y: 40 }, { x: 60, y: 40 }])
  })

  it("returns the points untouched when nothing is trimmed", () => {
    const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }]
    expect(trimPolyline(points, 0, 0)).toBe(points)
  })

  it("leaves nothing of a zero-length line that is trimmed", () => {
    expect(trimPolyline([{ x: 3, y: 3 }, { x: 3, y: 3 }], 5, 5)).toBeNull()
  })
})
