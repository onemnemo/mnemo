import { describe, expect, it } from "vitest"

import { BRANCH_MATERIALS, edgeDefaultsFor, materialOf } from "./material"

describe("branch material", () => {
  it("reads back every material it writes", () => {
    for (const entry of BRANCH_MATERIALS) {
      expect(materialOf(edgeDefaultsFor(entry.value))).toBe(entry.value)
    }
  })

  it("draws a map that never chose one as a line", () => {
    expect(materialOf(null)).toBe("line")
    expect(materialOf(undefined)).toBe("line")
    expect(materialOf({})).toBe("line")
  })

  it("writes both fields whichever material is picked", () => {
    // Defaults are merged onto whatever the canvas already carries, so a material that only named
    // the field it changed would leave the other one behind from the material before it and produce
    // a combination nobody picked.
    for (const entry of BRANCH_MATERIALS) {
      const written = edgeDefaultsFor(entry.value)
      expect(written.widthProfile).toBeDefined()
      expect(written.routing).toBeDefined()
    }
  })

  it("keeps a taper a taper whatever it is routed along", () => {
    // A taper can follow any of the three routes, so the width profile is what names it.
    expect(materialOf({ widthProfile: "taper", routing: "orthogonal" })).toBe("taper")
  })
})
