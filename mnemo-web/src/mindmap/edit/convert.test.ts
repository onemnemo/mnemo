import { describe, expect, it } from "vitest"

import type { ElementContent } from "../model/document"
import type { NodeKind, RefInfo } from "../scene/content"
import { carriedText, isPlainKind, linkContent, plainContent } from "./convert"

const NO_REFS: ReadonlyMap<string, RefInfo> = new Map()

describe("which kinds a node can become on its own", () => {
  it("is the four that are made of words", () => {
    const kinds: NodeKind[] = ["text", "task", "code", "math"]
    expect(kinds.every(isPlainKind)).toBe(true)
  })

  it("is not the three that point at something", () => {
    const kinds: NodeKind[] = ["link", "note", "flashcard"]
    expect(kinds.some(isPlainKind)).toBe(false)
  })
})

describe("the words a conversion carries", () => {
  it("is the label of a node that has one", () => {
    expect(carriedText({ $type: "text", text: "Photosynthesis" }, NO_REFS)).toBe("Photosynthesis")
  })

  it("is the source of a code node, line breaks and all", () => {
    const content: ElementContent = { $type: "code", source: "a()\nb()" }
    expect(carriedText(content, NO_REFS)).toBe("a()\nb()")
  })

  it("is a link's title when it has one", () => {
    expect(carriedText({ $type: "link", url: "https://x.test", title: "Example" }, NO_REFS)).toBe("Example")
  })

  it("is a link's address when it has no title, because that is what the node reads as", () => {
    expect(carriedText({ $type: "link", url: "https://x.test" }, NO_REFS)).toBe("https://x.test")
  })

  it("is the resolved title of a reference, which the node itself does not store", () => {
    const refs = new Map<string, RefInfo>([["note:n1", { label: "Cell biology" }]])
    expect(carriedText({ $type: "note", noteId: "n1" }, refs)).toBe("Cell biology")
  })

  it("is nothing when the reference has not resolved yet", () => {
    expect(carriedText({ $type: "note", noteId: "n1" }, NO_REFS)).toBe("")
  })

  it("is nothing when what the reference points at is gone, rather than the words saying so", () => {
    const refs = new Map<string, RefInfo>([["deck:d1", { label: "Missing reference", missing: true }]])
    expect(carriedText({ $type: "flashcard", deckId: "d1" }, refs)).toBe("")
  })
})

describe("the content a node becomes", () => {
  it("puts the words in the slot the new kind reads from", () => {
    expect(plainContent("text", "hi")).toEqual({ $type: "text", text: "hi" })
    expect(plainContent("task", "hi")).toEqual({ $type: "task", text: "hi" })
    expect(plainContent("code", "hi")).toEqual({ $type: "code", source: "hi" })
    expect(plainContent("math", "hi")).toEqual({ $type: "math", latex: "hi" })
  })

  it("starts a new task unticked", () => {
    expect(plainContent("task", "hi")).not.toHaveProperty("done", true)
  })

  it("keeps the label as a link's title", () => {
    expect(linkContent("https://x.test", "Example")).toEqual({
      $type: "link",
      url: "https://x.test",
      title: "Example",
    })
  })

  it("stores no title when the label is only the address again", () => {
    expect(linkContent("https://x.test", "https://x.test")).toEqual({
      $type: "link",
      url: "https://x.test",
    })
  })

  it("stores no title when there were no words to carry", () => {
    expect(linkContent("https://x.test", "   ")).toEqual({ $type: "link", url: "https://x.test" })
  })
})
