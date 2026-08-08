/**
 * Turning the deck summary records into the widget's rows: the join, the window, the ordering and
 * the meta line.
 *
 * Pure and separate from the hook, for the same reason RecentNotes' is: this is the part that has
 * to agree with the desktop row for row, and none of it needs a renderer to check.
 */

import type { DeckSummaryDto, StatRecordDto } from "@/api/types"

import { readDateTime, readInt } from "../../stats"

/** Deck summary records are keyed by the deck they describe, with this in front of the id. */
const KEY_PREFIX = "deck:"

export interface RecentDeckRow {
  deckId: string
  name: string
  /** "Biology • 42 cards", or just the card count for a deck with no tags. */
  meta: string
  lastPracticed: string
}

export interface RecentDeckOptions {
  /** How far back the window reaches, in days. */
  days: number
  /** Most rows to return. */
  limit: number
  /** The stored choice. Only the literal "study_count" orders by volume; everything else by date. */
  sortBy: string
  now: number
  /** Renders one deck's timestamp, already bound to the caller's locale and translator. */
  formatDate: (timestamp: number, now: number) => string
  /** The localized word for the card count, which comes from the board's namespace, not the widget's. */
  cards: string
}

export function buildRecentDeckRows(
  records: readonly StatRecordDto[],
  decks: readonly DeckSummaryDto[],
  options: RecentDeckOptions,
): RecentDeckRow[] {
  const byId = new Map(decks.map((deck) => [deck.id, deck]))
  const cutoff = options.now - options.days * 24 * 60 * 60 * 1000

  const candidates: { deck: DeckSummaryDto; lastPracticed: number; reviewed: number }[] = []
  for (const record of records) {
    const deckId = record.key.startsWith(KEY_PREFIX) ? record.key.slice(KEY_PREFIX.length) : record.key

    // A record whose deck is gone is dropped rather than rendered from the record alone. The
    // statistics store keeps its rows after a deck is deleted, and a row naming a deck that cannot
    // be opened is worse than one row fewer.
    const deck = byId.get(deckId)
    if (deck === undefined) continue

    // The record's own timestamp first, the deck's second. A deck practiced before the per-deck
    // record existed has only the latter, and one with neither has never been practiced at all.
    const stamp = readDateTime(record.fields, "last_practiced") ?? dateOrNull(deck.lastStudied)
    if (stamp === undefined || stamp < cutoff) continue

    candidates.push({ deck, lastPracticed: stamp, reviewed: readInt(record.fields, "total_reviewed") })
  }

  // Anything that is not the literal "study_count" orders by date, including a value corrupted
  // outside the app. That is the desktop's comparison, not a validation of the stored choice.
  const byVolume = options.sortBy === "study_count"
  candidates.sort((left, right) =>
    byVolume && left.reviewed !== right.reviewed
      ? right.reviewed - left.reviewed
      : right.lastPracticed - left.lastPracticed,
  )

  return candidates.slice(0, options.limit).map(({ deck, lastPracticed }) => {
    const cardsLine = `${deck.totalCards} ${options.cards}`
    const tag = deck.tags.length > 0 ? deck.tags[0].trim() : ""

    return {
      deckId: deck.id,
      name: deck.name,
      // U+2022, and only when there is a tag to name. An untagged deck reads as "42 cards" rather
      // than as a leading separator.
      meta: tag === "" ? cardsLine : `${tag} • ${cardsLine}`,
      lastPracticed: options.formatDate(lastPracticed, options.now),
    }
  })
}

function dateOrNull(timestamp: string | null): number | undefined {
  if (timestamp === null) return undefined

  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? undefined : parsed
}
