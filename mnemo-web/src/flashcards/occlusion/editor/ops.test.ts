import { describe, expect, it } from "vitest"

import { buildOcclusionUnits, OCCLUSION_MAX_MASKS, OCCLUSION_MAX_POINTS } from "../../facts/occlusion"
import { createMinter } from "./ids"
import {
  addMask,
  deleteMasks,
  duplicateMasks,
  moveMasks,
  movePoint,
  nudgeMasks,
  renameMask,
  resizeMask,
  setBox,
  setMode,
} from "./ops"
import { makeDoc, rect, sequence, trio } from "./test-kit"

const SIZE = { w: 1000, h: 500 }

function triangle() {
  return addMask(makeDoc(), { shape: "polygon", points: [[0.2, 0.2], [0.4, 0.2], [0.3, 0.4]] }, "p0000001").document
}

describe("addMask", () => {
  it("appends a rectangle as the last card", () => {
    const { document, ids } = addMask(trio(), { shape: "rect", x: 0.5, y: 0.5, w: 0.2, h: 0.1 }, "newone01")
    expect(ids).toEqual(["newone01"])
    expect(document.masks.at(-1)).toMatchObject({ id: "newone01", shape: "rect", x: 0.5, order: 3 })
  })

  it("clamps to the image and rounds to four decimals", () => {
    const { document } = addMask(makeDoc(), { shape: "ellipse", x: 0.9, y: -0.2, w: 0.5, h: 0.123456 }, "e0000001")
    expect(document.masks[0]).toMatchObject({ shape: "ellipse", x: 0.9, y: 0, w: 0.1, h: 0.1235 })
  })

  it("refuses a shape with no area", () => {
    const base = trio()
    expect(addMask(base, { shape: "rect", x: 0.5, y: 0.5, w: 0, h: 0.2 }, "x0000001")).toEqual({ document: base, ids: [] })
  })

  it("derives a polygon box from its points", () => {
    expect(triangle().masks[0]).toMatchObject({ shape: "polygon", x: 0.2, y: 0.2, w: 0.2, h: 0.2 })
  })

  it("needs three points and keeps at most the point cap", () => {
    const base = makeDoc()
    expect(addMask(base, { shape: "polygon", points: [[0, 0], [1, 1]] }, "p0000001").ids).toEqual([])

    const many = Array.from({ length: OCCLUSION_MAX_POINTS + 20 }, (_, i): [number, number] => [(i % 10) / 10, Math.floor(i / 10) / 20])
    const { document } = addMask(base, { shape: "polygon", points: many }, "p0000002")
    expect(document.masks[0].points).toHaveLength(OCCLUSION_MAX_POINTS)
  })

  it("stops at the mask cap", () => {
    const full = makeDoc(...Array.from({ length: OCCLUSION_MAX_MASKS }, (_, i) => rect(`m${i}`, 0, 0, 0.1, 0.1)))
    expect(addMask(full, { shape: "rect", x: 0, y: 0, w: 0.1, h: 0.1 }, "extra001").ids).toEqual([])
  })

  it("setBox resizes a mask drawn so far", () => {
    const { document } = addMask(makeDoc(), { shape: "rect", x: 0.1, y: 0.1, w: 0.01, h: 0.01 }, "r0000001")
    expect(setBox(document, "r0000001", { x: 0.1, y: 0.1, w: 0.3, h: 0.2 }).masks[0]).toMatchObject({ w: 0.3, h: 0.2 })
  })
})

describe("moveMasks", () => {
  it("moves by a delta", () => {
    expect(moveMasks(trio(), ["a"], 0.1, 0.05).masks[0]).toMatchObject({ x: 0.2, y: 0.15 })
  })

  it("keeps the whole selection inside the image", () => {
    const moved = moveMasks(trio(), ["a", "c"], 0.5, 0)
    expect(moved.masks.find((m) => m.id === "c")?.x).toBeCloseTo(0.9, 4)
    expect(moved.masks.find((m) => m.id === "a")?.x).toBeCloseTo(0.3, 4)
  })

  it("moves a polygon's points with its box", () => {
    const moved = moveMasks(triangle(), ["p0000001"], 0.1, 0.1).masks[0]
    expect(moved.points).toEqual([[0.3, 0.3], [0.5, 0.3], [0.4, 0.5]])
    expect(moved).toMatchObject({ x: 0.3, y: 0.3 })
  })

  it("returns the same document for a zero move or unknown ids", () => {
    const base = trio()
    expect(moveMasks(base, ["a"], 0, 0)).toBe(base)
    expect(moveMasks(base, ["zz"], 0.1, 0.1)).toBe(base)
  })
})

describe("nudgeMasks", () => {
  it("converts screen pixels to image fractions", () => {
    expect(nudgeMasks(trio(), ["a"], 1, 0, SIZE).masks[0].x).toBeCloseTo(0.101, 4)
    expect(nudgeMasks(trio(), ["a"], 10, 0, SIZE).masks[0].x).toBeCloseTo(0.11, 4)
    expect(nudgeMasks(trio(), ["a"], 0, 10, SIZE).masks[0].y).toBeCloseTo(0.12, 4)
  })

  it("does nothing before the image has a size", () => {
    const base = trio()
    expect(nudgeMasks(base, ["a"], 1, 0, { w: 0, h: 0 })).toBe(base)
  })
})

describe("resizeMask", () => {
  const options = { size: SIZE, minPx: 6 }

  it("drags the east edge", () => {
    expect(resizeMask(trio(), "a", "e", 50, 0, options).masks[0]).toMatchObject({ x: 0.1, w: 0.15 })
  })

  it("moves the west edge and keeps the east", () => {
    const resized = resizeMask(trio(), "a", "w", -50, 0, options).masks[0]
    expect(resized.x).toBeCloseTo(0.05, 4)
    expect(resized.w).toBeCloseTo(0.15, 4)
  })

  it("stops at the minimum size instead of flipping", () => {
    const resized = resizeMask(trio(), "a", "e", -500, 0, options).masks[0]
    expect(resized.w).toBeCloseTo(6 / 1000, 4)
  })

  it("stays inside the image", () => {
    const resized = resizeMask(trio(), "c", "se", 900, 900, options).masks[2]
    expect(resized.x + resized.w).toBeLessThanOrEqual(1)
    expect(resized.y + resized.h).toBeLessThanOrEqual(1)
  })

  it("leaves a polygon alone", () => {
    const document = triangle()
    expect(resizeMask(document, "p0000001", "e", 40, 0, options)).toBe(document)
  })
})

describe("movePoint", () => {
  it("moves one vertex and refits the box", () => {
    const moved = movePoint(triangle(), "p0000001", 2, [0.3, 0.6]).masks[0]
    expect(moved.points?.[2]).toEqual([0.3, 0.6])
    expect(moved).toMatchObject({ y: 0.2, h: 0.4 })
  })

  it("ignores a bad index and clamps to the image", () => {
    const document = triangle()
    expect(movePoint(document, "p0000001", 9, [0, 0])).toBe(document)
    expect(movePoint(document, "p0000001", 0, [-1, 2]).masks[0].points?.[0]).toEqual([0, 1])
  })

  it("refuses a move that flattens the polygon to no height", () => {
    const flat = movePoint(triangle(), "p0000001", 2, [0.3, 0.2])
    expect(flat.masks[0].points?.[2]).toEqual([0.3, 0.4])
    expect(flat.masks[0].h).toBeGreaterThan(0)
  })
})

describe("renameMask and setMode", () => {
  it("sets, trims and clears a label", () => {
    const named = renameMask(trio(), "a", "  Rough ER ")
    expect(named.masks[0].label).toBe("Rough ER")
    expect("label" in renameMask(named, "a", "  ").masks[0]).toBe(false)
  })

  it("returns the same document when nothing changes", () => {
    const base = trio()
    expect(renameMask(base, "a", "")).toBe(base)
    expect(setMode(base, "hideAll")).toBe(base)
    expect(setMode(base, "hideOne").mode).toBe("hideOne")
  })
})

describe("deleteMasks", () => {
  it("removes masks and leaves a group label on the rest", () => {
    const base = makeDoc(rect("a", 0, 0, 0.1, 0.1, { group: "a" }), rect("b", 0.2, 0, 0.1, 0.1, { group: "a" }))
    const left = deleteMasks(base, ["a"])
    expect(left.masks).toHaveLength(1)
    expect(left.masks[0].group).toBe("a")
  })

  it("is a no-op for unknown ids", () => {
    const base = trio()
    expect(deleteMasks(base, ["zz"])).toBe(base)
  })
})

describe("duplicateMasks", () => {
  const draws = [...Array(8).fill(0.5 / 36), ...Array(8).fill(3.5 / 36), ...Array(8).fill(9.5 / 36), ...Array(8).fill(20.5 / 36)]
  const mint = () => createMinter(trio(), [], sequence(draws))

  it("makes offset copies with new ids at the end, labels kept", () => {
    const base = makeDoc(rect("a", 0.1, 0.1, 0.1, 0.1, { label: "Keep" }), rect("b", 0.4, 0.2, 0.1, 0.1))
    const { document, ids } = duplicateMasks(base, ["a"], mint())
    expect(ids).toHaveLength(1)
    const copy = document.masks.find((m) => m.id === ids[0])!
    expect(copy).toMatchObject({ label: "Keep", order: 2 })
    expect(copy.x).toBeCloseTo(0.12, 4)
    expect(copy.y).toBeCloseTo(0.12, 4)
    expect(base.masks).toHaveLength(2)
  })

  it("makes a copied group a new group named for its first copy", () => {
    const base = makeDoc(rect("a", 0.1, 0.1, 0.1, 0.1, { group: "a" }), rect("b", 0.4, 0.2, 0.1, 0.1, { group: "a" }))
    const { document, ids } = duplicateMasks(base, ["a", "b"], mint())
    expect(ids).toHaveLength(2)
    const copies = document.masks.slice(2)
    expect(copies.map((m) => m.group)).toEqual([ids[0], ids[0]])
    expect(copies[0].group).not.toBe("a")
    expect(buildOcclusionUnits(document).units.map((u) => u.key)).toEqual(["ma", `m${ids[0]}`])
  })

  it("copies one member of a group as a plain mask", () => {
    const base = makeDoc(rect("a", 0.1, 0.1, 0.1, 0.1, { group: "a" }), rect("b", 0.4, 0.2, 0.1, 0.1, { group: "a" }))
    const { document } = duplicateMasks(base, ["a"], mint())
    expect(document.masks[2].group).toBeUndefined()
  })

  it("moves the copy back when there is no room to the right or below", () => {
    const base = makeDoc(rect("a", 0.9, 0.9, 0.1, 0.1))
    const { document, ids } = duplicateMasks(base, ["a"], mint())
    const copy = document.masks.find((m) => m.id === ids[0])!
    expect(copy.x).toBeCloseTo(0.88, 4)
    expect(copy.y).toBeCloseTo(0.88, 4)
  })

  it("makes all copies or none at the cap", () => {
    const full = makeDoc(...Array.from({ length: OCCLUSION_MAX_MASKS }, (_, i) => rect(`m${i}`, 0, 0, 0.1, 0.1)))
    expect(duplicateMasks(full, ["m0"], mint()).ids).toEqual([])
  })
})

describe("review fixes", () => {
  it("steps one quantum when a nudge would round to nothing", () => {
    const wide = { w: 40_000, h: 20_000 }
    expect(nudgeMasks(trio(), ["a"], 1, 0, wide).masks[0].x).toBe(0.1001)
    expect(nudgeMasks(trio(), ["a"], -1, 0, wide).masks[0].x).toBe(0.0999)
  })

  it("floors only the axes a side handle moves", () => {
    const thin = makeDoc(rect("t", 0.1, 0.1, 0.2, 0.004))
    const resized = resizeMask(thin, "t", "e", 40, 0, { size: SIZE, minPx: 6 }).masks[0]
    expect(resized.h).toBe(0.004)
    expect(resized.w).toBeCloseTo(0.24, 3)
  })

  it("keeps the aspect lock when the box meets the image edge", () => {
    const edge = makeDoc(rect("e", 0.8, 0.4, 0.1, 0.2))
    const resized = resizeMask(edge, "e", "se", 600, 600, { size: SIZE, minPx: 6, lockAspect: true }).masks[0]
    expect(resized.x + resized.w).toBeLessThanOrEqual(1)
    expect((resized.w * SIZE.w) / (resized.h * SIZE.h)).toBeCloseTo((0.1 * SIZE.w) / (0.2 * SIZE.h), 2)
  })

  it("keeps x plus w inside the image after rounding", () => {
    const { document } = addMask(makeDoc(), { shape: "rect", x: 0.33333, y: 0.1, w: 0.9, h: 0.1 }, "r0000001")
    expect(document.masks[0].x + document.masks[0].w).toBeLessThanOrEqual(1 + 1e-9)
    const resized = resizeMask(trio(), "c", "e", 5000, 0, { size: SIZE, minPx: 6 }).masks[2]
    expect(resized.x + resized.w).toBeLessThanOrEqual(1 + 1e-9)
  })
})
