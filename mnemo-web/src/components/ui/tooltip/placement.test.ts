import { describe, expect, it } from "vitest"

import { placeTooltip } from "./placement"

const VIEWPORT = { width: 1000, height: 700 }
const OPTIONS = { offset: 8, padding: 8 }
const TIP = { width: 100, height: 30 }

/** A 28px control, positioned by its top-left corner. */
function control(x: number, y: number) {
  return { x, y, width: 28, height: 28 }
}

describe("placeTooltip", () => {
  it("centres above the anchor on the preferred side", () => {
    const placement = placeTooltip(control(400, 300), TIP, VIEWPORT, "top", OPTIONS)

    expect(placement).toEqual({ x: 400 + 14 - 50, y: 300 - 30 - 8, side: "top" })
  })

  it("flips below when there is no room above", () => {
    const placement = placeTooltip(control(400, 10), TIP, VIEWPORT, "top", OPTIONS)

    expect(placement.side).toBe("bottom")
    expect(placement.y).toBe(10 + 28 + 8)
  })

  it("keeps the preferred side when neither fits", () => {
    const tall = { width: 100, height: 400 }
    const placement = placeTooltip(control(400, 300), tall, { width: 1000, height: 420 }, "top", OPTIONS)

    expect(placement.side).toBe("top")
  })

  it("shifts along the edge rather than running off it", () => {
    const placement = placeTooltip(control(970, 300), TIP, VIEWPORT, "top", OPTIONS)

    expect(placement.x).toBe(1000 - 100 - 8)
  })

  it("centres beside the anchor on a horizontal side", () => {
    const placement = placeTooltip(control(400, 300), TIP, VIEWPORT, "right", OPTIONS)

    expect(placement).toEqual({ x: 400 + 28 + 8, y: 300 + 14 - 15, side: "right" })
  })

  it("flips a horizontal side against the near edge", () => {
    const placement = placeTooltip(control(20, 300), TIP, VIEWPORT, "left", OPTIONS)

    expect(placement.side).toBe("right")
    expect(placement.x).toBe(20 + 28 + 8)
  })
})
