import { describe, expect, it } from "vitest"

import { isValidOcclusionId, OCCLUSION_MAX_MASKS } from "../../facts/occlusion"
import { createMinter, ID_LENGTH, roomForMasks, takenIds } from "./ids"
import { makeDoc, rect, sequence } from "./test-kit"

describe("createMinter", () => {
  it("makes valid ids of at least eight characters", () => {
    const mint = createMinter(makeDoc())
    for (let i = 0; i < 50; i++) {
      const id = mint()
      expect(id.length).toBeGreaterThanOrEqual(8)
      expect(isValidOcclusionId(id)).toBe(true)
    }
    expect(ID_LENGTH).toBeGreaterThanOrEqual(8)
  })

  it("never repeats itself", () => {
    const mint = createMinter(makeDoc())
    const ids = new Set(Array.from({ length: 500 }, () => mint()))
    expect(ids.size).toBe(500)
  })

  it("skips ids and group labels already in the document", () => {
    const document = makeDoc(rect("aaaaaaaa", 0, 0, 0.1, 0.1), rect("b", 0.2, 0, 0.1, 0.1, { group: "bbbbbbbb" }))
    const draws = [...Array(8).fill(0.5 / 36), ...Array(8).fill(1.5 / 36), ...Array(8).fill(18.5 / 36)]
    const mint = createMinter(document, [], sequence(draws))
    expect(takenIds(document)).toEqual(new Set(["aaaaaaaa", "b", "bbbbbbbb"]))
    expect(mint()).toBe("ssssssss")
  })

  it("does not hand out an id the session has already retired", () => {
    const mint = createMinter(makeDoc(), ["aaaaaaaa"], sequence([...Array(8).fill(0.5 / 36), ...Array(8).fill(18.5 / 36)]))
    expect(mint()).toBe("ssssssss")
  })
})

describe("roomForMasks", () => {
  it("stops at the mask cap", () => {
    const masks = Array.from({ length: OCCLUSION_MAX_MASKS }, (_, i) => rect(`m${i}`, 0, 0, 0.1, 0.1))
    expect(roomForMasks(makeDoc(...masks.slice(0, OCCLUSION_MAX_MASKS - 1)))).toBe(true)
    expect(roomForMasks(makeDoc(...masks))).toBe(false)
  })
})
