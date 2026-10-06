import { describe, expect, it } from "vitest"

import { backCell, backPreview, frontPreview, oneLine, typeMarker } from "./cards"

describe("frontPreview", () => {
  it("masks a cloze deletion", () => {
    expect(frontPreview("The {{c1::mitochondria}} is the powerhouse")).toBe(
      "The […] is the powerhouse",
    )
  })

  it("reads inline maths out flat rather than leaving the delimiters", () => {
    expect(frontPreview("The ratio is $\\frac{RT}{zF}$")).toBe("The ratio is RT/zF")
  })

  it("collapses whitespace runs to a single space", () => {
    expect(frontPreview("line one\n\nline two")).toBe("line one line two")
  })
})

describe("oneLine", () => {
  it("leaves ordinary text untouched", () => {
    expect(oneLine("plain text")).toBe("plain text")
  })

  it("collapses every whitespace run, including newlines, to one space", () => {
    expect(oneLine("a\n\n  b\tc")).toBe("a b c")
  })
})

describe("frontPreview with maths", () => {
  it("reads a subscripted formula the way it is said, not as LaTeX source", () => {
    expect(frontPreview("Define $K_m$ and $V_{max}$.")).toBe("Define Kₘ and Vₘₐₓ.")
  })

  it("flattens the spaced dollars an Anki import writes", () => {
    expect(frontPreview("Square $ x^2 $ and $ \\frac{RT}{zF} $")).toBe("Square x² and RT/zF")
  })
})

describe("backPreview", () => {
  it("shows the words behind the format bar's markers on one line", () => {
    expect(backPreview("**Tokyo**\n- ==capital==\n- `since 1868`")).toBe("Tokyo capital since 1868")
  })
})

describe("frontPreview with formatting", () => {
  it("drops the markers as well as the cloze answer", () => {
    expect(frontPreview("The **capital** of {{c1::Japan}}")).toBe("The capital of […]")
  })
})

describe("typeMarker", () => {
  it("marks a cloze card with braces and an occlusion card with an image, named for assistive tech", () => {
    expect(typeMarker("cloze")).toEqual({ icon: "braces", labelKey: null })
    expect(typeMarker("occlusion")).toEqual({ icon: "image", labelKey: "CardTypeOcclusion" })
  })

  it("leaves a plain card unmarked", () => {
    expect(typeMarker("classic")).toBeNull()
  })
})

describe("backCell", () => {
  it("shows the label of an occlusion card, or No label when the mask has none", () => {
    expect(backCell("occlusion", "Rough ER", "No label")).toBe("Rough ER")
    expect(backCell("occlusion", "  ", "No label")).toBe("No label")
  })

  it("leaves an empty back empty on every other kind of card", () => {
    expect(backCell("classic", "", "No label")).toBe("")
    expect(backCell("cloze", "", "No label")).toBe("")
  })
})

