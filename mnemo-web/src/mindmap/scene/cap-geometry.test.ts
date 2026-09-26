import { describe, expect, it } from "vitest"

import { arrowCapPoints, capInset, capsPathData, dotRadius } from "./cap-geometry"
import { extentOf } from "./line-geometry"

describe("cap geometry", () => {
  it("keeps maximum-weight arrow points inside the recorded extent at every angle", () => {
    const thickness = 12
    const extent = extentOf([{ x: 0, y: 0 }], thickness, "arrow", "arrow")

    for (const angle of [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI]) {
      for (const point of arrowCapPoints({ x: 0, y: 0, angle }, thickness)) {
        expect(point.x).toBeGreaterThanOrEqual(extent.minX)
        expect(point.x).toBeLessThanOrEqual(extent.maxX)
        expect(point.y).toBeGreaterThanOrEqual(extent.minY)
        expect(point.y).toBeLessThanOrEqual(extent.maxY)
      }
    }
  })

  it("uses the marker's dot radius in canvas units", () => {
    expect(dotRadius(1)).toBe(1.6)
  })

  it("puts the arrow's tip exactly on the line's end", () => {
    for (const angle of [0, 1, -2.5]) {
      const [, tip] = arrowCapPoints({ x: 30, y: -12, angle }, 4)
      expect(tip.x).toBeCloseTo(30, 9)
      expect(tip.y).toBeCloseTo(-12, 9)
    }
  })

  it("stops the stroke inside the head's wide part, with its round end hidden", () => {
    const width = 3
    const inset = capInset("arrow", width)
    const [left, tip] = arrowCapPoints({ x: 0, y: 0, angle: 0 }, width)
    const length = tip.x - left.x
    const halfWidthAt = (fromTip: number): number => (Math.abs(left.y) * fromTip) / length

    // Behind the base would leave a seam, and near the tip the head is narrower than the stroke.
    expect(inset).toBeLessThan(length)
    expect(inset).toBeGreaterThan(length / 2)
    expect(halfWidthAt(inset - width / 2)).toBeGreaterThan(width / 2)
  })

  it("does not shorten the stroke for a dot or a plain end", () => {
    expect(capInset("dot", 4)).toBe(0)
    expect(capInset("none", 4)).toBe(0)
    expect(capInset(undefined, 4)).toBe(0)
  })

  it("writes every cap of a line as one filled path", () => {
    const d = capsPathData(
      [
        { kind: "arrow", x: 10, y: 0, angle: 0 },
        { kind: "dot", x: 0, y: 0, angle: Math.PI },
      ],
      2,
    )

    expect(d.startsWith("M10,0 ")).toBe(true)
    expect(d.match(/Z/g)).toHaveLength(2)
    expect(d).toContain("A3.2,3.2")
  })
})
