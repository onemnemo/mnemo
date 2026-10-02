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

  it("reads the arrows that start with left or right as arrows", () => {
    expect(stripMath("$A \\rightarrow B \\leftarrow C$")).toBe("A → B ← C")
    expect(stripMath("$p \\Rightarrow q \\leftrightarrow r$")).toBe("p ⇒ q ↔ r")
  })

  it("drops the sizing commands left and right around a bracket", () => {
    expect(stripMath("$\\left(x\\right)$")).toBe("(x)")
    expect(stripMath("$\\left[ x \\right]$")).toBe("[ x ]")
  })

  it("flattens a fraction nested inside another fraction's argument", () => {
    expect(stripMath("$\\frac{\\frac{a}{b}}{c}$")).toBe("a/b/c")
  })

  it("reads greek letters as their symbols", () => {
    expect(stripMath("$\\alpha \\cdot \\beta$")).toBe("α · β")
  })

  it("lowers and raises scripts that have a Unicode form", () => {
    expect(stripMath("Define $K_m$ and $V_{max}$ for $x^2 + y^{n+1}$")).toBe("Define Kₘ and Vₘₐₓ for x² + yⁿ⁺¹")
  })

  it("marks a script that has no Unicode form plainly rather than gluing it on", () => {
    expect(stripMath("$k_{cat}$ and $e^{i\\pi}$")).toBe("k_(cat) and e^(iπ)")
  })

  it("keeps named functions as their word", () => {
    expect(stripMath("$\\ln x + \\sqrt{2}$")).toBe("ln x + √2")
  })

  it("flattens the spaced dollars an Anki import writes", () => {
    expect(stripMath("$ x^2 $")).toBe("x²")
    expect(stripMath("$ \\frac{RT}{zF} $")).toBe("RT/zF")
  })

  it("reads a ring as composition and a raised ring as degrees", () => {
    expect(stripMath("$f \\circ g$ at $90^\\circ$ or $45^{\\circ}$")).toBe("f ∘ g at 90° or 45°")
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
