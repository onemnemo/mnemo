// @vitest-environment jsdom

/**
 * The box a live-editing field grows into: what a node measures at for some text, and whether its
 * stored size is still the one its own label measures to.
 *
 * Pinned against a synthetic one-unit-per-character measurer, the way scene/measure.test.ts pins
 * `measureNode`, rather than against `sceneMeasurers()`'s own canvas fallback: the point is to check
 * `measureFor` against arithmetic, not to check the production measurer against itself.
 */

import { describe, expect, it, vi } from "vitest"

vi.mock("../scene/measurers", () => ({
  sceneMeasurers: () => ({
    text: (text: string) => text.length,
    mono: (text: string) => text.length,
    math: (latex: string) => ({ width: latex.length, height: 10 }),
  }),
}))

import { isAutoSized, measureFor } from "./live-box"
import type { ElementContent, SceneElement } from "../model/scene"

function element(content: ElementContent, over: Partial<SceneElement> = {}): SceneElement {
  return {
    id: "n1",
    kind: "node",
    content,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    depth: 0,
    branch: -1,
    nodeShape: "card",
    text: { lines: [""], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
    padding: { x: 11, y: 7 },
    isRoot: false,
    childCount: 0,
    hiddenCount: 0,
    ...over,
  }
}

describe("measureFor", () => {
  it("is the text plus a card's own padding, floored so a short label still reads as a box", () => {
    // card padding is 11 either side; "Hello" is 5 units under the one-unit measurer.
    const measured = measureFor(element({ $type: "text", text: "Hello" }), "Hello")
    expect(measured.width).toBe(5 + 22)
    expect(measured.height).toBe(19 + 14) // one line at the 'm' rung, card's y padding either side.
  })

  it("gives a root more room than a card, whatever its own shape says", () => {
    const measured = measureFor(element({ $type: "text" }, { isRoot: true }), "Hi")
    expect(measured.width).toBe(2 + 32) // root padding is 16 either side.
  })

  it("leaves room for the checkbox on a task", () => {
    const measured = measureFor(element({ $type: "task" }), "Buy milk")
    expect(measured.width).toBe(8 + 22 + 20)
  })

  it("leaves room for the leading mark on a reference", () => {
    const measured = measureFor(element({ $type: "link", url: "https://x" }), "Deck")
    expect(measured.width).toBe(4 + 22 + 20)
  })

  it("leaves room for a resolved reference's trailing badge", () => {
    const measured = measureFor(element({ $type: "link", url: "https://x" }, { refBadge: "12" }), "Deck")
    // ref mark (20) plus the badge's own width (2) and its gap (10).
    expect(measured.width).toBe(4 + 22 + 20 + 2 + 10)
  })

  it("leaves room for the hidden-count chip on a collapsed node", () => {
    const measured = measureFor(element({ $type: "text" }, { collapsed: true }), "Topic")
    expect(measured.width).toBe(5 + 22 + 24)
  })

  it("floors an empty label wider than a short one, so a fresh caret still reads as a node", () => {
    const measured = measureFor(element({ $type: "text" }), "")
    expect(measured.width).toBe(68)
  })
})

describe("isAutoSized", () => {
  it("is true for a node still the size its own text measures to", () => {
    const el = element({ $type: "text", text: "Hello" }, { width: 5 + 22, height: 19 + 14 })
    expect(isAutoSized(el)).toBe(true)
  })

  it("is false once a node has been dragged to a size of its own", () => {
    const el = element({ $type: "text", text: "Hello" }, { width: 200, height: 100 })
    expect(isAutoSized(el)).toBe(false)
  })

  it("is true for an untitled link, measured as the address it is drawn with rather than its empty title", () => {
    // displayText falls back to the URL for a link with no title, which is exactly what the field
    // opens on too; measuring the (empty) title here is the regression this case guards against.
    const url = "https://example.com"
    const el = element(
      { $type: "link", url, title: null },
      { width: url.length + 22 + 20, height: 19 + 14 },
    )
    expect(isAutoSized(el)).toBe(true)
  })

  it("does not recognise a resolved reference's own label, because it measures the content's text and a note or flashcard carries none", () => {
    // The projector sizes a resolved reference from ref.label (e.g. "My Deck"), which lives in the
    // scene's resolution map, not in the element's content. displayText(content) has nothing to read
    // for a note or flashcard, so this falls back to measuring empty text and answers false even for
    // a node nobody has ever dragged.
    const label = "My Deck"
    const el = element(
      { $type: "note", noteId: "n1" },
      { text: { lines: [label], fontSize: 14, fontWeight: 500, lineHeight: 19, letterSpacing: "-0.005em" },
        width: label.length + 22 + 20,
        height: 19 + 14 },
    )
    expect(isAutoSized(el)).toBe(false)
  })
})
