import { describe, expect, it } from "vitest"

import { createTranslate } from "@/i18n/translate"

import { NAMED_LIMIT, removalMessage } from "./removal"

const t = createTranslate({
  Flashcards: {
    OcclusionRemoveNamedOne: "Saving moves the card for {names} to the trash, with its review history.",
    OcclusionRemoveNamedMany: "Saving moves the cards for {names} to the trash, with their review history.",
    OcclusionRemoveUnnamedOne: "Saving moves {count} card to the trash, with its review history.",
    OcclusionRemoveUnnamedMany: "Saving moves {count} cards to the trash, with their review history.",
    OcclusionRemoveMoreOne: "{count} more",
    OcclusionRemoveMoreMany: "{count} more",
    OcclusionRemoveKeepOne: "The other card keeps its review history.",
    OcclusionRemoveKeepMany: "The other {count} keep theirs.",
  },
})

const cards = (...labels: string[]) => labels.map((label) => ({ label }))
const message = (removed: { label?: string }[], kept: number) => removalMessage(t, removed, kept, "en")

describe("removalMessage", () => {
  it("names one mask and says the others keep theirs", () => {
    expect(message(cards("Ribosome"), 10)).toBe(
      "Saving moves the card for Ribosome to the trash, with its review history. The other 10 keep theirs.",
    )
  })

  it("lists two names with and", () => {
    expect(message(cards("Ribosome", "Cell membrane"), 1)).toBe(
      "Saving moves the cards for Ribosome and Cell membrane to the trash, with their review history. The other card keeps its review history.",
    )
  })

  it("names at most three, then counts the rest", () => {
    expect(NAMED_LIMIT).toBe(3)
    const text = message(cards("A", "B", "C", "D", "E"), 0)
    expect(text).toBe("Saving moves the cards for A, B, C, and 2 more to the trash, with their review history.")
  })

  it("counts unlabelled masks toward the rest instead of naming them", () => {
    expect(message(cards("A", "", "B", "  "), 2)).toBe(
      "Saving moves the cards for A, B, and 2 more to the trash, with their review history. The other 2 keep theirs.",
    )
  })

  it("only counts when no removed mask has a label", () => {
    expect(message(cards("", ""), 3)).toBe("Saving moves 2 cards to the trash, with their review history. The other 3 keep theirs.")
    expect(message(cards(""), 0)).toBe("Saving moves 1 card to the trash, with its review history.")
  })

  it("never says deleted or cannot be undone", () => {
    expect(message(cards("A", "B", "C", "D"), 4)).not.toMatch(/delet|undone/i)
  })
})
