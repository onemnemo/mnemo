import { describe, expect, it } from "vitest"

import { weightedRetention, type DeckRetention } from "./memory"

const deck = (deckId: string, retentionPercent: number, volume: number): DeckRetention => ({
  deckId,
  name: deckId,
  retentionPercent,
  volume,
})

describe("weightedRetention", () => {
  it("reports nothing at all for a library with no decks", () => {
    expect(weightedRetention([])).toBeNull()
  })

  it("reports nothing when no deck was reviewed in the window", () => {
    expect(weightedRetention([deck("a", 90, 0), deck("b", 80, 0)])).toBeNull()
  })

  it("weights each deck by how much of it was reviewed", () => {
    // A deck reviewed twice at 100% must not pull as hard as one reviewed 400 times at 80%. The
    // plain mean of these two is 90, which is not what the user's month looked like.
    const result = weightedRetention([deck("light", 100, 2), deck("heavy", 80, 400)])

    expect(result?.retentionPercent).toBe(80)
  })

  it("ignores a deck with no reviews rather than counting it as zero retention", () => {
    const result = weightedRetention([deck("studied", 70, 10), deck("untouched", 0, 0)])

    expect(result?.retentionPercent).toBe(70)
  })

  it("rounds the mean half away from zero", () => {
    // 100*1 + 0*1 over 2 is exactly 50; 75*1 + 100*2 over 3 is 91.67.
    expect(weightedRetention([deck("a", 100, 1), deck("b", 0, 1)])?.retentionPercent).toBe(50)
    expect(weightedRetention([deck("a", 75, 1), deck("b", 100, 2)])?.retentionPercent).toBe(92)
  })

  it("draws the trend for the deck reviewed most", () => {
    const result = weightedRetention([deck("a", 90, 5), deck("busiest", 60, 50), deck("c", 80, 12)])

    expect(result?.busiest.deckId).toBe("busiest")
  })

  it("keeps the first of two decks tied on volume", () => {
    const result = weightedRetention([deck("first", 90, 20), deck("second", 60, 20)])

    expect(result?.busiest.deckId).toBe("first")
  })
})
