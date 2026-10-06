import { describe, expect, it } from "vitest"

import { snapMove, snapResize, SNAP_PX } from "./snap"

const SIZE = { w: 1000, h: 500 }
const other = { x: 0.5, y: 0.5, w: 0.2, h: 0.2 }

describe("snapMove", () => {
  it("snaps an edge to another mask's edge within six screen pixels", () => {
    // 4px short of the left edge at x = 0.5.
    const result = snapMove({ x: 0.296, y: 0.1, w: 0.2, h: 0.1 }, [other], SIZE)
    expect(result.dx).toBeCloseTo(0.004, 6)
    expect(result.guides.some((g) => g.axis === "x" && Math.abs(g.at - 0.5) < 1e-6)).toBe(true)
  })

  it("does not snap beyond the threshold", () => {
    const result = snapMove({ x: 0.2, y: 0.1, w: 0.2, h: 0.1 }, [other], SIZE)
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] })
    expect(SNAP_PX).toBe(6)
  })

  it("measures the threshold in screen pixels, so zooming in makes it stricter in the image", () => {
    const box = { x: 0.2, y: 0.1, w: 0.2, h: 0.1 }
    const near = { x: 0.506, y: 0.5, w: 0.2, h: 0.2 }
    expect(snapMove({ ...box, x: 0.3 }, [near], SIZE).dx).toBeCloseTo(0.006, 6)
    expect(snapMove({ ...box, x: 0.3 }, [near], { w: 4000, h: 2000 }).dx).toBe(0)
  })

  it("snaps centres", () => {
    // The moving centre is 0.603 and the other's is 0.6; no edge is near.
    const result = snapMove({ x: 0.553, y: 0.1, w: 0.1, h: 0.1 }, [other], SIZE)
    expect(result.dx).toBeCloseTo(-0.003, 6)
  })

  it("snaps both axes and draws a guide for each", () => {
    const result = snapMove({ x: 0.503, y: 0.403, w: 0.2, h: 0.1 }, [other], SIZE)
    expect(result.dx).toBeCloseTo(-0.003, 6)
    expect(result.dy).toBeCloseTo(-0.003, 6)
    expect(result.guides.map((g) => g.axis).sort()).toEqual(expect.arrayContaining(["x", "y"]))
  })

  it("has nothing to snap to alone", () => {
    expect(snapMove({ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, [], SIZE).guides).toEqual([])
  })

  it("lets a guide span both boxes", () => {
    const result = snapMove({ x: 0.5, y: 0.1, w: 0.1, h: 0.1 }, [other], SIZE)
    const guide = result.guides.find((g) => g.axis === "x" && Math.abs(g.at - 0.5) < 1e-6)!
    expect(guide.from).toBeCloseTo(0.1, 6)
    expect(guide.to).toBeCloseTo(0.7, 6)
  })
})

describe("snapResize", () => {
  it("snaps only the edge a handle moves", () => {
    const resized = snapResize({ x: 0.1, y: 0.1, w: 0.396, h: 0.2 }, "e", [other], SIZE)
    expect(resized.box.x).toBe(0.1)
    expect(resized.box.x + resized.box.w).toBeCloseTo(0.5, 6)
    expect(resized.box.h).toBe(0.2)
  })

  it("snaps the west edge without moving the east", () => {
    const resized = snapResize({ x: 0.504, y: 0.1, w: 0.3, h: 0.2 }, "w", [other], SIZE)
    expect(resized.box.x).toBeCloseTo(0.5, 6)
    expect(resized.box.x + resized.box.w).toBeCloseTo(0.804, 6)
  })

  it("leaves the box alone out of range", () => {
    const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }
    expect(snapResize(box, "se", [other], SIZE)).toEqual({ box, guides: [] })
  })
})
