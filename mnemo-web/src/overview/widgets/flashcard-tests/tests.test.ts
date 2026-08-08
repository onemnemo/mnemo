import { describe, expect, it } from "vitest"

import type { TestAttemptDto, TestSummaryDto } from "@/api/types"

import { latestTestedDeck, roundAwayFromZero, scoreMovement, type DeckTestSummary } from "./tests"

function attempt(completedAt: string): TestAttemptDto {
  return {
    id: "attempt",
    deckId: "deck",
    startedAt: completedAt,
    completedAt,
    cardsTested: 10,
    gotItCount: 8,
    closeCount: 1,
    missedCount: 1,
    scorePct: 85,
  }
}

function summary(completedAt: string | null, overrides: Partial<TestSummaryDto> = {}): TestSummaryDto {
  return {
    hasAttempts: completedAt !== null,
    latestScorePct: 85,
    previousScorePct: null,
    bestScorePct: 85,
    deltaVsPrevious: null,
    attemptCount: completedAt === null ? 0 : 1,
    latest: completedAt === null ? null : attempt(completedAt),
    ...overrides,
  }
}

const entry = (deckId: string, completedAt: string | null): DeckTestSummary => ({
  deckId,
  name: deckId,
  summary: summary(completedAt),
})

describe("latestTestedDeck", () => {
  it("reports nothing for a library with no decks", () => {
    expect(latestTestedDeck([])).toBeNull()
  })

  it("reports nothing when no deck has a completed attempt", () => {
    expect(latestTestedDeck([entry("a", null), entry("b", null)])).toBeNull()
  })

  it("picks by recency and not by score or attempt count", () => {
    const decks = [
      entry("older", "2026-08-01T10:00:00Z"),
      entry("newest", "2026-08-07T09:00:00Z"),
      entry("middle", "2026-08-04T22:00:00Z"),
    ]

    expect(latestTestedDeck(decks)?.deckId).toBe("newest")
  })

  it("skips a deck with no attempts on the way to one that has some", () => {
    const decks = [entry("untested", null), entry("tested", "2026-08-01T10:00:00Z")]

    expect(latestTestedDeck(decks)?.deckId).toBe("tested")
  })

  it("keeps the first of two decks tested at the same instant", () => {
    const decks = [entry("first", "2026-08-05T10:00:00Z"), entry("second", "2026-08-05T10:00:00Z")]

    expect(latestTestedDeck(decks)?.deckId).toBe("first")
  })
})

describe("scoreMovement", () => {
  it("reports a first attempt as no movement", () => {
    // Null is "there is nothing to compare against", which the widget draws as a dash rather than
    // as a flat zero.
    expect(scoreMovement(null)).toEqual({ trend: "none", deltaPercent: 0 })
  })

  it("reports a rise and a drop with a positive distance either way", () => {
    expect(scoreMovement(12)).toEqual({ trend: "up", deltaPercent: 12 })
    expect(scoreMovement(-12)).toEqual({ trend: "down", deltaPercent: 12 })
  })

  it("reports a change too small to round to a whole point as no movement", () => {
    expect(scoreMovement(0)).toEqual({ trend: "none", deltaPercent: 0 })
    expect(scoreMovement(0.4)).toEqual({ trend: "none", deltaPercent: 0 })
    expect(scoreMovement(-0.4)).toEqual({ trend: "none", deltaPercent: 0 })
  })

  it("rounds a half point outwards in both directions", () => {
    // Left to the language, -0.5 rounds up to -0 and a small drop would read as no change at all.
    expect(scoreMovement(0.5)).toEqual({ trend: "up", deltaPercent: 1 })
    expect(scoreMovement(-0.5)).toEqual({ trend: "down", deltaPercent: 1 })
  })
})

describe("roundAwayFromZero", () => {
  it("sends a half outwards rather than upwards", () => {
    expect(roundAwayFromZero(82.5)).toBe(83)
    expect(roundAwayFromZero(-82.5)).toBe(-83)
    expect(roundAwayFromZero(0)).toBe(0)
  })
})
