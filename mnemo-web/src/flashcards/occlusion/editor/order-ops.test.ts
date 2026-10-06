import { describe, expect, it } from "vitest"

import { cardList } from "./cards"
import { groupMasks } from "./group-ops"
import { moveCardTo, moveEarlier, moveLater } from "./order-ops"
import { idsInOrder, makeDoc, rect, trio } from "./test-kit"

function five() {
  return makeDoc(...["a", "b", "c", "d", "e"].map((id, i) => rect(id, i / 10, 0, 0.05, 0.05)))
}

describe("moveEarlier and moveLater", () => {
  it("moves a card one place", () => {
    expect(idsInOrder(moveEarlier(trio(), ["c"]))).toEqual(["a", "c", "b"])
    expect(idsInOrder(moveLater(trio(), ["a"]))).toEqual(["b", "a", "c"])
  })

  it("stops at the ends without changing anything", () => {
    const base = trio()
    expect(moveEarlier(base, ["a"])).toBe(base)
    expect(moveLater(base, ["c"])).toBe(base)
  })

  it("slides a selected run together and stops it at the end", () => {
    expect(idsInOrder(moveEarlier(five(), ["c", "d"]))).toEqual(["a", "c", "d", "b", "e"])
    expect(idsInOrder(moveEarlier(five(), ["a", "b"]))).toEqual(["a", "b", "c", "d", "e"])
    expect(idsInOrder(moveLater(five(), ["d", "e"]))).toEqual(["a", "b", "c", "d", "e"])
  })

  it("moves a group as one unit", () => {
    const grouped = groupMasks(five(), ["b", "c"]).document
    expect(cardList(grouped).map((c) => c.ids)).toEqual([["a"], ["b", "c"], ["d"], ["e"]])
    const later = moveLater(grouped, ["b"])
    expect(cardList(later).map((c) => c.ids)).toEqual([["a"], ["d"], ["b", "c"], ["e"]])
    expect(cardList(later).map((c) => c.key)).toEqual(["ma", "md", "mb", "me"])
  })

  it("never changes a key", () => {
    const keys = cardList(five()).map((c) => c.key).sort()
    expect(cardList(moveEarlier(five(), ["e"])).map((c) => c.key).sort()).toEqual(keys)
  })
})

describe("moveCardTo", () => {
  it("drags a card to an index", () => {
    expect(idsInOrder(moveCardTo(five(), "a", 3))).toEqual(["b", "c", "d", "a", "e"])
    expect(idsInOrder(moveCardTo(five(), "e", 0))).toEqual(["e", "a", "b", "c", "d"])
  })

  it("clamps the index and ignores unknown ids", () => {
    expect(idsInOrder(moveCardTo(five(), "a", 99)).at(-1)).toBe("a")
    const base = five()
    expect(moveCardTo(base, "zz", 1)).toBe(base)
    expect(moveCardTo(base, "c", 2)).toBe(base)
  })

  it("moves a grouped card by any member", () => {
    const grouped = groupMasks(five(), ["a", "b"]).document
    expect(cardList(moveCardTo(grouped, "b", 2)).map((c) => c.ids)).toEqual([["c"], ["d"], ["a", "b"], ["e"]])
  })
})
