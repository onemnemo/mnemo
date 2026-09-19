import { describe, expect, it } from "vitest"

import { defaultTextStyle, type InlineSpan, type TextStyle } from "@/notes/model/types"

import { sliceRuns, type Fragment } from "./rich-text"

const text = (value: string, style: Partial<TextStyle> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

/** The pieces of a line as text with the one flag that matters to the case. */
const flat = (line: Fragment[], flag: keyof Omit<Fragment, "text">) => line.map((piece) => [piece.text, piece[flag]])

describe("sliceRuns", () => {
  it("hands each character of a line the style of the run it came from, folded by style", () => {
    const lines = sliceRuns([text("Buy "), text("milk", { bold: true }), text(" now")], ["Buy milk now"])
    expect(flat(lines[0], "bold")).toEqual([
      ["Buy ", false],
      ["milk", true],
      [" now", false],
    ])
  })

  it("carries a run across a line break, so a bold phrase stays bold on both lines", () => {
    const lines = sliceRuns([text("aaaa bbbb", { bold: true })], ["aaaa", "bbbb"])
    expect(flat(lines[0], "bold")).toEqual([["aaaa", true]])
    expect(flat(lines[1], "bold")).toEqual([["bbbb", true]])
  })

  it("stands one space in a line for a whole run of whitespace in the runs", () => {
    const lines = sliceRuns([text("a  \n\t b", { italic: true })], ["a b"])
    expect(flat(lines[0], "italic")).toEqual([["a b", true]])
  })

  it("follows a word broken mid-word by the wrap", () => {
    const lines = sliceRuns([text("abc", { underline: true }), text("def")], ["ab", "cd", "ef"])
    expect(flat(lines[0], "underline")).toEqual([["ab", true]])
    expect(flat(lines[1], "underline")).toEqual([
      ["c", true],
      ["d", false],
    ])
    expect(flat(lines[2], "underline")).toEqual([["ef", false]])
  })

  it("spells an atom as its plain projection and marks it italic", () => {
    const lines = sliceRuns(
      [
        text("a "),
        { kind: "equation", latex: "x^2", style: { ...defaultTextStyle } },
        text(" and "),
        { kind: "fraction", numerator: 1, denominator: 2, style: { ...defaultTextStyle } },
      ],
      ["a x^2 and 1/2"],
    )
    expect(flat(lines[0], "italic")).toEqual([
      ["a ", false],
      ["x^2", true],
      [" and ", false],
      ["1/2", true],
    ])
  })

  it("draws a line that did not come from the runs plain rather than dropping it", () => {
    const lines = sliceRuns([text("abc", { bold: true })], ["xyz"])
    expect(flat(lines[0], "bold")).toEqual([["xyz", false]])
  })

  it("gives an empty line no pieces", () => {
    expect(sliceRuns([text("")], [""])).toEqual([[]])
  })

  it("keeps a chosen colour and a link apart from the plain pieces around them", () => {
    const lines = sliceRuns([text("a", { foregroundColor: "swatch5" }), text("b", { linkUrl: "https://x" }), text("c")], ["abc"])
    expect(lines[0].map((piece) => [piece.text, piece.swatch, piece.link])).toEqual([
      ["a", "swatch5", false],
      ["b", null, true],
      ["c", null, false],
    ])
  })
})
