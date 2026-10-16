import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { flattenMath, splitMath } from "./math"

type Pieces = ["text" | "math" | "display", string][]
type SplitCase = { name: string; input: string; pieces: Pieces }
type AnkiCase = { field: string; card: string; pieces: Pieces }

const { cases, anki } = JSON.parse(
  readFileSync(
    new URL("../../../Mnemo.Infrastructure.Tests/Flashcards/Fixtures/math-split.json", import.meta.url),
    "utf8",
  ),
) as { cases: SplitCase[]; anki: AnkiCase[] }

const read = (source: string) =>
  splitMath(source).map((p) => [p.kind === "text" ? "text" : p.display ? "display" : "math", p.value])

describe("splitMath shared vectors", () => {
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(read(c.input)).toEqual(c.pieces)
  })

  it.each(anki.map((c) => [c.field, c] as const))("reads what an Anki import stores for %s", (_field, c) => {
    expect(read(c.card)).toEqual(c.pieces)
  })
})

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

describe("flattenMath", () => {
  it("reads one formula flat and trims the spaces an import leaves", () => {
    expect(flattenMath(" \\frac{a}{b} ")).toBe("a/b")
  })
})
