import { describe, expect, it } from "vitest"

import { groupMasks } from "./group-ops"
import { hitMask, masksInRect, maskContains, pointToImage, rectBetween } from "./hit"
import { addMask } from "./ops"
import { applySelection, pruneSelection, selectAll, stepCard } from "./selection"
import { makeDoc, rect, trio } from "./test-kit"

describe("selection", () => {
  const grouped = groupMasks(trio(), ["b", "c"]).document

  it("selects all masks in card order", () => {
    expect(selectAll(grouped)).toEqual(["a", "b", "c"])
  })

  it("replaces, adds and toggles by card", () => {
    expect(applySelection(grouped, [], ["c"], "replace")).toEqual(["b", "c"])
    expect(applySelection(grouped, ["a"], ["b"], "add")).toEqual(["a", "b", "c"])
    expect(applySelection(grouped, ["a", "b", "c"], ["c"], "toggle")).toEqual(["a"])
    expect(applySelection(grouped, ["a"], ["c"], "toggle")).toEqual(["a", "b", "c"])
  })

  it("prunes ids that no longer exist", () => {
    expect(pruneSelection(trio(), ["a", "zz", "c"])).toEqual(["a", "c"])
  })

  it("steps to the next and previous card, wrapping", () => {
    expect(stepCard(trio(), [], 1)).toEqual(["a"])
    expect(stepCard(trio(), [], -1)).toEqual(["c"])
    expect(stepCard(trio(), ["a"], 1)).toEqual(["b"])
    expect(stepCard(trio(), ["c"], 1)).toEqual(["a"])
    expect(stepCard(trio(), ["a"], -1)).toEqual(["c"])
  })

  it("steps over a whole group", () => {
    expect(stepCard(grouped, ["a"], 1)).toEqual(["b", "c"])
    expect(stepCard(grouped, ["b", "c"], 1)).toEqual(["a"])
  })

  it("has nothing to step to without masks", () => {
    expect(stepCard(makeDoc(), [], 1)).toEqual([])
  })
})

describe("hit testing", () => {
  it("converts a pointer to image fractions", () => {
    const point = pointToImage({ x: 150, y: 120 }, { left: 50, top: 20 }, { x: 10, y: 0, w: 200, h: 200 })
    expect(point).toEqual([0.45, 0.5])
    expect(pointToImage({ x: 1, y: 1 }, { left: 0, top: 0 }, { x: 0, y: 0, w: 0, h: 0 })).toEqual([0, 0])
  })

  it("tests rectangles, ellipses and polygons", () => {
    const base = makeDoc(rect("r", 0.1, 0.1, 0.2, 0.2), rect("e", 0.5, 0.1, 0.2, 0.2, { shape: "ellipse" }))
    const { document } = addMask(base, { shape: "polygon", points: [[0.1, 0.6], [0.4, 0.6], [0.1, 0.9]] }, "p0000001")
    const [r, e, p] = document.masks

    expect(maskContains(r, [0.15, 0.15])).toBe(true)
    expect(maskContains(r, [0.35, 0.15])).toBe(false)
    expect(maskContains(e, [0.6, 0.2])).toBe(true)
    expect(maskContains(e, [0.51, 0.11])).toBe(false)
    expect(maskContains(p, [0.15, 0.65])).toBe(true)
    expect(maskContains(p, [0.35, 0.85])).toBe(false)
  })

  it("returns the topmost mask", () => {
    const stacked = makeDoc(rect("under", 0.1, 0.1, 0.3, 0.3), rect("over", 0.2, 0.2, 0.3, 0.3))
    expect(hitMask(stacked, [0.3, 0.3])?.id).toBe("over")
    expect(hitMask(stacked, [0.12, 0.12])?.id).toBe("under")
    expect(hitMask(stacked, [0.9, 0.9])).toBeNull()
  })

  it("finds the masks a band touches", () => {
    const band = rectBetween([0.35, 0.05], [0.05, 0.25])
    expect(band).toEqual({ x: 0.05, y: 0.05, w: 0.3, h: 0.2 })
    expect(masksInRect(trio(), band)).toEqual(["a"])
    expect(masksInRect(trio(), { x: 0, y: 0, w: 1, h: 1 })).toEqual(["a", "b", "c"])
  })
})
