import { describe, expect, it } from "vitest"

import { frontPreview, oneLine } from "./cards"

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
