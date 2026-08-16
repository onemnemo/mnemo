import { describe, expect, it } from "vitest"

import { elementsInRect, intersects, rectBetween } from "./marquee"

const box = (id: string, x: number, y: number, width = 100, height = 40) => ({ id, x, y, width, height })

describe("the band", () => {
  it("normalizes whichever way it was dragged", () => {
    const forward = rectBetween({ x: 10, y: 10 }, { x: 50, y: 30 })
    const backward = rectBetween({ x: 50, y: 30 }, { x: 10, y: 10 })

    expect(forward).toEqual({ x: 10, y: 10, width: 40, height: 20 })
    expect(backward).toEqual(forward)
  })
})

describe("what it catches", () => {
  it("catches what it touches rather than only what it surrounds", () => {
    // A sweep across a row of siblings is shorter than the nodes in it, and containment would
    // return nothing with no way to tell why.
    const rect = { x: 0, y: 20, width: 400, height: 4 }
    expect(elementsInRect(rect, [box("a", 0, 0), box("b", 200, 0)])).toEqual(["a", "b"])
  })

  it("does not catch a box it only shares an edge with", () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, box("a", 10, 0))).toBe(false)
  })

  it("misses what is beyond it", () => {
    expect(elementsInRect({ x: 0, y: 0, width: 50, height: 50 }, [box("a", 300, 300)])).toEqual([])
  })
})
