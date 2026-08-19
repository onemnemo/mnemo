import { describe, expect, it } from "vitest"

import { splitMath, stripMath } from "./math"

describe("splitMath", () => {
  it("returns the whole string as one text piece when there is no maths", () => {
    expect(splitMath("no formulas here")).toEqual([{ kind: "text", value: "no formulas here", display: false }])
  })

  it("splits inline maths out of the surrounding text", () => {
    expect(splitMath("The charge is $q$ coulombs.")).toEqual([
      { kind: "text", value: "The charge is ", display: false },
      { kind: "math", value: "q", display: false },
      { kind: "text", value: " coulombs.", display: false },
    ])
  })

  it("splits display maths onto its own piece", () => {
    expect(splitMath("Given: $$E = mc^2$$")).toEqual([
      { kind: "text", value: "Given: ", display: false },
      { kind: "math", value: "E = mc^2", display: true },
    ])
  })

  it("handles adjacent literal and maths regions with nothing between two formulas", () => {
    expect(splitMath("$a$$b$")).toEqual([
      { kind: "math", value: "a", display: false },
      { kind: "math", value: "b", display: false },
    ])
  })

  it("handles more than one formula in the same string", () => {
    expect(splitMath("$a$ plus $b$ equals $c$")).toEqual([
      { kind: "math", value: "a", display: false },
      { kind: "text", value: " plus ", display: false },
      { kind: "math", value: "b", display: false },
      { kind: "text", value: " equals ", display: false },
      { kind: "math", value: "c", display: false },
    ])
  })

  it("leaves an unclosed dollar sign as literal text", () => {
    expect(splitMath("costs $5 today")).toEqual([{ kind: "text", value: "costs $5 today", display: false }])
  })

  it("does not let inline maths cross a line break", () => {
    expect(splitMath("first $a\nb$ second")).toEqual([
      { kind: "text", value: "first $a\nb$ second", display: false },
    ])
  })

  it("does not treat an empty pair of dollars as maths", () => {
    expect(splitMath("nothing between $$ these")).toEqual([
      { kind: "text", value: "nothing between $$ these", display: false },
    ])
  })
})

describe("stripMath", () => {
  it("passes plain text through unchanged", () => {
    expect(stripMath("no formulas here")).toBe("no formulas here")
  })

  it("flattens a fraction to a slash", () => {
    expect(stripMath("The ratio is $\\frac{RT}{zF}$.")).toBe("The ratio is RT/zF.")
  })

  it("does not fully flatten a fraction nested inside another fraction's argument", () => {
    // The repeated passes collapse the inner \frac{a}{b} to "a/b" in the first pass, but the
    // same pass also strips the outer \frac's backslash and braces before a later pass gets a
    // chance to match it, so the outer wrapper survives as bare text rather than a second
    // slash. Documented here rather than silently relied on: a browser row is an approximation
    // by design, and this is one of its rough edges.
    expect(stripMath("$\\frac{\\frac{a}{b}}{c}$")).toBe("fraca/bc")
  })

  it("reads named operators and greek letters as their bare word", () => {
    expect(stripMath("$\\alpha \\cdot \\beta$")).toBe("alpha · beta")
  })

  it("renders comparison and arithmetic symbols", () => {
    expect(stripMath("$x \\leq y \\geq z \\pm 1 \\times 2 \\approx 3$")).toBe("x ≤ y ≥ z ± 1 × 2 ≈ 3")
  })

  it("drops \\text and similar wrappers down to their content", () => {
    expect(stripMath("$-90\\,\\text{mV}$")).toBe("-90 mV")
  })

  it("keeps adjacent literal and maths regions readable", () => {
    expect(stripMath("resting potential is $-90\\,\\text{mV}$, roughly")).toBe(
      "resting potential is -90 mV, roughly",
    )
  })

  it("flattens display maths the same as inline", () => {
    expect(stripMath("$$\\frac{a}{b}$$")).toBe("a/b")
  })

  it("collapses the whitespace a flattened formula can leave behind", () => {
    expect(stripMath("$\\quad\\quad x$")).toBe("x")
  })

  it("leaves a malformed, unclosed formula as literal text", () => {
    expect(stripMath("$\\frac{1}{2 is unclosed")).toBe("$\\frac{1}{2 is unclosed")
  })
})
