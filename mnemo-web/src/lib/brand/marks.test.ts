import { describe, expect, it } from "vitest"

import { bandStops, DEFAULT_LOGO, LOGO_IDS, resolveLogo } from "./marks"

describe("resolveLogo", () => {
  it("keeps every offered logo", () => {
    for (const id of LOGO_IDS) expect(resolveLogo(id)).toBe(id)
  })

  it("falls back to Sunset for absent or unknown values", () => {
    expect(DEFAULT_LOGO).toBe("sunset")
    expect(resolveLogo(undefined)).toBe("sunset")
    expect(resolveLogo("avares://Mnemo.UI/Assets/AppIcons/AppIconDawn.ico")).toBe("sunset")
  })
})

describe("bandStops", () => {
  it("splits four colours at 30, 50 and 70 percent with hard stops", () => {
    expect(bandStops(["a", "b", "c", "d"]).map((s) => `${s.offset}${s.color}`)).toEqual([
      "0a", "0.3a", "0.3b", "0.5b", "0.5c", "0.7c", "0.7d", "1d",
    ])
  })

  it("splits three colours at thirds", () => {
    expect(bandStops(["a", "b", "c"]).map((s) => s.offset)).toEqual([0, 0.367, 0.367, 0.633, 0.633, 1])
  })

  it("reverses the bands for dark surfaces", () => {
    expect(bandStops(["a", "b", "c"], true).map((s) => s.color)).toEqual(["c", "c", "b", "b", "a", "a"])
  })
})
