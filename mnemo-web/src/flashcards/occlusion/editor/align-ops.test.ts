import { describe, expect, it } from "vitest"

import { alignMasks, canAlign, canDistribute } from "./align-ops"
import { addMask } from "./ops"
import { cardCountOf } from "./cards"
import { groupMasks } from "./group-ops"
import { makeDoc, rect, trio } from "./test-kit"

describe("alignMasks", () => {
  it("lines masks up on the left edge", () => {
    const aligned = alignMasks(trio(), ["a", "b", "c"], "left")
    expect(aligned.masks.map((m) => m.x)).toEqual([0.1, 0.1, 0.1])
  })

  it("aligns the other five slots", () => {
    const ids = ["a", "b", "c"]
    expect(alignMasks(trio(), ids, "right").masks.map((m) => m.x)).toEqual([0.7, 0.7, 0.7])
    expect(alignMasks(trio(), ids, "top").masks.map((m) => m.y)).toEqual([0.1, 0.1, 0.1])
    expect(alignMasks(trio(), ids, "bottom").masks.map((m) => m.y)).toEqual([0.3, 0.3, 0.3])
    expect(alignMasks(trio(), ids, "centerHorizontal").masks.map((m) => m.x)).toEqual([0.4, 0.4, 0.4])
    expect(alignMasks(trio(), ids, "middleVertical").masks.map((m) => m.y)).toEqual([0.2, 0.2, 0.2])
  })

  it("distributes three or more, holding the outer two", () => {
    const uneven = makeDoc(rect("a", 0.1, 0, 0.1, 0.1), rect("b", 0.2, 0, 0.1, 0.1), rect("c", 0.7, 0, 0.1, 0.1))
    const spread = alignMasks(uneven, ["a", "b", "c"], "distributeHorizontal")
    expect(spread.masks.map((m) => m.x)).toEqual([0.1, 0.4, 0.7])
  })

  it("does nothing for distribute with two, and repeats as a no-op", () => {
    const base = trio()
    expect(alignMasks(base, ["a", "b"], "distributeHorizontal")).toBe(base)
    const once = alignMasks(base, ["a", "b", "c"], "left")
    expect(alignMasks(once, ["a", "b", "c"], "left")).toBe(once)
  })

  it("carries a polygon with its box", () => {
    const { document } = addMask(trio(), { shape: "polygon", points: [[0.5, 0.5], [0.7, 0.5], [0.6, 0.7]] }, "p0000001")
    const aligned = alignMasks(document, ["a", "p0000001"], "left")
    const polygon = aligned.masks.find((m) => m.id === "p0000001")!
    expect(polygon.x).toBeCloseTo(0.1, 4)
    expect(polygon.points?.[0][0]).toBeCloseTo(0.1, 4)
  })

  it("reports the minimums", () => {
    expect([canAlign(1), canAlign(2), canDistribute(2), canDistribute(3)]).toEqual([false, true, false, true])
  })
})

describe("aligning groups", () => {
  const twoGroups = () =>
    groupMasks(
      groupMasks(
        makeDoc(
          rect("a", 0.1, 0.1, 0.1, 0.1),
          rect("b", 0.3, 0.3, 0.1, 0.1),
          rect("c", 0.6, 0.2, 0.1, 0.1),
          rect("d", 0.8, 0.5, 0.1, 0.1),
        ),
        ["a", "b"],
      ).document,
      ["c", "d"],
    ).document

  it("moves each group as one box and keeps its layout", () => {
    const aligned = alignMasks(twoGroups(), ["a", "b", "c", "d"], "top")
    const by = (id: string) => aligned.masks.find((m) => m.id === id)!
    expect(by("a").y).toBeCloseTo(0.1, 4)
    expect(by("c").y).toBeCloseTo(0.1, 4)
    expect(by("d").y - by("c").y).toBeCloseTo(0.3, 4)
    expect(by("b").y - by("a").y).toBeCloseTo(0.2, 4)
  })

  it("does nothing for one group", () => {
    const one = groupMasks(trio(), ["a", "b"]).document
    expect(alignMasks(one, ["a", "b"], "left")).toBe(one)
  })

  it("counts cards, not masks", () => {
    expect(cardCountOf(twoGroups(), ["a", "b", "c", "d"])).toBe(2)
    expect(canAlign(cardCountOf(twoGroups(), ["a", "b"]))).toBe(false)
    expect(cardCountOf(trio(), ["a", "b", "c"])).toBe(3)
  })
})
