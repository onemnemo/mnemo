import { describe, expect, it } from "vitest"

import { boxChanged, MIN_ELEMENT_SIZE, resizeBox } from "./resize"

const ORIGIN = { x: 100, y: 100, width: 200, height: 100 }

describe("a resize", () => {
  it("moves the edges the handle names and leaves the rest alone", () => {
    expect(resizeBox(ORIGIN, "se", 40, 20)).toEqual({ x: 100, y: 100, width: 240, height: 120 })
  })

  it("takes the position with it when the handle is on the far side", () => {
    // The right and bottom edges are where they were: 300 and 200.
    expect(resizeBox(ORIGIN, "nw", 40, 20)).toEqual({ x: 140, y: 120, width: 160, height: 80 })
  })

  it("leaves the other axis untouched from a side handle", () => {
    expect(resizeBox(ORIGIN, "e", 40, 999)).toMatchObject({ y: 100, height: 100 })
    expect(resizeBox(ORIGIN, "n", 999, -30)).toMatchObject({ x: 100, width: 200 })
  })

  it("stops at a floor rather than turning the box inside out", () => {
    const box = resizeBox(ORIGIN, "e", -400, 0)

    expect(box.width).toBe(MIN_ELEMENT_SIZE)
    expect(box.x).toBe(100)
  })

  it("keeps the anchor edge in place at the floor, dragging the other way", () => {
    // Pulled far past its own right edge from the left handle: the box stops, and it stops with its
    // right edge still at 300 rather than sliding on with the pointer.
    const box = resizeBox(ORIGIN, "w", 400, 0)

    expect(box.width).toBe(MIN_ELEMENT_SIZE)
    expect(box.x + box.width).toBe(300)
  })
})

describe("holding the aspect", () => {
  it("scales both axes from a corner, by whichever one was pulled harder", () => {
    // The width doubles, so the height does too, rather than the box growing 200x120.
    expect(resizeBox(ORIGIN, "se", 200, 20, true)).toEqual({ x: 100, y: 100, width: 400, height: 200 })
  })

  it("still anchors the opposite corner", () => {
    const box = resizeBox(ORIGIN, "nw", -200, 0, true)

    expect(box.x + box.width).toBe(300)
    expect(box.y + box.height).toBe(200)
    expect(box.width / box.height).toBeCloseTo(2)
  })

  it("is ignored on a side handle, which has no second axis to hold", () => {
    expect(resizeBox(ORIGIN, "e", 200, 0, true)).toEqual({ x: 100, y: 100, width: 400, height: 100 })
  })

  it("holds the ratio at the floor too", () => {
    const box = resizeBox({ x: 0, y: 0, width: 200, height: 100 }, "se", -500, -500, true)

    expect(box.height).toBe(MIN_ELEMENT_SIZE)
    expect(box.width).toBe(MIN_ELEMENT_SIZE * 2)
  })
})

describe("a committed box", () => {
  it("is not worth writing when it rounds to what is already stored", () => {
    expect(boxChanged(ORIGIN, { ...ORIGIN, width: ORIGIN.width + 0.2 })).toBe(false)
  })

  it("is worth writing when the position moved but the size did not", () => {
    expect(boxChanged(ORIGIN, { ...ORIGIN, x: 99 })).toBe(true)
  })
})
