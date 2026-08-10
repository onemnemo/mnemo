/**
 * Notes and decks in one list, most recent first.
 *
 * Running "Recent decks" and "Recent notes" as separate panels is what produced the pair of empty
 * boxes on the old board: split in half, neither has enough to say and both read as broken.
 * Interleaved, the list is full from the first session, and it answers the question the reader
 * actually arrived with, which is what was I doing.
 */

import type { DeckSummaryDto, NoteSummaryDto, StatRecordDto } from "@/api/types"

import { readDateTime } from "../../stats"

/** Deck summary records are keyed by the deck they describe, with this in front of the id. */
const DECK_KEY_PREFIX = "deck:"

export type RecentKind = "note" | "deck"

export interface RecentRow {
  kind: RecentKind
  id: string
  title: string
  /** The deck's own mark, or null. Notes never carry one here; the list uses a glyph for them. */
  icon: string | null
  /** When it was last touched, as epoch milliseconds. */
  touchedAt: number
  href: string
}

export interface RecentOptions {
  /** Most rows to return. */
  limit: number
  /** The localized fallback for a note with no title. */
  untitled: string
}

function parseDate(timestamp: string | null): number | undefined {
  if (timestamp === null) return undefined
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * Every note and every practised deck, interleaved by when it was last touched.
 *
 * A deck's timestamp comes from its statistics record first and its own `lastStudied` second: the
 * record is written on every session, and the field covers decks practised before the per-deck
 * record existed. A deck with neither has never been practised and does not belong in a list about
 * what you were doing.
 */
export function buildRecentRows(
  notes: readonly NoteSummaryDto[],
  deckRecords: readonly StatRecordDto[],
  decks: readonly DeckSummaryDto[],
  options: RecentOptions,
): RecentRow[] {
  const rows: RecentRow[] = []

  for (const note of notes) {
    const touchedAt = parseDate(note.modifiedAt)
    if (touchedAt === undefined) continue
    const title = note.title.trim()
    rows.push({
      kind: "note",
      id: note.id,
      title: title === "" ? options.untitled : title,
      icon: null,
      touchedAt,
      href: `#/notes/${note.id}`,
    })
  }

  const stamps = new Map<string, number>()
  for (const record of deckRecords) {
    const deckId = record.key.startsWith(DECK_KEY_PREFIX) ? record.key.slice(DECK_KEY_PREFIX.length) : record.key
    const stamp = readDateTime(record.fields, "last_practiced")
    if (stamp !== undefined) stamps.set(deckId, stamp)
  }

  for (const deck of decks) {
    // The record outlives the deck it describes, so the deck list is what decides a row exists at
    // all: a row naming a deck that cannot be opened is worse than one row fewer.
    const touchedAt = stamps.get(deck.id) ?? parseDate(deck.lastStudied)
    if (touchedAt === undefined) continue
    rows.push({
      kind: "deck",
      id: deck.id,
      title: deck.name,
      icon: deck.icon,
      touchedAt,
      href: `#/flashcard-deck/${deck.id}`,
    })
  }

  return rows.sort((left, right) => right.touchedAt - left.touchedAt).slice(0, Math.max(0, options.limit))
}
