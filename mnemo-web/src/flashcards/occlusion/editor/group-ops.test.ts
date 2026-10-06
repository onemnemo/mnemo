import { describe, expect, it } from "vitest"

import { buildOcclusionUnits } from "../../facts/occlusion"
import { cardList } from "./cards"
import { groupMasks, ungroupMasks } from "./group-ops"
import { idsInOrder, makeDoc, rect, trio } from "./test-kit"

const keysOf = (document: Parameters<typeof cardList>[0]) => cardList(document).map((card) => card.key)

describe("groupMasks", () => {
  it("labels the group with the id of the first member in card order", () => {
    const { document, ids } = groupMasks(trio(), ["c", "a"])
    expect(document.masks.filter((m) => m.group).map((m) => [m.id, m.group])).toEqual([["a", "a"], ["c", "a"]])
    expect(ids).toEqual(["a", "c"])
    expect(keysOf(document)).toEqual(["ma", "mb"])
  })

  it("keeps the first member key and history, and retires the others", () => {
    const before = keysOf(trio())
    const after = keysOf(groupMasks(trio(), ["a", "b", "c"]).document)
    expect(before).toEqual(["ma", "mb", "mc"])
    expect(after).toEqual(["ma"])
  })

  it("places the group where its first member was and makes members contiguous", () => {
    const base = makeDoc(rect("a", 0, 0, 0.1, 0.1), rect("b", 0.2, 0, 0.1, 0.1), rect("c", 0.4, 0, 0.1, 0.1), rect("d", 0.6, 0, 0.1, 0.1))
    const { document } = groupMasks(base, ["b", "d"])
    expect(idsInOrder(document)).toEqual(["a", "b", "d", "c"])
    expect(keysOf(document)).toEqual(["ma", "mb", "mc"])
  })

  it("merging groups keeps the label of the group whose first member comes first", () => {
    const base = makeDoc(
      rect("a", 0, 0, 0.1, 0.1, { group: "second" }),
      rect("b", 0.2, 0, 0.1, 0.1, { group: "first" }),
      rect("c", 0.4, 0, 0.1, 0.1, { group: "first" }),
      rect("d", 0.6, 0, 0.1, 0.1, { group: "second" }),
    )
    const { document } = groupMasks(base, ["c", "d"])
    expect(new Set(document.masks.map((m) => m.group))).toEqual(new Set(["second"]))
    expect(keysOf(document)).toEqual(["msecond"])
  })

  it("merges a single mask into a group by taking the earlier label", () => {
    const base = makeDoc(rect("a", 0, 0, 0.1, 0.1), rect("b", 0.2, 0, 0.1, 0.1, { group: "g" }), rect("c", 0.4, 0, 0.1, 0.1, { group: "g" }))
    const { document } = groupMasks(base, ["a", "b"])
    expect(new Set(document.masks.map((m) => m.group))).toEqual(new Set(["a"]))
    expect(buildOcclusionUnits(document).collisions).toEqual([])
  })

  it("needs two cards", () => {
    const base = trio()
    expect(groupMasks(base, ["a"]).document).toBe(base)
    const grouped = groupMasks(base, ["a", "b"]).document
    expect(groupMasks(grouped, ["a", "b"]).ids).toEqual([])
  })
})

describe("ungroupMasks", () => {
  it("lets the first member keep the card and sends the rest back to cards of their own", () => {
    const grouped = groupMasks(trio(), ["a", "b", "c"]).document
    const { document, ids } = ungroupMasks(grouped, ["b"])
    expect(document.masks.every((m) => m.group === undefined)).toBe(true)
    expect(keysOf(document)).toEqual(["ma", "mb", "mc"])
    expect(ids.sort()).toEqual(["a", "b", "c"])
  })

  it("renames the lowest member to the label when its anchor is gone", () => {
    const grouped = makeDoc(rect("b", 0.2, 0, 0.1, 0.1, { group: "gone" }), rect("c", 0.4, 0, 0.1, 0.1, { group: "gone" }))
    const { document, ids } = ungroupMasks(grouped, ["b", "c"])
    expect(document.masks.map((m) => m.id)).toEqual(["gone", "c"])
    expect(ids).toEqual(["gone", "c"])
    expect(keysOf(document)).toEqual(["mgone", "mc"])
  })

  it("does not rename onto an id another mask holds", () => {
    const grouped = makeDoc(
      rect("b", 0.2, 0, 0.1, 0.1, { group: "c" }),
      rect("c", 0.4, 0, 0.1, 0.1, { group: "c" }),
    )
    const { document } = ungroupMasks(grouped, ["b"])
    expect(document.masks.map((m) => m.id).sort()).toEqual(["b", "c"])
    expect(buildOcclusionUnits(document).collisions).toEqual([])
  })

  it("is unchanged when nothing selected is grouped", () => {
    const base = trio()
    expect(ungroupMasks(base, ["a"]).document).toBe(base)
  })

  it("keeps card order when members were stored apart", () => {
    const base = makeDoc(
      rect("a", 0, 0, 0.1, 0.1, { group: "a" }),
      rect("b", 0.2, 0, 0.1, 0.1),
      rect("c", 0.4, 0, 0.1, 0.1, { group: "a" }),
    )
    expect(idsInOrder(ungroupMasks(base, ["a"]).document)).toEqual(["a", "c", "b"])
  })
})

describe("grouping never makes colliding keys", () => {
  it("holds across a run of group and ungroup steps", () => {
    let document = makeDoc(...Array.from({ length: 6 }, (_, i) => rect(`m${i}`, i / 10, 0, 0.05, 0.05)))
    const steps: [string, string[]][] = [
      ["group", ["m0", "m1"]],
      ["group", ["m2", "m3"]],
      ["group", ["m1", "m2"]],
      ["ungroup", ["m3"]],
      ["group", ["m5", "m4"]],
      ["ungroup", ["m4", "m0"]],
    ]
    for (const [kind, ids] of steps) {
      const result = kind === "group" ? groupMasks(document, ids) : ungroupMasks(document, ids)
      document = result.document
      expect(buildOcclusionUnits(document).collisions).toEqual([])
      expect(document.masks).toHaveLength(6)
    }
  })
})
