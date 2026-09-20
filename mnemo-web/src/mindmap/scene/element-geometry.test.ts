import { describe, expect, it } from "vitest"

import { lineLabelPoint, pointOnRotatedBoxToward } from "./element-geometry"

describe("rotated box perimeter", () => {
  it("intersects the edge facing the target point", () => {
    const point = pointOnRotatedBoxToward({ x: 400, y: 0, width: 100, height: 40 }, 90, { x: 50, y: 20 })

    expect(point.x).toBeCloseTo(430)
    expect(point.y).toBeCloseTo(20)
  })
})

describe("line labels", () => {
  it("sits at the middle of a horizontal line", () => {
    const point = lineLabelPoint({ start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, bend: null })

    expect(point).toEqual({ x: 50, y: 0 })
  })

  it("does not move when the line's ends are reversed", () => {
    const point = lineLabelPoint({ start: { x: 100, y: 0 }, end: { x: 0, y: 0 }, bend: null })

    expect(point).toEqual({ x: 50, y: 0 })
  })

  it("stays at the middle as the line angle changes", () => {
    const point = lineLabelPoint({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, bend: null })

    expect(point).toEqual({ x: 50, y: 50 })
  })

  it("follows the middle of a curve without flipping sides", () => {
    const point = lineLabelPoint(
      { start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, bend: { x: 50, y: -40 } },
    )

    expect(point).toEqual({ x: 50, y: -20 })
  })
})
