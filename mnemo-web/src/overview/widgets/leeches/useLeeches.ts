import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, ApiError } from "@/api/client"
import type { CardPageDto, DeckSummaryDto } from "@/api/types"
import { useDecksQuery } from "@/flashcards/api"
import { LEECH_LAPSES } from "@/flashcards/leeches"

import { deckFanOutKey, deckFanOutRoot } from "../../api"
import { rankLeeches, type LeechRow } from "./leeches"

const FAN_OUT = "leeches"

/**
 * How many rows each deck is asked for.
 *
 * Bounded per deck rather than per library, because the request goes out per deck and the widget
 * shows at most six rows. A deck cannot contribute more than this many, which is only wrong if one
 * deck holds more than eight of the library's worst cards *and* another deck's worst are all
 * milder, in which case the ranking is still correct for everything shown.
 */
const PER_DECK = 8

export interface LeechesData {
  state: "loading" | "error" | "empty" | "ready"
  rows: LeechRow[]
  /** Everything at or past the threshold, which is usually more than the tile has room for. */
  total: number
  retry: () => void
}

async function loadLeeches(decks: readonly DeckSummaryDto[]) {
  const perDeck = await Promise.all(
    decks.map(async (deck) => {
      const query = new URLSearchParams({
        minLapses: String(LEECH_LAPSES),
        sort: "lapses",
        desc: "true",
        limit: String(PER_DECK),
      })
      const page = await apiFetch<CardPageDto>(`/decks/${encodeURIComponent(deck.id)}/cards?${query}`)
      return { deckId: deck.id, deckName: deck.name, cards: page.items, total: page.totalCount }
    }),
  )

  return {
    // Ranked over the whole fan-out, then cut to what a tall tile can show.
    rows: rankLeeches(perDeck, 6),
    // The server's own count per deck, not the length of the page it returned, so the header says
    // how many cards keep slipping rather than how many fitted in one request.
    total: perDeck.reduce((sum, deck) => sum + deck.total, 0),
  }
}

/**
 * The cards that keep getting failed, across every deck.
 *
 * A fan-out over the per-deck card query rather than one library-wide endpoint, because there is
 * no library-wide card query and adding one to serve a single widget would put a second card
 * search in the API next to the one every other surface uses.
 */
export function useLeeches(): LeechesData {
  const decks = useDecksQuery()
  const deckList = decks.data

  const leeches = useQuery<{ rows: LeechRow[]; total: number }, ApiError>({
    queryKey: deckFanOutKey(FAN_OUT, (deckList ?? []).map((deck) => deck.id)),
    queryFn: () => loadLeeches(deckList ?? []),
    enabled: deckList !== undefined,
  })

  const client = useQueryClient()
  const refetchDecks = decks.refetch
  // Invalidated by prefix, so a retry does not have to reconstruct the deck-id half of the key.
  const retry = useCallback(() => {
    void client.invalidateQueries({ queryKey: deckFanOutRoot(FAN_OUT) })
    void refetchDecks()
  }, [client, refetchDecks])

  const state = decks.isError || leeches.isError
    ? "error"
    : deckList === undefined || leeches.isPending
      ? "loading"
      : leeches.data.rows.length === 0
        ? "empty"
        : "ready"

  return { state, rows: leeches.data?.rows ?? [], total: leeches.data?.total ?? 0, retry }
}
