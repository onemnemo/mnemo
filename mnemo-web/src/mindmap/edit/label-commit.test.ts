/**
 * What closing a field writes: nothing for an edit that changed nothing, a delete for a node made
 * for the edit and left blank, the text slot for a title or source, and the content with its runs
 * and their plain projection for a label that is its own to format.
 */

import { describe, expect, it } from "vitest"

import { defaultTextStyle, type InlineSpan } from "@/notes/model/types"

import type { ElementContent } from "../model/document"
import { labelCommit } from "./label-commit"

const text = (value: string, style: Partial<InlineSpan["style"]> = {}): InlineSpan => ({
  kind: "text",
  text: value,
  style: { ...defaultTextStyle, ...style },
})

const plain: ElementContent = { $type: "text", text: "hello" }
const rich: ElementContent = { $type: "text", text: "hello", runs: [text("hel"), text("lo", { bold: true })] }

describe("an abandoned edit", () => {
  it("writes nothing", () => {
    expect(labelCommit(plain, false, null)).toEqual({ kind: "none" })
    expect(labelCommit(plain, true, null)).toEqual({ kind: "none" })
  })
})

describe("a title or a source closing as text", () => {
  it("deletes a node made for the edit and left blank, and keeps one that had a label", () => {
    expect(labelCommit(plain, true, { text: "  " })).toEqual({ kind: "delete" })
    expect(labelCommit(plain, false, { text: "" })).toEqual({ kind: "none" })
  })

  it("writes nothing for an unchanged slot, trimmed", () => {
    expect(labelCommit({ $type: "frame", title: "Group" }, false, { text: " Group " })).toEqual({ kind: "none" })
    expect(labelCommit({ $type: "code", source: "x = 1" }, false, { text: "x = 1" })).toEqual({ kind: "none" })
  })

  it("writes the text slot when it changed", () => {
    expect(labelCommit({ $type: "link", url: "https://a", title: "A" }, false, { text: "B " })).toEqual({
      kind: "set",
      patch: { t: "B" },
    })
  })
})

describe("a label closing as runs", () => {
  it("deletes a node made for the edit whose runs spell only whitespace", () => {
    expect(labelCommit(plain, true, { runs: [text(" \n ")] })).toEqual({ kind: "delete" })
    expect(labelCommit(plain, false, { runs: [text("")] })).toEqual({ kind: "none" })
  })

  it("writes nothing when the runs are the ones the node holds", () => {
    expect(labelCommit(rich, false, { runs: [text("hel"), text("lo", { bold: true })] })).toEqual({ kind: "none" })
  })

  it("reads a plain node as one unstyled run, so retyping its words changes nothing", () => {
    expect(labelCommit(plain, false, { runs: [text("hello")] })).toEqual({ kind: "none" })
    expect(labelCommit(plain, false, { runs: [text(" hello ")] })).toEqual({ kind: "none" })
  })

  it("writes the content with the runs and their plain projection", () => {
    const runs = [text("hel"), text("lo", { bold: true }), { kind: "equation", latex: "x", style: { ...defaultTextStyle } } as InlineSpan]
    expect(labelCommit(plain, false, { runs })).toEqual({
      kind: "set",
      patch: { content: { $type: "text", text: "hellox", runs } },
    })
  })

  it("keeps the rest of the content beside the runs", () => {
    const task: ElementContent = { $type: "task", text: "old", done: true, due: "2026-01-01" }
    expect(labelCommit(task, false, { runs: [text("new", { italic: true })] })).toEqual({
      kind: "set",
      patch: { content: { $type: "task", text: "new", done: true, due: "2026-01-01", runs: [text("new", { italic: true })] } },
    })
  })

  it("writes words with nothing on them as words, so a node stays plain until it is formatted", () => {
    expect(labelCommit(plain, false, { runs: [text("new words")] })).toEqual({ kind: "set", patch: { t: "new words" } })
    expect(labelCommit(plain, false, { runs: [text("two\nlines")] })).toEqual({ kind: "set", patch: { t: "two\nlines" } })
  })

  it("takes a node back to plain once every mark is gone", () => {
    const formatted: ElementContent = { $type: "text", text: "hi", runs: [text("hi", { bold: true })] }
    expect(labelCommit(formatted, false, { runs: [text("hi")] })).toEqual({ kind: "set", patch: { t: "hi" } })
  })

  it("trims the whitespace the label opened and closed on, atoms untouched", () => {
    expect(labelCommit(plain, false, { runs: [text("  "), text("hi ", { bold: true }), text(" ")] })).toEqual({
      kind: "set",
      patch: { content: { $type: "text", text: "hi", runs: [text("hi", { bold: true })] } },
    })
  })

  it("writes a stored math row back as the text node it reads as", () => {
    const math: ElementContent = { $type: "math", latex: "x^2" }
    const runs = [{ kind: "equation", latex: "x^3", style: { ...defaultTextStyle } } as InlineSpan]
    expect(labelCommit(math, false, { runs })).toEqual({
      kind: "set",
      patch: { content: { $type: "text", text: "x^3", runs } },
    })
  })

  it("falls back to the text slot for a kind that cannot hold runs", () => {
    expect(labelCommit({ $type: "link", url: "https://a", title: "A" }, false, { runs: [text("B", { bold: true })] })).toEqual({
      kind: "set",
      patch: { t: "B" },
    })
  })
})
