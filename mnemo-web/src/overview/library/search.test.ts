import { describe, expect, it } from "vitest"

import { fold, matches, searchBlob } from "./search"

describe("fold", () => {
  it("strips case and diacritics", () => {
    expect(fold("Réviser")).toBe("reviser")
    expect(fold("ACTIVITY")).toBe("activity")
  })
})

describe("searchBlob / matches", () => {
  const blob = searchBlob({
    title: "Memory",
    description: "True retention weighted across all decks",
    gallery: "30-day retention with a 14-day trend",
    author: "Mnemo",
  })

  it("matches on any of title, description, gallery or author", () => {
    expect(matches(blob, "memory")).toBe(true)
    expect(matches(blob, "weighted")).toBe(true) // short description
    expect(matches(blob, "trend")).toBe(true) // gallery description, never shown alone
    expect(matches(blob, "mnemo")).toBe(true) // author
  })

  it("matches accent- and case-insensitively", () => {
    expect(matches(searchBlob({ title: "Révision", description: "", gallery: "", author: "" }), "revision")).toBe(true)
  })

  it("treats an empty or whitespace query as matching everything", () => {
    expect(matches(blob, "")).toBe(true)
    expect(matches(blob, "   ")).toBe(true)
  })

  it("does not match text in no part of the blob", () => {
    expect(matches(blob, "flashcard")).toBe(false)
  })
})
