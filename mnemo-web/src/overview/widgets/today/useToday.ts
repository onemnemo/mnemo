import { useCallback, useMemo } from "react"

import type { DeckSummaryDto, DueCountsDto } from "@/api/types"
import { useAggregateDueQuery, useDecksQuery } from "@/flashcards/api"

/** How many decks the tall composition lists under "where the work is". */
const DECK_ROWS = 4

/** Roughly nine seconds a card, which is what the scheduler's own pacing works out at. */
export function estimateMinutes(cards: number): number {
  return Math.max(1, Math.round((cards * 9) / 60))
}

export interface TodayDeck {
  id: string
  name: string
  /** The deck's own mark, or null for the neutral fallback. */
  icon: string | null
  waiting: number
}

export interface TodayData {
  state: "loading" | "error" | "ready"
  counts: DueCountsDto
  /** The busiest decks with work waiting, most first. Empty when nothing is due. */
  decks: TodayDeck[]
  retry: () => void
}

const NOTHING: DueCountsDto = { new: 0, learning: 0, due: 0, total: 0 }

/** The decks with anything waiting, busiest first. Split out so the ranking can be tested. */
export function rankDecksByWork(decks: readonly DeckSummaryDto[], limit = DECK_ROWS): TodayDeck[] {
  return decks
    .map((deck) => ({
      id: deck.id,
      name: deck.name,
      icon: deck.icon,
      waiting: deck.dueCounts.new + deck.dueCounts.learning + deck.dueCounts.due,
    }))
    .filter((deck) => deck.waiting > 0)
    // Ties keep the library's own order, which is the order the user arranged their decks in.
    .sort((a, b) => b.waiting - a.waiting)
    .slice(0, limit)
}

/**
 * Today's queue: the capped totals the library banner reports, plus where that work sits.
 *
 * The totals come off the aggregate endpoint rather than from summing the deck list, because the
 * two are not the same number: the aggregate is capped per deck by that deck's own preset, and a
 * sum over the list would report a queue larger than the one the user will actually be handed.
 * The list is still read, for the deck rows, and its per-deck counts carry the same caps.
 */
export function useToday(): TodayData {
  const due = useAggregateDueQuery()
  const decks = useDecksQuery()

  const refetchDue = due.refetch
  const refetchDecks = decks.refetch
  const retry = useCallback(() => {
    void refetchDue()
    void refetchDecks()
  }, [refetchDue, refetchDecks])

  const deckList = decks.data
  const ranked = useMemo(() => (deckList === undefined ? [] : rankDecksByWork(deckList)), [deckList])

  return {
    state: due.isError || decks.isError ? "error" : due.isPending || decks.isPending ? "loading" : "ready",
    counts: due.data ?? NOTHING,
    decks: ranked,
    retry,
  }
}
