import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { CardPageDto, CardSort, CardStateFilter } from "@/api/types"

import { libraryKey } from "../api"

// The prefix every deck's card key sits under (src/flashcards/deck/api.ts's deckKey is
// ["flashcards", "deck", deckId]). Invalidating this prefix reaches every open deck's card
// query regardless of which deck it is scoped to, which is what a cross-deck selection needs.
const everyDeckKey = ["flashcards", "deck"] as const

// The collection-wide counterpart to src/flashcards/deck/api.ts: same request shape, minus a
// pinned deck and plus the fact-authored card type. Kept as its own module rather than folded
// into the deck one because a mutation here has to invalidate every open deck's cache, not one.

export const browseKey = ["flashcards", "browse"] as const

export interface BrowseQuery {
  text: string
  state: CardStateFilter
  tag: string | null
  /** Narrows to one deck without leaving the page; null spans the whole collection. */
  deckId: string | null
  /** A fact-authored card type id from GET /api/card-types, not the classic/cloze render shape. */
  cardTypeId: string | null
  /** Inclusive bounds on lapses. "Never forgotten" is maxLapses 0, not minLapses 0. */
  minLapses: number | null
  maxLapses: number | null
  sort: CardSort
  sortDescending: boolean
  offset: number
  limit: number
}

function browsePath(query: BrowseQuery): string {
  const params = new URLSearchParams({
    sort: query.sort,
    offset: String(query.offset),
    limit: String(query.limit),
  })
  if (query.text.trim()) params.set("text", query.text.trim())
  if (query.state !== "all") params.set("state", query.state)
  if (query.tag) params.set("tag", query.tag)
  if (query.deckId) params.set("deckId", query.deckId)
  if (query.cardTypeId) params.set("cardTypeId", query.cardTypeId)
  // Zero is a filter, so these test for null rather than for truthiness.
  if (query.minLapses !== null) params.set("minLapses", String(query.minLapses))
  if (query.maxLapses !== null) params.set("maxLapses", String(query.maxLapses))
  if (query.sortDescending) params.set("desc", "true")
  return `/cards?${params.toString()}`
}

export function useBrowseCardsQuery(query: BrowseQuery) {
  return useQuery<CardPageDto, ApiError>({
    queryKey: [...browseKey, "cards", query],
    queryFn: () => apiFetch<CardPageDto>(browsePath(query)),
    // Without this the table blanks to its empty state on every keystroke and page
    // step; keeping the last page on screen matches the deck table's loading wash.
    placeholderData: (previous) => previous,
  })
}

/** Distinct tags across the whole collection, for the filter menu. */
export function useBrowseTagsQuery() {
  return useQuery<string[], ApiError>({
    queryKey: [...browseKey, "card-tags"],
    queryFn: () => apiFetch<string[]>("/card-tags"),
  })
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

/**
 * Every mutation here invalidates the browse list, every open deck (a selection can span
 * decks, so there is no single deck key to name) and the library, since card counts, due
 * counts and retention all appear there too.
 */
function useBrowseMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, TArgs>({
    mutationFn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: browseKey })
      await client.invalidateQueries({ queryKey: everyDeckKey })
      await client.invalidateQueries({ queryKey: libraryKey })
    },
  })
}

export function useBrowseDeleteCards() {
  return useBrowseMutation((cardIds: string[]) => apiSend("/cards/delete", json({ cardIds })))
}

export function useBrowseMoveCards() {
  return useBrowseMutation(({ cardIds, targetDeckId }: { cardIds: string[]; targetDeckId: string }) =>
    apiSend("/cards/move", json({ cardIds, targetDeckId })),
  )
}

export function useBrowseSuspendCards() {
  return useBrowseMutation(({ cardIds, value }: { cardIds: string[]; value: boolean }) =>
    apiSend("/cards/suspend", json({ cardIds, value })),
  )
}

export function useBrowseFlagCards() {
  return useBrowseMutation(({ cardIds, value }: { cardIds: string[]; value: boolean }) =>
    apiSend("/cards/flag", json({ cardIds, value })),
  )
}

export function useBrowseTagCards() {
  return useBrowseMutation(({ cardIds, tag }: { cardIds: string[]; tag: string }) =>
    apiSend("/cards/tag", json({ cardIds, tag })),
  )
}
