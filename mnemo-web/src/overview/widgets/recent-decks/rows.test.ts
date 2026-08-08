import { describe, expect, it } from "vitest"

import type { DeckSummaryDto, StatRecordDto } from "@/api/types"

import { buildRecentDeckRows, type RecentDeckOptions } from "./rows"

const NOW = Date.parse("2026-08-08T12:00:00Z")
const DAY = 24 * 60 * 60 * 1000

const OPTIONS: RecentDeckOptions = {
  days: 7,
  limit: 5,
  sortBy: "date",
  now: NOW,
  formatDate: (timestamp) => new Date(timestamp).toISOString().slice(0, 10),
  cards: "cards",
}

function deck(id: string, overrides: Partial<DeckSummaryDto> = {}): DeckSummaryDto {
  return {
    id,
    folderId: null,
    name: id,
    description: null,
    tags: [],
    presetId: "default",
    sortOrder: 0,
    totalCards: 42,
    activeCards: 42,
    suspendedCards: 0,
    dueCounts: { new: 0, learning: 0, due: 0, total: 0 },
    retentionPercent: 0,
    lastStudied: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function record(deckId: string, practicedAt: string | null, reviewed = 0): StatRecordDto {
  return {
    ns: "flashcards",
    kind: "deck.summary",
    key: `deck:${deckId}`,
    updatedAt: "2026-08-08T00:00:00Z",
    fields: {
      total_reviewed: { type: "integer", value: String(reviewed) },
      ...(practicedAt === null ? {} : { last_practiced: { type: "dateTime", value: practicedAt } }),
    },
  }
}

const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString()

describe("buildRecentDeckRows", () => {
  it("joins a record to its deck through the key prefix", () => {
    const rows = buildRecentDeckRows([record("d1", daysAgo(1))], [deck("d1", { name: "Anatomy" })], OPTIONS)

    expect(rows).toEqual([{ deckId: "d1", name: "Anatomy", meta: "42 cards", lastPracticed: "2026-08-07" }])
  })

  it("drops a record whose deck no longer exists", () => {
    // The statistics store keeps its rows after a deck is deleted, and a row naming a deck that
    // cannot be opened is worse than one row fewer.
    expect(buildRecentDeckRows([record("gone", daysAgo(1))], [deck("d1")], OPTIONS)).toEqual([])
  })

  it("falls back to the deck's own last-studied when the record has none", () => {
    const rows = buildRecentDeckRows(
      [record("d1", null)],
      [deck("d1", { lastStudied: daysAgo(2) })],
      OPTIONS,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].lastPracticed).toBe("2026-08-06")
  })

  it("excludes a deck that has never been practiced at all", () => {
    expect(buildRecentDeckRows([record("d1", null)], [deck("d1")], OPTIONS)).toEqual([])
  })

  it("excludes a deck last practiced before the window", () => {
    expect(buildRecentDeckRows([record("d1", daysAgo(8))], [deck("d1")], OPTIONS)).toEqual([])
  })

  it("orders by last practiced, newest first", () => {
    const rows = buildRecentDeckRows(
      [record("old", daysAgo(5)), record("new", daysAgo(1)), record("mid", daysAgo(3))],
      [deck("old"), deck("new"), deck("mid")],
      OPTIONS,
    )

    expect(rows.map((row) => row.deckId)).toEqual(["new", "mid", "old"])
  })

  it("orders by volume and then by date when the instance asks for most practiced", () => {
    const rows = buildRecentDeckRows(
      [record("a", daysAgo(1), 10), record("b", daysAgo(5), 90), record("c", daysAgo(2), 90)],
      [deck("a"), deck("b"), deck("c")],
      { ...OPTIONS, sortBy: "study_count" },
    )

    // b and c are tied on volume, so the more recently practiced of the two comes first.
    expect(rows.map((row) => row.deckId)).toEqual(["c", "b", "a"])
  })

  it("treats an unrecognized sort choice as by date, the way the desktop's comparison does", () => {
    const rows = buildRecentDeckRows(
      [record("a", daysAgo(1), 1), record("b", daysAgo(5), 99)],
      [deck("a"), deck("b")],
      { ...OPTIONS, sortBy: "whatever-a-past-build-wrote" },
    )

    expect(rows.map((row) => row.deckId)).toEqual(["a", "b"])
  })

  it("takes only as many rows as the instance asks for", () => {
    const rows = buildRecentDeckRows(
      [record("a", daysAgo(1)), record("b", daysAgo(2)), record("c", daysAgo(3))],
      [deck("a"), deck("b"), deck("c")],
      { ...OPTIONS, limit: 2 },
    )

    expect(rows.map((row) => row.deckId)).toEqual(["a", "b"])
  })

  it("leads the meta line with the first tag when there is one", () => {
    const rows = buildRecentDeckRows(
      [record("d1", daysAgo(1))],
      [deck("d1", { tags: ["Biology", "Year 2"], totalCards: 7 })],
      OPTIONS,
    )

    expect(rows[0].meta).toBe("Biology • 7 cards")
  })

  it("drops the separator entirely for an untagged deck", () => {
    // "42 cards", never " • 42 cards". The desktop composes the line the same way round.
    expect(buildRecentDeckRows([record("d1", daysAgo(1))], [deck("d1")], OPTIONS)[0].meta).toBe("42 cards")
    expect(
      buildRecentDeckRows([record("d1", daysAgo(1))], [deck("d1", { tags: ["   "] })], OPTIONS)[0].meta,
    ).toBe("42 cards")
  })
})
