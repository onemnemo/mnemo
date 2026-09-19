import { describe, expect, it } from "vitest"

import { defaultTextStyle, type InlineSpan } from "@/notes/model/types"

import { flattenRuns, plainRuns, sameRuns } from "./runs"

const text = (value: string, style: Partial<InlineSpan["style"]> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

describe("flattenRuns", () => {
  // These four are the server's projection rule; a change on one side has to land on the other.
  it("spells text as itself, an equation as its source, a fraction as n over d", () => {
    const runs: InlineSpan[] = [
      text("a"),
      { kind: "equation", latex: "x^2", style: { ...defaultTextStyle } },
      text("b\nc", { bold: true }),
      { kind: "fraction", numerator: 1, denominator: 2, style: { ...defaultTextStyle } },
    ]
    expect(flattenRuns(runs)).toBe("ax^2b\nc1/2")
  })

  it("is empty for no runs", () => {
    expect(flattenRuns([])).toBe("")
  })
})

describe("plainRuns", () => {
  it("is one unstyled run", () => {
    expect(plainRuns("hi")).toEqual([text("hi")])
    expect(flattenRuns(plainRuns("hi"))).toBe("hi")
  })
})

describe("sameRuns", () => {
  it("compares by value, not by reference", () => {
    expect(sameRuns([text("a", { bold: true })], [text("a", { bold: true })])).toBe(true)
  })

  it("sees a style change", () => {
    expect(sameRuns([text("a")], [text("a", { italic: true })])).toBe(false)
  })

  it("sees a different atom", () => {
    const eq = (latex: string): InlineSpan => ({ kind: "equation", latex, style: { ...defaultTextStyle } })
    expect(sameRuns([eq("x")], [eq("y")])).toBe(false)
    expect(sameRuns([eq("x")], [text("x")])).toBe(false)
  })

  it("sees a length change", () => {
    expect(sameRuns([text("a")], [text("a"), text("b")])).toBe(false)
  })
})
