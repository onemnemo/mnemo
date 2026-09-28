import { describe, expect, it } from "vitest"

import {
  clampRing,
  HANDOVER_DWELL,
  HUB_RADIUS,
  LATCH_DWELL,
  RING_EDGE,
  RING_INNER,
  RING_OUTER,
  RING_START,
  sectorAngle,
  stepRing,
  subAngle,
  SUB_INNER,
  SUB_OUTER,
  wedgePath,
  WEDGE_GAP,
  WEDGE_ROUND,
  type RingSlot,
  type RingState,
} from "./radial"

/** A pointer `degrees` clockwise from straight up, `radius` out. */
function offset(degrees: number, radius: number): [number, number] {
  const angle = (degrees * Math.PI) / 180
  return [Math.sin(angle) * radius, -Math.cos(angle) * radius]
}

const plain = (count: number): RingSlot[] => Array.from({ length: count }, () => ({ subs: 0 }))

function mainAt(degrees: number, count: number) {
  return stepRing(RING_START, ...offset(degrees, 90), 0, plain(count)).hit.hot
}

/**
 * Moves the pointer along a straight line from where it is to a polar point at a constant speed,
 * one event every 8 ms, the rate a real pointer reports at.
 */
function travel(state: RingState, to: [number, number], speed: number, slots: readonly RingSlot[]): RingState {
  const from = state.last ?? { x: 0, y: 0, t: 0 }
  const [x, y] = offset(...to)
  const length = Math.hypot(x - from.x, y - from.y)
  const steps = Math.max(1, Math.ceil(length / (speed * 8)))
  let next = state
  for (let i = 1; i <= steps; i++) {
    next = stepRing(next, from.x + ((x - from.x) * i) / steps, from.y + ((y - from.y) * i) / steps, from.t + i * 8, slots)
  }
  return next
}

/** Holds the pointer still for `ms`, which reports as tiny moves on the same spot. */
function rest(state: RingState, ms: number, slots: readonly RingSlot[]): RingState {
  let next = state
  const at = state.last ?? { x: 0, y: 0, t: 0 }
  for (let t = 8; t <= ms; t += 8) {
    next = stepRing(next, at.x + (t % 16 === 0 ? 0.1 : 0), at.y, at.t + t, slots)
  }
  return next
}

// The element ring: Colour (8 swatches), Node shape (4), Connect, Link (2), Collapse, Frame, Align (8), Pin.
const ELEMENT: RingSlot[] = [{ subs: 8 }, { subs: 4 }, { subs: 0 }, { subs: 2 }, { subs: 0 }, { subs: 0 }, { subs: 8 }, { subs: 0 }]

describe("stepRing on the main ring", () => {
  it("picks nothing over the hub", () => {
    expect(stepRing(RING_START, 0, 0, 0, plain(8)).hit).toEqual({ hot: null, sub: null })
    expect(stepRing(RING_START, ...offset(30, HUB_RADIUS - 1), 0, plain(8)).hit.hot).toBeNull()
    expect(stepRing(RING_START, ...offset(30, HUB_RADIUS), 0, plain(8)).hit.hot).not.toBeNull()
  })

  it("splits sectors half a step either side of their centre at every count", () => {
    for (let count = 2; count <= 9; count++) {
      const step = 360 / count
      expect(mainAt(0, count)).toBe(0)
      for (let i = 0; i < count; i++) {
        const boundary = i * step + step / 2
        expect(mainAt(boundary - 0.25, count)).toBe(i)
        expect(mainAt(boundary + 0.25, count)).toBe((i + 1) % count)
      }
    }
  })

  it("lights a dimmed sector so the hub can name it, but never opens its sub-ring", () => {
    const slots: RingSlot[] = [{ subs: 8, inert: true }, ...plain(7)]
    const out = travel(stepRing(RING_START, ...offset(0, 60), 0, slots), [0, 170], 0.5, slots)
    expect(out.hit).toEqual({ hot: 0, sub: null })
    expect(out.latched).toBeNull()
  })

  it("follows the pointer sliding slowly around the ring, through sectors with sub-rings", () => {
    let state = stepRing(RING_START, ...offset(0, 92), 0, ELEMENT)
    state = rest(state, LATCH_DWELL + 40, ELEMENT)
    expect(state.latched).toBe(0)
    for (const degrees of [30, 60, 90, 120, 135]) {
      state = travel(state, [degrees, 92], 0.2, ELEMENT)
    }
    expect(state.hit.hot).toBe(3)
  })

  it("hands over to the neighbour after a short dwell at ordinary speed", () => {
    let state = rest(stepRing(RING_START, ...offset(0, 92), 0, ELEMENT), 200, ELEMENT)
    state = travel(state, [45, 92], 0.5, ELEMENT)
    state = rest(state, HANDOVER_DWELL + 16, ELEMENT)
    expect(state.hit.hot).toBe(1)
  })

  it("hands over to a neighbour the pointer stopped dead in once the dwell is stepped", () => {
    let state = rest(stepRing(RING_START, ...offset(0, 92), 0, ELEMENT), 200, ELEMENT)
    state = travel(state, [45, 92], 1.5, ELEMENT)
    expect(state.hit.hot).toBe(0)
    const at = state.last!
    state = stepRing(state, at.x, at.y, at.t + HANDOVER_DWELL, ELEMENT)
    expect(state.hit.hot).toBe(1)
  })

  it("lets go when the pointer comes back toward the hub", () => {
    let state = rest(stepRing(RING_START, ...offset(0, 92), 0, ELEMENT), 200, ELEMENT)
    state = travel(state, [45, 56], 1.5, ELEMENT)
    state = travel(state, [45, 92], 1.5, ELEMENT)
    expect(state.hit.hot).toBe(1)
  })
})

describe("stepRing past the rim", () => {
  const far = subAngle(0, 8, 7, 8)

  it("keeps a latched parent through a fast diagonal throw to its farthest item", () => {
    let state = rest(stepRing(RING_START, ...offset(0, 88), 0, ELEMENT), 150, ELEMENT)
    state = travel(state, [far, 164], 1.2, ELEMENT)
    expect(state.hit).toEqual({ hot: 0, sub: 7 })
  })

  it("keeps a parent the pointer only brushed on a throw through its neighbour to a far item", () => {
    let state = travel(stepRing(RING_START, ...offset(0, 60), 0, ELEMENT), [0, 80], 1.5, ELEMENT)
    expect(state.latched).toBeNull()
    state = travel(state, [far, 164], 1.5, ELEMENT)
    expect(state.hit).toEqual({ hot: 0, sub: 7 })
  })

  it("gives the neighbour a throw that settled in it before the rim", () => {
    let state = travel(stepRing(RING_START, ...offset(0, 60), 0, ELEMENT), [0, 80], 1.5, ELEMENT)
    state = travel(state, [45, 100], 1.5, ELEMENT)
    state = rest(state, HANDOVER_DWELL + 16, ELEMENT)
    state = travel(state, [45, 164], 1.5, ELEMENT)
    expect(state.hit.hot).toBe(1)
  })

  it("latches a parent the pointer crosses the rim on, without a dwell", () => {
    const state = travel(stepRing(RING_START, ...offset(0, 60), 0, ELEMENT), [0, 164], 1.5, ELEMENT)
    expect(state.hit.hot).toBe(0)
    expect(state.hit.sub).not.toBeNull()
  })

  it("keeps the parent while sliding along its band, and clamps to its ends", () => {
    let state = travel(stepRing(RING_START, ...offset(0, 60), 0, ELEMENT), [0, 164], 1.5, ELEMENT)
    state = travel(state, [far + 6, 164], 0.3, ELEMENT)
    expect(state.hit).toEqual({ hot: 0, sub: 7 })
  })

  it("moves to the sector at the pointer's angle once it leaves the band", () => {
    let state = travel(stepRing(RING_START, ...offset(0, 60), 0, ELEMENT), [0, 164], 1.5, ELEMENT)
    state = travel(state, [sectorAngle(3, 8), 164], 0.4, ELEMENT)
    expect(state.hit.hot).toBe(3)
  })

  it("picks no sub item past a sector with no sub-ring", () => {
    const state = travel(stepRing(RING_START, ...offset(90, 60), 0, ELEMENT), [90, 170], 1.5, ELEMENT)
    expect(state.hit).toEqual({ hot: 2, sub: null })
  })

  it("has no outer limit", () => {
    const state = travel(stepRing(RING_START, ...offset(0, 60), 0, ELEMENT), [0, 3000], 3, ELEMENT)
    expect(state.hit.hot).toBe(0)
    expect(state.hit.sub).not.toBeNull()
  })

  it("stays past the main edge only beyond it", () => {
    const at = stepRing(RING_START, ...offset(0, RING_EDGE), 0, ELEMENT)
    expect(at.hit).toEqual({ hot: 0, sub: null })
  })
})

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
