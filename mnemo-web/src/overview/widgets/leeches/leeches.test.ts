import { describe, expect, it } from "vitest"

import type { CardViewDto } from "@/api/types"

import { plainFront, rankLeeches } from "./leeches"

const card = (id: string, front: string, lapses: number) =>
  ({
    card: { id, front },
    schedule: { lapses },
  }) as unknown as CardViewDto

describe("plainFront", () => {
  it("unwraps a cloze deletion to the text it hides", () => {
    expect(plainFront("Amiodarone prolongs the {{c1::QT interval}}")).toBe("Amiodarone prolongs the QT interval")
  })

  it("drops the hint after a second separator", () => {
    expect(plainFront("The {{c1::mitochondria::organelle}} makes ATP")).toBe("The mitochondria makes ATP")
  })

  it("unwraps every deletion on a card, not just the first", () => {
    expect(plainFront("{{c1::A}} and {{c2::B}}")).toBe("A and B")
  })

  it("leaves an ordinary front alone", () => {
    expect(plainFront("What is the capital of Norway?")).toBe("What is the capital of Norway?")
  })
})

describe("rankLeeches", () => {
  const decks = [
    { deckId: "d1", deckName: "Pharm", cards: [card("a", "A", 5), card("b", "B", 1)] },
    { deckId: "d2", deckName: "German", cards: [card("c", "C", 7), card("d", "D", 3)] },
  ]

  it("orders by lapses across decks, not within them", () => {
    expect(rankLeeches(decks, 10).map((row) => row.cardId)).toEqual(["c", "a", "d"])
  })

  it("drops cards below the threshold", () => {
    // "b" has one lapse: that is a card that went wrong once, not a card that keeps slipping.
    expect(rankLeeches(decks, 10).some((row) => row.cardId === "b")).toBe(false)
  })

  it("honours the limit", () => {
    expect(rankLeeches(decks, 2).map((row) => row.cardId)).toEqual(["c", "a"])
  })

  it("carries the deck a card came from, so a row can say where it lives", () => {
    expect(rankLeeches(decks, 1)[0]).toMatchObject({ deckId: "d2", deckName: "German" })
  })

  it("returns nothing when no deck has a repeat offender", () => {
    expect(rankLeeches([{ deckId: "d", deckName: "D", cards: [card("x", "X", 0)] }], 5)).toEqual([])
  })
})
