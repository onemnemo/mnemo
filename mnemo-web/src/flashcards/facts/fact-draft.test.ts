import { describe, expect, it } from "vitest"

import { resolveDraftDeck } from "./fact-draft"

describe("resolveDraftDeck", () => {
  it("keeps the deck the material names when the collection still has it", () => {
    expect(resolveDraftDeck("deck-1", ["deck-1", "deck-2"], "deck-2")).toBe("deck-1")
  })

  it("falls back to the card's deck when the one the material names is gone", () => {
    expect(resolveDraftDeck("deck-1", ["deck-2", "deck-3"], "deck-2")).toBe("deck-2")
  })

  it("waits for the decks to load rather than treating an empty list as a missing deck", () => {
    expect(resolveDraftDeck("deck-1", [], "deck-2")).toBe("deck-1")
  })
})
