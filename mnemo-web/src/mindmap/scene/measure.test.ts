import { describe, expect, it } from "vitest"

import { defaultTextStyle, type InlineSpan } from "@/notes/model/types"

import {
  estimateRuns,
  estimateWidth,
  FONTS,
  measureNode,
  measurersFrom,
  wrapText,
  type Measurers,
  type TextMeasurer,
} from "./measure"

/** One unit per character, so an expected width is arithmetic rather than a font's opinion. */
const perChar: TextMeasurer = (text) => text.length

/** The same one for text and for source, so a code box is arithmetic too. */
const unit = measurersFrom(perChar)

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
    measureNode({ text, shape: "card", fontScale: "m", isRoot: false, ...over }, unit)

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
      measurersFrom((t) => t.length * 30),
    )

    expect(two.lines).toHaveLength(2)
    expect(two.height).toBe(one.height + one.lineHeight)
  })

  it("scales type by the rung the cascade chose, not by anything it measures", () => {
    expect(box("a", { fontScale: "xl" }).font.size).toBeGreaterThan(box("a", { fontScale: "s" }).font.size)
  })
})

describe("a formatted label's box", () => {
  const text = (value: string, style: Partial<InlineSpan["style"]> = {}): InlineSpan => ({
    kind: "text",
    text: value,
    style: { ...defaultTextStyle, ...style },
  })

  /** A rich measurer that answers a fixed box, so what the node adds around it is arithmetic. */
  const stub = (width: number, height: number): Measurers => ({
    text: perChar,
    mono: perChar,
    rich: () => ({ width, height }),
  })

  const runs = [text("Hello "), text("world", { bold: true })]

  it("is the rendered box plus the shape's padding, not the words' width", () => {
    const box = measureNode({ text: "Hello world", shape: "card", fontScale: "m", isRoot: false, body: "rich", runs }, stub(50, 30))
    expect(box.width).toBe(50 + 22)
    expect(box.height).toBe(30 + 14)
  })

  it("leaves room for a task's checkbox, a reference's mark, its badge and a collapse chip, as a label does", () => {
    const plain = { text: "Hello world", shape: "card" as const, fontScale: "m" as const, isRoot: false, body: "rich" as const, runs }
    const base = measureNode(plain, stub(50, 30)).width

    expect(measureNode({ ...plain, isTask: true }, stub(50, 30)).width).toBe(base + 20)
    expect(measureNode({ ...plain, isRef: true }, stub(50, 30)).width).toBe(base + 20)
    expect(measureNode({ ...plain, badge: "12" }, stub(50, 30)).width).toBe(base + 2 + 10)
    expect(measureNode({ ...plain, isCollapsed: true }, stub(50, 30)).width).toBe(base + 24)
  })

  it("keeps the lines of its plain words, so every reader of lines keeps reading", () => {
    const box = measureNode(
      { text: "aaaa bbbb", shape: "card", fontScale: "m", isRoot: false, body: "rich", runs: [text("aaaa "), text("bbbb", { bold: true })] },
      { text: (t) => t.length * 30, mono: perChar, rich: () => ({ width: 50, height: 30 }) },
    )
    expect(box.lines).toEqual(["aaaa", "bbbb"])
    expect(box.lineHeight).toBe(Math.round(FONTS.m.size * 1.35))
  })

  it("rounds the rendered box up, since a box a fraction short wraps a line the rendering did not", () => {
    const box = measureNode({ text: "Hello world", shape: "card", fontScale: "m", isRoot: false, body: "rich", runs }, stub(50.2, 29.6))
    expect(box.width).toBe(51 + 22)
    expect(box.height).toBe(30 + 14)
  })

  it("is measured as a plain label when no runs came with the request", () => {
    const rich = measureNode({ text: "Hello world", shape: "card", fontScale: "m", isRoot: false, body: "rich" }, stub(50, 30))
    const label = measureNode({ text: "Hello world", shape: "card", fontScale: "m", isRoot: false }, stub(50, 30))
    expect(rich).toEqual(label)
  })

  it("estimates, with no rendering to hand, as the plain words wrapped the way a label's are", () => {
    const estimate = estimateRuns(perChar)
    const label = wrapText("Hello world", FONTS.m, perChar)
    expect(estimate(runs, FONTS.m)).toEqual({ width: label.width, height: label.lines.length * Math.round(FONTS.m.size * 1.35) })
    expect(measurersFrom(perChar).rich(runs, FONTS.m)).toEqual(estimate(runs, FONTS.m))
  })
})

describe("the fallback measurer", () => {
  it("grows with the text and with the type size", () => {
    // Not accurate, and not trying to be: it exists so a canvas-less environment still lays out.
    expect(estimateWidth("abcd", 14, 500)).toBeGreaterThan(estimateWidth("ab", 14, 500))
    expect(estimateWidth("abcd", 20, 500)).toBeGreaterThan(estimateWidth("abcd", 14, 500))
  })
})
