import type { CardViewDto } from "@/api/types"

/**
 * How many lapses make a card worth naming. Two is the first count that says "this keeps
 * happening" rather than "this went wrong once", which is the difference between a widget that is
 * useful and one that lists everything you have ever failed.
 */
export const LEECH_THRESHOLD = 2

export interface LeechRow {
  cardId: string
  deckId: string
  deckName: string
  front: string
  lapses: number
}

/**
 * Cloze syntax is authoring markup, not a card front.
 *
 * A dashboard row reading "Amiodarone prolongs the {{c1::QT interval}}" leaks the editor into a
 * place nobody is editing. The hint after a second `::` goes too, since it is a prompt for someone
 * mid-review rather than a description of the card.
 */
export function plainFront(front: string): string {
  return front.replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1")
}

/** The worst offenders across every deck, most lapses first. Ties keep deck order, then card order. */
export function rankLeeches(
  perDeck: readonly { deckId: string; deckName: string; cards: readonly CardViewDto[] }[],
  limit: number,
): LeechRow[] {
  const rows: LeechRow[] = []
  for (const deck of perDeck) {
    for (const view of deck.cards) {
      if (view.schedule.lapses < LEECH_THRESHOLD) continue
      rows.push({
        cardId: view.card.id,
        deckId: deck.deckId,
        deckName: deck.deckName,
        front: plainFront(view.card.front),
        lapses: view.schedule.lapses,
      })
    }
  }

  // Sorted here rather than trusted from the server: each deck answered its own query, so the
  // pages arrive sorted within a deck and interleaved across them.
  return rows.sort((a, b) => b.lapses - a.lapses).slice(0, limit)
}
