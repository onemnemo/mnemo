import { describe, expect, it } from "vitest"

import { clearsAnything, restyled } from "./restyle"

describe("restyling", () => {
  it("keeps what the patch does not mention", () => {
    expect(restyled({ line: "dashed", color: "palette.3" }, { color: null })).toEqual({ line: "dashed" })
  })

  it("takes away only the member that was nulled", () => {
    const next = restyled({ color: "palette.3", thickness: 2.5 }, { color: null })

    expect(next).not.toHaveProperty("color")
    expect(next?.thickness).toBe(2.5)
  })

  it("sets and clears in the same patch, since a control may do both at once", () => {
    expect(restyled({ color: "palette.3" }, { color: null, line: "dotted" })).toEqual({ line: "dotted" })
  })

  it("reports nothing left rather than an empty style", () => {
    // An edge with an empty style still has one, and a style is what the cascade stops at. The
    // reset has to hand the edge back to its branch, which means having no style at all.
    expect(restyled({ color: "palette.3" }, { color: null })).toBeUndefined()
  })

  it("survives an edge that never had a style", () => {
    expect(restyled(null, { color: null })).toBeUndefined()
    expect(restyled(undefined, { line: "solid" })).toEqual({ line: "solid" })
  })

  it("does the same arithmetic for an element, which clears its colour the same way", () => {
    // Handing a node's colour back to its branch means having no stroke at all, and the shape and
    // size it was also given have to survive that.
    expect(restyled({ stroke: "palette.4", nodeShape: "pill" }, { stroke: null })).toEqual({
      nodeShape: "pill",
    })
    expect(restyled({ stroke: "palette.4" }, { stroke: null })).toBeUndefined()
  })
})

describe("spotting a removal", () => {
  it("is what tells a merge apart from a replacement", () => {
    expect(clearsAnything({ color: null })).toBe(true)
    expect(clearsAnything({ color: "palette.2" })).toBe(false)
    expect(clearsAnything({})).toBe(false)
  })
})
