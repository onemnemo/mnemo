import { describe, expect, it } from "vitest"

import { angleAt, cornerInCanvas, normalizeDeg, resizeRotated, rotatedBounds, snapDeg } from "./rotate"

const BOX = { x: 100, y: 100, width: 200, height: 100 }

describe("an angle", () => {
  it("reads clockwise from due right, the way the screen turns", () => {
    expect(angleAt({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0)
    expect(angleAt({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(90)
  })

  it("wraps into a turn and snaps to a step", () => {
    expect(normalizeDeg(-30)).toBe(330)
    expect(normalizeDeg(725)).toBe(5)
    expect(snapDeg(38)).toBe(45)
    expect(snapDeg(-4)).toBe(0)
  })
})

describe("a turned box", () => {
  it("has bounds that swap its sides at a right angle", () => {
    const bounds = rotatedBounds(BOX, 90)

    expect(bounds.x).toBeCloseTo(150)
    expect(bounds.y).toBeCloseTo(50)
    expect(bounds.width).toBeCloseTo(100)
    expect(bounds.height).toBeCloseTo(200)
  })

  it("is its own bounds when it has not turned", () => {
    expect(rotatedBounds(BOX, 0)).toBe(BOX)
  })
})

describe("resizing a turned box", () => {
  it("is the plain resize when there is no turn", () => {
    expect(resizeRotated(BOX, "se", 10, 20, 0)).toEqual({ x: 100, y: 100, width: 210, height: 120 })
  })

  it("keeps the corner opposite the grip exactly where it was on the canvas", () => {
    const degrees = 30
    const before = cornerInCanvas(BOX, 0, 0, degrees)

    const resized = resizeRotated(BOX, "se", 25, -10, degrees)
    const after = cornerInCanvas(resized, 0, 0, degrees)

    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
    expect(resized.width).not.toBe(BOX.width)
  })

  it("reads the pointer in the box's own frame, so pulling along a turned edge widens it", () => {
    const resized = resizeRotated(BOX, "e", 0, 40, 90)

    expect(resized.width).toBeCloseTo(240)
    expect(resized.height).toBeCloseTo(100)
  })
})
