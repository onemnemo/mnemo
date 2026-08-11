import { describe, expect, it } from "vitest"

import { estimateWidth, FONTS, measureNode, wrapText, type TextMeasurer } from "./measure"

/** One unit per character, so an expected width is arithmetic rather than a font's opinion. */
const perChar: TextMeasurer = (text) => text.length

describe("wrapping", () => {
  it("keeps a short label on one line", () => {
    const wrapped = wrapText("Igneous", { ...FONTS.m, maxWidth: 100 }, perChar)

    expect(wrapped.lines).toEqual(["Igneous"])
    expect(wrapped.width).toBe(7)
  })

  it("breaks at a space once the line no longer fits", () => {
    const wrapped = wrapText("one two three", { ...FONTS.m, maxWidth: 7 }, perChar)

    expect(wrapped.lines).toEqual(["one two", "three"])
  })

  it("reports the widest line, which is what the box has to hold", () => {
    const wrapped = wrapText("aaaa bb", { ...FONTS.m, maxWidth: 4 }, perChar)

    expect(wrapped.lines).toEqual(["aaaa", "bb"])
    expect(wrapped.width).toBe(4)
  })

  it("breaks inside a word too long to fit on any line", () => {
    // One long chemical name should not shove an entire branch sideways.
    const wrapped = wrapText("dichlorodiphenyl", { ...FONTS.m, maxWidth: 5 }, perChar)

    expect(wrapped.lines).toEqual(["dichl", "orodi", "pheny", "l"])
  })

  it("collapses runs of whitespace rather than emitting empty lines", () => {
    expect(wrapText("a   b", { ...FONTS.m, maxWidth: 100 }, perChar).lines).toEqual(["a b"])
  })

  it("gives empty text one empty line, so a box is still a box", () => {
    expect(wrapText("   ", { ...FONTS.m, maxWidth: 100 }, perChar).lines).toEqual([""])
  })
})

describe("node boxes", () => {
  const box = (text: string, over: Partial<Parameters<typeof measureNode>[0]> = {}) =>
    measureNode({ text, shape: "card", fontScale: "m", isRoot: false, ...over }, perChar)

  // Long enough that the minimum-width floor is not what is being measured.
  const long = "abcdefghijklmnopqrstuvwxyz1234"

  it("is the text plus its shape's padding", () => {
    // card padding is 11 either side.
    expect(box(long).width).toBe(30 + 22)
  })

  it("gives a plain node almost no padding, because the words are the node", () => {
    expect(box(long, { shape: "plain" }).width).toBe(30 + 6)
  })

  it("gives a root room whatever shape it was handed", () => {
    expect(box(long, { shape: "plain", isRoot: true }).width).toBe(30 + 32)
  })

  it("floors an empty node at a width that reads as a node", () => {
    // A fresh caret in a ten-pixel box reads as a rendering fault, not as an invitation to type.
    expect(box("").width).toBe(68)
  })

  it("floors a short label well below that, since it has something to show", () => {
    expect(box("a").width).toBe(26)
  })

  it("leaves room for a task's checkbox", () => {
    expect(box("abcd", { isTask: true }).width - box("abcd").width).toBe(20)
  })

  it("leaves room for the chip saying what a collapse hid", () => {
    expect(box("abcd", { isCollapsed: true }).width - box("abcd").width).toBe(24)
  })

  it("grows in height by whole lines", () => {
    const one = box("abcd")
    const two = measureNode(
      { text: "aaaa bbbb", shape: "card", fontScale: "m", isRoot: false },
      (t) => t.length * 30,
    )

    expect(two.lines).toHaveLength(2)
    expect(two.height).toBe(one.height + one.lineHeight)
  })

  it("scales type by the rung the cascade chose, not by anything it measures", () => {
    expect(box("a", { fontScale: "xl" }).font.size).toBeGreaterThan(box("a", { fontScale: "s" }).font.size)
  })
})

describe("the fallback measurer", () => {
  it("grows with the text and with the type size", () => {
    // Not accurate, and not trying to be: it exists so a canvas-less environment still lays out.
    expect(estimateWidth("abcd", 14, 500)).toBeGreaterThan(estimateWidth("ab", 14, 500))
    expect(estimateWidth("abcd", 20, 500)).toBeGreaterThan(estimateWidth("abcd", 14, 500))
  })
})
