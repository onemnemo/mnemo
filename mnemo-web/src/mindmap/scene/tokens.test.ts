import { describe, expect, it } from "vitest"

import { branchColor, branchToken, branchWash, cssColor, mixColor } from "./tokens"

describe("token to CSS", () => {
  it("maps the shared vocabulary onto this app's variables", () => {
    expect(cssColor("accent")).toBe("var(--accent)")
    expect(cssColor("onAccent")).toBe("var(--accent-fg)")
    expect(cssColor("textPrimary")).toBe("var(--ink)")
    expect(cssColor("stroke")).toBe("var(--line)")
  })

  it("maps the palette ramp entry by entry", () => {
    expect(cssColor("palette.1")).toBe("var(--branch-1)")
    expect(cssColor("palette.8")).toBe("var(--branch-8)")
  })

  it("resolves to a variable rather than a colour, so a theme flip needs no re-render", () => {
    expect(cssColor("accent")!.startsWith("var(")).toBe(true)
  })

  it("hands a literal through, because a hand-written template will contain one", () => {
    expect(cssColor("#aa5533")).toBe("#aa5533")
    expect(cssColor("oklch(0.5 0.1 40)")).toBe("oklch(0.5 0.1 40)")
  })

  it("returns nothing for a name it does not know", () => {
    // Nothing rather than a guess: the caller has a better default than this does, and an invalid
    // value would take the whole style attribute down instead of just this property.
    expect(cssColor("chartreuse-ish")).toBeUndefined()
    expect(cssColor("palette.9")).toBeUndefined()
    expect(cssColor(null)).toBeUndefined()
    expect(cssColor("")).toBeUndefined()
  })
})

describe("the branch ramp", () => {
  it("is one-based, matching what the document stores", () => {
    expect(branchToken(0)).toBe("palette.1")
    expect(branchColor(0)).toBe("var(--branch-1)")
  })

  it("wraps past the end rather than running off it", () => {
    expect(branchColor(8)).toBe("var(--branch-1)")
    expect(branchColor(9)).toBe("var(--branch-2)")
  })

  it("wraps a negative index onto a real slot", () => {
    expect(branchColor(-1)).toBe("var(--branch-8)")
  })

  it("has a wash per hue, authored in the theme rather than derived", () => {
    expect(branchWash(2)).toBe("var(--branch-3-wash)")
  })
})

describe("partial strength", () => {
  it("mixes rather than appending an alpha suffix", () => {
    // The colour is a var(); appending "33" to it produces a string CSS silently discards, and the
    // element renders with no ring at all rather than with a wrong one.
    expect(mixColor("var(--branch-3)", 16)).toBe("color-mix(in oklab, var(--branch-3) 16%, transparent)")
  })
})
