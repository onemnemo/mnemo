import { describe, expect, it } from "vitest"

import { defaultTextStyle, type InlineSpan } from "@/notes/model/types"

import { canHoldRuns, flattenRuns, plainRuns, runsKey, sameRuns, trimRuns, withRuns } from "./runs"

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

describe("runsKey", () => {
  it("is one string for one run list, whatever order the style fields were written in", () => {
    const style = { ...defaultTextStyle, bold: true, linkUrl: "https://x" }
    const reversed = Object.fromEntries(Object.entries(style).reverse()) as unknown as InlineSpan["style"]
    expect(runsKey([{ kind: "text", text: "a", style: reversed }])).toBe(runsKey([{ kind: "text", text: "a", style }]))
  })

  it("tells apart every way two lists can differ", () => {
    const keys = [
      [text("a")],
      [text("b")],
      [text("a", { bold: true })],
      [text("a", { italic: true })],
      [text("a", { foregroundColor: "swatch1" })],
      [text("a"), text("b")],
      [text("ab")],
      [{ kind: "equation", latex: "a", style: { ...defaultTextStyle } } as InlineSpan],
      [{ kind: "fraction", numerator: 1, denominator: 2, style: { ...defaultTextStyle } } as InlineSpan],
      [text("a;"), text("b")],
      [text("a"), text(";b")],
    ].map(runsKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("treats a field left out as the default it stands for", () => {
    const sparse = { kind: "text", text: "a", style: { bold: true } } as unknown as InlineSpan
    expect(runsKey([sparse])).toBe(runsKey([text("a", { bold: true })]))
  })
})

describe("trimRuns", () => {
  it("strips the whitespace a label opens and closes on, and drops a run that was only that", () => {
    expect(trimRuns([text(" "), text(" a ", { bold: true }), text("b "), text("\n")])).toEqual([
      text("a ", { bold: true }),
      text("b"),
    ])
  })

  it("never touches an atom or the inside of the label", () => {
    const eq: InlineSpan = { kind: "equation", latex: "x", style: { ...defaultTextStyle } }
    expect(trimRuns([text(" "), eq, text(" a b "), eq])).toEqual([eq, text(" a b "), eq])
  })

  it("leaves the runs it was given alone", () => {
    const runs = [text(" a ")]
    trimRuns(runs)
    expect(runs).toEqual([text(" a ")])
  })
})

describe("canHoldRuns and withRuns", () => {
  it("is the four label kinds and the math row that reads as one", () => {
    expect(canHoldRuns({ $type: "text" })).toBe(true)
    expect(canHoldRuns({ $type: "task" })).toBe(true)
    expect(canHoldRuns({ $type: "shape" })).toBe(true)
    expect(canHoldRuns({ $type: "freeText" })).toBe(true)
    expect(canHoldRuns({ $type: "math" })).toBe(true)
    expect(canHoldRuns({ $type: "code" })).toBe(false)
    expect(canHoldRuns({ $type: "link", url: "https://a" })).toBe(false)
    expect(canHoldRuns({ $type: "frame" })).toBe(false)
  })

  it("writes the runs beside their plain projection and keeps the rest", () => {
    expect(withRuns({ $type: "shape", shape: "diamond", text: "old" }, [text("new", { italic: true })])).toEqual({
      $type: "shape",
      shape: "diamond",
      text: "new",
      runs: [text("new", { italic: true })],
    })
  })

  it("turns a math row into the text node it reads as", () => {
    const eq: InlineSpan = { kind: "equation", latex: "y", style: { ...defaultTextStyle } }
    expect(withRuns({ $type: "math", latex: "x" }, [eq])).toEqual({ $type: "text", text: "y", runs: [eq] })
  })

  it("answers null for a kind that cannot hold runs", () => {
    expect(withRuns({ $type: "code", source: "x" }, [text("x")])).toBeNull()
  })
})
