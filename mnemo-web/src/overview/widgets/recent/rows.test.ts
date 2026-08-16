import { describe, expect, it } from "vitest"

import type { DeckSummaryDto, NoteSummaryDto, StatRecordDto } from "@/api/types"

import { buildRecentRows } from "./rows"

const note = (id: string, title: string, modifiedAt: string) =>
  ({ id, title, modifiedAt, createdAt: modifiedAt, folderId: null }) as unknown as NoteSummaryDto

const deck = (id: string, name: string, lastStudied: string | null, icon: string | null = null) =>
  ({ id, name, lastStudied, icon, totalCards: 10 }) as unknown as DeckSummaryDto

const deckRecord = (deckId: string, lastPracticed: string) =>
  ({
    key: `deck:${deckId}`,
    fields: { last_practiced: { type: "dateTime", value: lastPracticed } },
  }) as unknown as StatRecordDto

const OPTIONS = { limit: 10, untitled: "Untitled" }

describe("buildRecentRows", () => {
  it("interleaves notes and decks by when each was last touched", () => {
    const rows = buildRecentRows(
      [note("n1", "Krebs", "2026-08-10T09:00:00Z"), note("n2", "Parkinson", "2026-08-08T09:00:00Z")],
      [deckRecord("d1", "2026-08-09T09:00:00+00:00")],
      [deck("d1", "Pharm", null)],
      OPTIONS,
    )

    expect(rows.map((row) => row.id)).toEqual(["n1", "d1", "n2"])
  })

  it("prefers the statistics record's timestamp over the deck's own field", () => {
    const rows = buildRecentRows(
      [],
      [deckRecord("d1", "2026-08-10T09:00:00+00:00")],
      [deck("d1", "Pharm", "2026-01-01T00:00:00Z")],
      OPTIONS,
    )

    expect(rows[0].touchedAt).toBe(Date.parse("2026-08-10T09:00:00+00:00"))
  })

  it("falls back to the deck's own field for a deck practised before the record existed", () => {
    const rows = buildRecentRows([], [], [deck("d1", "Pharm", "2026-05-05T00:00:00Z")], OPTIONS)

    expect(rows).toHaveLength(1)
  })

  it("leaves out a deck that has never been practised", () => {
    expect(buildRecentRows([], [], [deck("d1", "Pharm", null)], OPTIONS)).toEqual([])
  })

  it("drops a record whose deck no longer exists", () => {
    // The statistics store keeps its rows after a deck is deleted, and a row naming a deck that
    // cannot be opened is worse than one row fewer.
    expect(buildRecentRows([], [deckRecord("gone", "2026-08-10T09:00:00+00:00")], [], OPTIONS)).toEqual([])
  })

  it("names an untitled note rather than rendering an empty row", () => {
    const rows = buildRecentRows([note("n1", "   ", "2026-08-10T09:00:00Z")], [], [], OPTIONS)

    expect(rows[0].title).toBe("Untitled")
  })

  it("carries the deck's own mark and each row's destination", () => {
    const rows = buildRecentRows(
      [note("n1", "Krebs", "2026-08-10T09:00:00Z")],
      [],
      [deck("d1", "Pharm", "2026-08-09T00:00:00Z", "💊")],
      OPTIONS,
    )

    expect(rows[0].href).toBe("#/notes/n1")
    expect(rows[1]).toMatchObject({ icon: "💊", href: "#/flashcard-deck/d1" })
  })

  it("honours the limit after ordering, not before", () => {
    const rows = buildRecentRows(
      [note("old", "Old", "2026-01-01T00:00:00Z"), note("new", "New", "2026-08-10T09:00:00Z")],
      [],
      [],
      { ...OPTIONS, limit: 1 },
    )

    expect(rows.map((row) => row.id)).toEqual(["new"])
  })

  it("ignores an unparseable timestamp instead of ordering it as the epoch", () => {
    expect(buildRecentRows([note("n1", "Krebs", "not a date")], [], [], OPTIONS)).toEqual([])
  })
})
