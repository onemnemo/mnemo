import { describe, expect, it } from "vitest"

import { placeChild, placeLoose, PLACEMENT_GAP_X, PLACEMENT_GAP_Y } from "./placement"

const box = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height })
const SIZE = { width: 68, height: 30 }

describe("placing a child", () => {
  it("puts a first child beside its parent and level with its middle", () => {
    const at = placeChild(box(0, 0), null, [], SIZE)

    expect(at.x).toBe(100 + PLACEMENT_GAP_X)
    expect(at.y).toBe(5)
  })

  it("stacks the next child under the lowest one there already", () => {
    const parent = box(0, 0)
    const at = placeChild(parent, null, [box(200, 0, 80, 30), box(200, 60, 80, 30)], SIZE)

    expect(at.y).toBe(90 + PLACEMENT_GAP_Y)
  })

  it("keeps growing the way the branch already grows", () => {
    // A child that jumps to the other side of its parent crosses every line in the branch to get
    // there, so the side is inherited rather than fixed.
    const parent = box(-400, 0)
    const at = placeChild(parent, box(0, 0), [], SIZE)

    expect(at.x).toBe(-400 - PLACEMENT_GAP_X - SIZE.width)
  })

  it("grows rightward when the parent sits square above its own parent", () => {
    // Zero offset is a real arrangement, not an impossible one, and it has to resolve to a side.
    expect(placeChild(box(0, -200), box(0, 0), [], SIZE).x).toBe(100 + PLACEMENT_GAP_X)
  })
})

describe("placing a loose node", () => {
  it("starts at the origin on an empty map", () => {
    expect(placeLoose([])).toEqual({ x: 0, y: 0 })
  })

  it("goes clear to the right of everything else", () => {
    expect(placeLoose([box(0, 0), box(300, 40)])).toEqual({ x: 400 + PLACEMENT_GAP_X, y: 0 })
  })
})
