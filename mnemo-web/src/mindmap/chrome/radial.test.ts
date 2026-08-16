import { describe, expect, it } from "vitest"

import { RADIAL_DEAD, RADIAL_INNER, RADIAL_OUTER, sectorAt, wedgePath } from "./radial"

/** A pointer offset `degrees` clockwise from straight up, far enough out to be a real flick. */
function at(degrees: number, count: number): number | null {
  const angle = (degrees * Math.PI) / 180
  return sectorAt(Math.sin(angle) * 50, -Math.cos(angle) * 50, count)
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

describe("sectorAt", () => {
  it("puts sector 0 straight up whatever the ring holds", () => {
    // The one property a caller relies on when it writes its sectors in reading order: whichever
    // set is up, the first entry is the one directly above the pointer.
    for (const count of [2, 3, 4, 5, 6, 7, 8]) {
      expect(at(0, count)).toBe(0)
    }
  })

  it("picks nothing inside the dead zone", () => {
    expect(sectorAt(0, 0, 6)).toBeNull()
    expect(sectorAt(RADIAL_DEAD - 1, 0, 6)).toBeNull()
    expect(sectorAt(0, -(RADIAL_DEAD - 1), 6)).toBeNull()
    // The edge of the slack is already a pick, so a hand that stops exactly there is not stuck
    // between two answers.
    expect(sectorAt(RADIAL_DEAD, 0, 6)).not.toBeNull()
  })

  it("picks nothing from an empty ring", () => {
    expect(sectorAt(50, -50, 0)).toBeNull()
  })

  it("gives a boundary to the sector it opens", () => {
    // Four sectors, so the boundary is the diagonal and the arithmetic lands on it exactly rather
    // than a hair either side of it. Sectors run from their leading edge up to but not including
    // the next, so the diagonal belongs to sector 1.
    expect(sectorAt(50, -50, 4)).toBe(1)
    expect(at(44.5, 4)).toBe(0)
    expect(at(45.5, 4)).toBe(1)
  })

  it("reaches every sector as the pointer goes round", () => {
    for (const count of [3, 5, 6, 7]) {
      const hit = new Set<number>()
      for (let degrees = 0; degrees < 360; degrees += 0.5) {
        const index = at(degrees, count)
        if (index != null) hit.add(index)
      }
      expect([...hit].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i))
    }
  })

  it("folds a full turn back onto the top sector", () => {
    // The top sector is the one the wrap splits: half of it lives just under two pi, which is the
    // half that would come back as an index one past the end without the fold.
    expect(at(359.5, 6)).toBe(0)
    expect(at(360, 6)).toBe(0)
    expect(at(-0.5, 6)).toBe(0)
    expect(at(720 + 60, 6)).toBe(1)
  })
})

describe("wedgePath", () => {
  it("closes on the point it opened from", () => {
    const d = wedgePath(1, 5)
    expect(d.endsWith("Z")).toBe(true)

    const points = pointsOf(d)
    expect(points).toHaveLength(5)
    expect(points[points.length - 1]).toEqual(points[0])
  })

  it("keeps every corner in the ring's band", () => {
    for (let i = 0; i < 6; i++) {
      for (const point of pointsOf(wedgePath(i, 6))) {
        const radius = Math.hypot(point.x, point.y)
        // Coordinates are written to two decimals, so the band needs the rounding's worth of slack
        // rather than an exact compare.
        expect(radius).toBeGreaterThanOrEqual(RADIAL_INNER - 0.02)
        expect(radius).toBeLessThanOrEqual(RADIAL_OUTER + 0.02)
        // And on one of the two radii, not loose somewhere between them: a wedge is an annulus
        // slice, so nothing it draws belongs in the middle of the band.
        const offBand = Math.min(Math.abs(radius - RADIAL_INNER), Math.abs(radius - RADIAL_OUTER))
        expect(offBand).toBeLessThan(0.02)
      }
    }
  })

  it("draws the boundaries the hit test buckets by", () => {
    // The two have to agree or the lit wedge is not the one a release picks. The path opens on the
    // sector's leading edge, so its first point is the boundary with the sector before it.
    const count = 6
    for (let i = 0; i < count; i++) {
      const [lead] = pointsOf(wedgePath(i, count))
      const degrees = ((Math.atan2(lead.x, -lead.y) * 180) / Math.PI + 360) % 360

      expect(at(degrees + 0.5, count)).toBe(i)
      expect(at(degrees - 0.5, count)).toBe((i + count - 1) % count)
    }
  })
})
