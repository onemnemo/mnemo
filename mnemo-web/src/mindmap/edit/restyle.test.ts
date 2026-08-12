import { describe, expect, it } from "vitest"

import { clearsAnything, restyledEdge } from "./restyle"

describe("restyling an edge", () => {
  it("keeps what the patch does not mention", () => {
    expect(restyledEdge({ line: "dashed", color: "palette.3" }, { color: null })).toEqual({ line: "dashed" })
  })

  it("takes away only the member that was nulled", () => {
    const next = restyledEdge({ color: "palette.3", thickness: 2.5 }, { color: null })

    expect(next).not.toHaveProperty("color")
    expect(next?.thickness).toBe(2.5)
  })

  it("sets and clears in the same patch, since a control may do both at once", () => {
    expect(restyledEdge({ color: "palette.3" }, { color: null, line: "dotted" })).toEqual({ line: "dotted" })
  })

  it("reports nothing left rather than an empty style", () => {
    // An edge with an empty style still has one, and a style is what the cascade stops at. The
    // reset has to hand the edge back to its branch, which means having no style at all.
    expect(restyledEdge({ color: "palette.3" }, { color: null })).toBeUndefined()
  })

  it("survives an edge that never had a style", () => {
    expect(restyledEdge(null, { color: null })).toBeUndefined()
    expect(restyledEdge(undefined, { line: "solid" })).toEqual({ line: "solid" })
  })
})

describe("spotting a removal", () => {
  it("is what tells a merge apart from a replacement", () => {
    expect(clearsAnything({ color: null })).toBe(true)
    expect(clearsAnything({ color: "palette.2" })).toBe(false)
    expect(clearsAnything({})).toBe(false)
  })
})
