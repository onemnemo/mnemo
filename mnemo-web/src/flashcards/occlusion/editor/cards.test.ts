import { describe, expect, it } from "vitest"

import { buildOcclusionUnits } from "../../facts/occlusion"
import { cardCountOf, cardList, cardOf, drawOrder, expandToCards, isExactlyOneGroup, normalizeOrder } from "./cards"
import { selectAll } from "./selection"
import { idsInOrder, makeDoc, rect, trio } from "./test-kit"

describe("cardList", () => {
  it("numbers single masks and groups from card order", () => {
    const document = makeDoc(
      rect("a", 0, 0, 0.1, 0.1, { label: "One" }),
      rect("b", 0.2, 0, 0.1, 0.1, { group: "b", label: "Two" }),
      rect("c", 0.4, 0, 0.1, 0.1),
      rect("d", 0.6, 0, 0.1, 0.1, { group: "b", label: "Three" }),
    )
    const cards = cardList(document)
    expect(cards.map((c) => [c.number, c.key, c.ids, c.label, c.grouped])).toEqual([
      [1, "ma", ["a"], "One", false],
      [2, "mb", ["b", "d"], "Two, Three", true],
      [3, "mc", ["c"], "", false],
    ])
  })

  it("agrees with the generator units", () => {
    const document = makeDoc(
      rect("a", 0, 0, 0.1, 0.1, { group: "g" }),
      rect("b", 0.2, 0, 0.1, 0.1),
      rect("c", 0.4, 0, 0.1, 0.1, { group: "g" }),
    )
    expect(cardList(document).map((c) => c.key)).toEqual(buildOcclusionUnits(document).units.map((u) => u.key))
  })

  it("keeps a lone member of a group as a grouped card", () => {
    const [card] = cardList(makeDoc(rect("a", 0, 0, 0.1, 0.1, { group: "gone" })))
    expect(card.key).toBe("mgone")
    expect(card.grouped).toBe(true)
  })
})

describe("selection helpers", () => {
  const grouped = makeDoc(
    rect("a", 0, 0, 0.1, 0.1, { group: "a" }),
    rect("b", 0.2, 0, 0.1, 0.1),
    rect("c", 0.4, 0, 0.1, 0.1, { group: "a" }),
  )

  it("expands a mask to its whole card", () => {
    expect(expandToCards(grouped, ["c"])).toEqual(["a", "c"])
    expect(expandToCards(grouped, ["b"])).toEqual(["b"])
  })

  it("finds the card of a mask", () => {
    expect(cardOf(cardList(grouped), "c")?.key).toBe("ma")
    expect(cardOf(cardList(grouped), "zz")).toBeUndefined()
  })

  it("knows when the selection is exactly one group", () => {
    expect(isExactlyOneGroup(grouped, ["a", "c"])).toBe(true)
    expect(isExactlyOneGroup(grouped, ["a"])).toBe(false)
    expect(isExactlyOneGroup(grouped, ["a", "b", "c"])).toBe(false)
  })

  it("draws later cards above earlier ones", () => {
    expect(drawOrder(grouped).map((m) => m.id)).toEqual(["a", "c", "b"])
  })
})

describe("normalizeOrder", () => {
  it("makes a group's members contiguous without changing card order", () => {
    const document = makeDoc(
      rect("a", 0, 0, 0.1, 0.1, { group: "a" }),
      rect("b", 0.2, 0, 0.1, 0.1),
      rect("c", 0.4, 0, 0.1, 0.1, { group: "a" }),
    )
    const normalized = normalizeOrder(document)
    expect(idsInOrder(normalized)).toEqual(["a", "c", "b"])
    expect(cardList(normalized).map((c) => c.key)).toEqual(cardList(document).map((c) => c.key))
  })

  it("returns the same document when nothing moves", () => {
    const document = trio()
    expect(normalizeOrder(document)).toBe(document)
  })
})

describe("a group down to one mask", () => {
  const lone = makeDoc(rect("b", 0.2, 0, 0.1, 0.1, { group: "a" }), rect("c", 0.4, 0, 0.1, 0.1))

  it("can still be ungrouped", () => {
    expect(isExactlyOneGroup(lone, ["b"])).toBe(true)
    expect(isExactlyOneGroup(lone, ["c"])).toBe(false)
    expect(isExactlyOneGroup(lone, [])).toBe(false)
  })
})

describe("masks whose card the generator dropped", () => {
  // Group label x on one mask and a separate mask with id x claim the same key.
  const clashing = makeDoc(rect("a", 0, 0, 0.1, 0.1, { group: "x" }), rect("x", 0.2, 0, 0.1, 0.1))

  it("are still drawn, selectable and counted", () => {
    expect(buildOcclusionUnits(clashing).collisions).toEqual(["mx"])
    expect(drawOrder(clashing).map((m) => m.id)).toEqual(["a", "x"])
    expect(selectAll(clashing)).toEqual(["a", "x"])
    expect(expandToCards(clashing, ["x"])).toEqual(["x"])
    expect(cardCountOf(clashing, ["a", "x"])).toBe(2)
  })
})
