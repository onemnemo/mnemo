import { useMemo } from "react"

import { useDecksQuery } from "@/flashcards/api"

import type { MindmapLibraryEntry } from "../model/document"

/**
 * Cards waiting in the decks each map links to, by map id.
 *
 * Read off the deck list the rest of the app already holds rather than asked for per map: the
 * counts are on every deck summary, so a second round trip would buy nothing but a second cache to
 * go stale. A map with no links is absent from the result rather than present with a zero, so a
 * card can ask "is there a badge" with one lookup.
 */
export function useDueByMap(entries: readonly MindmapLibraryEntry[]): Map<string, number> {
  const decks = useDecksQuery()

  return useMemo(() => {
    const dueByDeck = new Map((decks.data ?? []).map((deck) => [deck.id, deck.dueCounts.total]))
    const byMap = new Map<string, number>()
    for (const entry of entries) {
      let due = 0
      for (const deckId of entry.linkedDeckIds ?? []) {
        due += dueByDeck.get(deckId) ?? 0
      }
      if (due > 0) {
        byMap.set(entry.document.id, due)
      }
    }
    return byMap
  }, [entries, decks.data])
}
