import { describe, expect, it } from "vitest"

import {
  clampRing,
  HUB_RADIUS,
  RING_EDGE,
  RING_INNER,
  RING_OUTER,
  ringHit,
  sectorAngle,
  subAngle,
  subStep,
  SUB_INNER,
  SUB_OUTER,
  wedgePath,
  WEDGE_GAP,
  WEDGE_ROUND,
  type RingSlot,
} from "./radial"

/** A pointer `degrees` clockwise from straight up, `radius` out. */
function offset(degrees: number, radius: number): [number, number] {
  const angle = (degrees * Math.PI) / 180
  return [Math.sin(angle) * radius, -Math.cos(angle) * radius]
}

const plain = (count: number): RingSlot[] => Array.from({ length: count }, () => ({ subs: 0 }))

function mainAt(degrees: number, count: number) {
  return ringHit(...offset(degrees, 90), plain(count), null).hot
}

interface PathPoint {
  x: number
  y: number
}

/** The point every command lands on, which is always the last two numbers it carries. */
function pointsOf(d: string): PathPoint[] {
  const points: PathPoint[] = []
  for (const [, command, args] of d.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
    if (command === "Z") continue
    const numbers = args.trim().split(/\s+/).map(Number)
    points.push({ x: numbers[numbers.length - 2], y: numbers[numbers.length - 1] })
  }
  return points
}

const degreesOf = (point: PathPoint) => ((Math.atan2(point.x, -point.y) * 180) / Math.PI + 360) % 360

describe("ringHit on the main ring", () => {
  it("picks nothing over the hub", () => {
    expect(ringHit(0, 0, plain(6), null)).toEqual({ hot: null, sub: null })
    expect(ringHit(...offset(30, HUB_RADIUS - 1), plain(6), null).hot).toBeNull()
    // The hub's edge is already a pick, so a hand that stops exactly there is not stuck between two answers.
    expect(ringHit(...offset(30, HUB_RADIUS), plain(6), null).hot).not.toBeNull()
  })

  it("puts sector 0 straight up whatever the ring holds", () => {
    for (let count = 2; count <= 9; count++) {
      expect(mainAt(0, count)).toBe(0)
    }
  })

  it("splits sectors half a step either side of their centre at every count", () => {
    for (let count = 2; count <= 9; count++) {
      const step = 360 / count
      for (let i = 0; i < count; i++) {
        const boundary = i * step + step / 2
        expect(mainAt(boundary - 0.25, count)).toBe(i)
        expect(mainAt(boundary + 0.25, count)).toBe((i + 1) % count)
      }
    }
  })

  it("folds the wrap at the top back onto sector 0", () => {
    expect(mainAt(359.5, 6)).toBe(0)
    expect(mainAt(0.5, 6)).toBe(0)
  })

  it("stays on the main ring up to its edge", () => {
    const slots: RingSlot[] = [{ subs: 3 }, { subs: 0 }, { subs: 0 }, { subs: 0 }]
    expect(ringHit(...offset(0, RING_EDGE), slots, null)).toEqual({ hot: 0, sub: null })
    expect(ringHit(...offset(0, RING_EDGE + 1), slots, null)).toEqual({ hot: 0, sub: 1 })
  })

  it("never lights an inert sector", () => {
    const slots: RingSlot[] = [{ subs: 0 }, { subs: 2, inert: true }, { subs: 0 }, { subs: 0 }]
    expect(ringHit(...offset(90, 90), slots, null).hot).toBeNull()
    expect(ringHit(...offset(90, 170), slots, null).hot).toBeNull()
    // Not even held by a previous hot it should never have had.
    expect(ringHit(...offset(90, 170), slots, 1).hot).toBeNull()
  })
})

describe("ringHit past the rim", () => {
  // Six sectors, the second holding eight items the way the canvas ring's Shapes does.
  const slots: RingSlot[] = [{ subs: 0 }, { subs: 8 }, { subs: 0 }, { subs: 0 }, { subs: 3 }, { subs: 0 }]
  const shapes = 1
  const angleOf = (item: number) => subAngle(shapes, slots.length, item, 8)

  it("picks the sub item under the pointer", () => {
    for (let item = 0; item < 8; item++) {
      expect(ringHit(...offset(angleOf(item), 164), slots, shapes)).toEqual({ hot: shapes, sub: item })
    }
  })

  it("clamps to the ends of the band", () => {
    const step = subStep(8)
    expect(ringHit(...offset(angleOf(0) - step * 0.9, 164), slots, shapes)).toEqual({ hot: shapes, sub: 0 })
    expect(ringHit(...offset(angleOf(7) + step * 0.9, 164), slots, shapes)).toEqual({ hot: shapes, sub: 7 })
  })

  it("keeps the parent while the pointer slides along its band into another sector's angle", () => {
    // Item 6 of Shapes lies inside a later sector's angle.
    expect(ringHit(...offset(angleOf(6), 164), slots, null).hot).not.toBe(shapes)
    expect(ringHit(...offset(angleOf(6), 164), slots, shapes)).toEqual({ hot: shapes, sub: 6 })
  })

  it("switches to the main sector at that angle once the pointer leaves the band", () => {
    const beyond = angleOf(7) + subStep(8) * 1.2
    const hit = ringHit(...offset(beyond, 164), slots, shapes)
    expect(hit.hot).toBe(Math.floor(((beyond + 30) % 360) / 60) % 6)
    expect(hit.hot).not.toBe(shapes)
  })

  it("picks no sub item past a sector with no sub-ring", () => {
    expect(ringHit(...offset(sectorAngle(2, 6), 170), slots, null)).toEqual({ hot: 2, sub: null })
  })

  it("has no outer limit", () => {
    expect(ringHit(...offset(angleOf(3), 5000), slots, shapes)).toEqual({ hot: shapes, sub: 3 })
  })
})

describe("clampRing", () => {
  const pane = { width: 1000, height: 700 }
  const reach = RING_OUTER + 8

  it("leaves a ring that fits where it opened", () => {
    expect(clampRing({ x: 500, y: 350 }, pane)).toEqual({ x: 500, y: 350 })
  })

  it("pulls a ring in from every edge", () => {
    expect(clampRing({ x: 10, y: 10 }, pane)).toEqual({ x: reach, y: reach })
    expect(clampRing({ x: 995, y: 695 }, pane)).toEqual({ x: 1000 - reach, y: 700 - reach })
  })

  it("centres a ring on a pane too small to hold it", () => {
    expect(clampRing({ x: 10, y: 10 }, { width: 200, height: 150 })).toEqual({ x: 100, y: 75 })
  })
})

describe("wedgePath", () => {
  it("closes on the point it opened from", () => {
    const d = wedgePath(0, 60, RING_INNER, RING_OUTER)
    expect(d.endsWith("Z")).toBe(true)
    expect(pointsOf(d)).toHaveLength(4)
  })

  it("keeps every corner on its band, inset by the rounding", () => {
    for (const [inner, outer] of [
      [RING_INNER, RING_OUTER],
      [SUB_INNER, SUB_OUTER],
    ]) {
      for (const point of pointsOf(wedgePath(10, 50, inner, outer))) {
        const radius = Math.hypot(point.x, point.y)
        const off = Math.min(Math.abs(radius - inner - WEDGE_ROUND), Math.abs(radius - outer + WEDGE_ROUND))
        expect(off).toBeLessThan(0.02)
      }
    }
  })

  it("stays inside the bucket the hit test gives it, a hairline off each edge", () => {
    // The two have to agree or the lit wedge is not the one a release picks.
    for (const count of [2, 5, 6, 9]) {
      const step = 360 / count
      for (let i = 0; i < count; i++) {
        const centre = sectorAngle(i, count)
        const path = wedgePath(centre - step / 2, centre + step / 2, RING_INNER, RING_OUTER)
        for (const point of pointsOf(path)) {
          const turn = Math.abs(((degreesOf(point) - centre + 540) % 360) - 180)
          const inset = (((WEDGE_GAP / 2 + WEDGE_ROUND) / Math.hypot(point.x, point.y)) * 180) / Math.PI
          expect(turn).toBeLessThan(step / 2)
          expect(step / 2 - turn).toBeCloseTo(inset, 1)
          expect(mainAt(degreesOf(point), count)).toBe(i)
        }
      }
    }
  })
})
