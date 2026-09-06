import { describe, expect, it } from "vitest"

import { parseCardText, type CardInline } from "./card-format"

/** The blocks flattened to a readable shape, so an expectation reads like the card does. */
function shape(source: string): unknown {
  return parseCardText(source).map((block) =>
    block.kind === "list" ? { list: block.items.map(inline) } : { text: inline(block.content) },
  )
}

function inline(nodes: CardInline[]): unknown[] {
  return nodes.map((node) => {
    if (node.kind === "text") return node.value
    if (node.kind === "math") return { math: node.value, display: node.display }
    return { [node.mark]: inline(node.children) }
  })
}

function one(source: string): unknown[] {
  const blocks = parseCardText(source)
  expect(blocks).toHaveLength(1)
  const block = blocks[0]
  if (block.kind !== "text") throw new Error("expected a text block")
  return inline(block.content)
}

describe("parseCardText markers", () => {
  it("reads each of the format bar's markers", () => {
    expect(one("**b**")).toEqual([{ bold: ["b"] }])
    expect(one("*i*")).toEqual([{ italic: ["i"] }])
    expect(one("__u__")).toEqual([{ underline: ["u"] }])
    expect(one("`c`")).toEqual([{ code: ["c"] }])
    expect(one("==h==")).toEqual([{ highlight: ["h"] }])
  })

  it("keeps the text around a marker in the same run", () => {
    expect(one("say **loud** now")).toEqual(["say ", { bold: ["loud"] }, " now"])
  })

  it("nests one marker inside another", () => {
    expect(one("**bold *and* more**")).toEqual([{ bold: ["bold ", { italic: ["and"] }, " more"] }])
  })

  it("keeps two runs of the same marker separate rather than joining them", () => {
    expect(one("**a** and **b**")).toEqual([{ bold: ["a"] }, " and ", { bold: ["b"] }])
  })
})

describe("parseCardText literals", () => {
  it("leaves a lone marker alone", () => {
    expect(one("5 * 3")).toEqual(["5 * 3"])
    expect(one("a `quote")).toEqual(["a `quote"])
  })

  it("leaves a pair with spaces on the inside alone, so arithmetic survives", () => {
    expect(one("5 * 3 * 2")).toEqual(["5 * 3 * 2"])
    expect(one("a == b == c")).toEqual(["a == b == c"])
  })

  it("leaves an empty pair alone", () => {
    expect(one("****")).toEqual(["****"])
  })

  it("leaves a marker that never closes alone", () => {
    expect(one("**start of a thought")).toEqual(["**start of a thought"])
  })

  it("does not format inside a code span", () => {
    expect(one("`a **b** c`")).toEqual([{ code: ["a **b** c"] }])
  })
})

describe("parseCardText maths", () => {
  it("keeps a formula whole rather than reading markers into it", () => {
    expect(one("$5 * 3$")).toEqual([{ math: "5 * 3", display: false }])
  })

  it("wraps a formula in a marker", () => {
    expect(one("**$E=mc^2$**")).toEqual([{ bold: [{ math: "E=mc^2", display: false }] }])
  })

  it("pairs markers that sit either side of a formula", () => {
    expect(one("**a $x$ b**")).toEqual([{ bold: ["a ", { math: "x", display: false }, " b"] }])
  })

  it("keeps display maths as its own piece", () => {
    expect(one("$$E = mc^2$$")).toEqual([{ math: "E = mc^2", display: true }])
  })

  it("shows a formula inside a code span as the source it is", () => {
    expect(one("`$x$`")).toEqual([{ code: ["$x$"] }])
  })
})

describe("parseCardText blocks", () => {
  it("keeps plain text with newlines as one run", () => {
    expect(one("first\nsecond\nthird")).toEqual(["first\nsecond\nthird"])
  })

  it("keeps a blank line inside a run rather than splitting it", () => {
    expect(one("first\n\nsecond")).toEqual(["first\n\nsecond"])
  })

  it("gathers consecutive bullet lines into one list", () => {
    expect(shape("- one\n- two\n- three")).toEqual([{ list: [["one"], ["two"], ["three"]] }])
  })

  it("formats and typesets inside a bullet", () => {
    expect(shape("- **a** and $x$")).toEqual([
      { list: [[{ bold: ["a"] }, " and ", { math: "x", display: false }]] },
    ])
  })

  it("keeps the text before and after a list out of it", () => {
    expect(shape("Because:\n- one\n- two\nThat is all")).toEqual([
      { text: ["Because:"] },
      { list: [["one"], ["two"]] },
      { text: ["That is all"] },
    ])
  })

  it("drops the empty line the bullet button leaves in front of a new list", () => {
    expect(shape("\n- one")).toEqual([{ list: [["one"]] }])
  })

  it("does not read a hyphen mid-line as a bullet", () => {
    expect(one("a - b")).toEqual(["a - b"])
  })

  it("never throws, whatever the input", () => {
    for (const input of ["", "*", "***", "`` ", "==", "__", "$", "$$", "- ", "\n\n\n", "**$**"]) {
      expect(() => parseCardText(input)).not.toThrow()
    }
  })
})
