import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type {
  CardPageDto,
  CardSort,
  CardStateFilter,
  CardType,
  CardDto,
  CreateCardDto,
  DeckSummaryDto,
  UpdateCardDto,
} from "@/api/types"

import { deckKey, libraryKey } from "../api"

// Re-exported from where it is declared, so the existing importers here keep
// working. Card mutations still have to invalidate the library themselves, since
// adding or deleting a card moves the deck's counts on the library page.
export { deckKey }

// The prefix every deck's card key sits under. A move puts cards in a second deck
// that this hook was never scoped to, so it needs the wider net the collection-wide
// browser already casts in ../browse/api.ts, not just the deck the mutation started from.
const everyDeckKey = ["flashcards", "deck"] as const

export interface CardQuery {
  text: string
  state: CardStateFilter
  tag: string | null
  type: CardType | null
  /** Inclusive bounds on lapses. "Never forgotten" is maxLapses 0, not minLapses 0. */
  minLapses: number | null
  maxLapses: number | null
  sort: CardSort
  sortDescending: boolean
  offset: number
  limit: number
}

function cardsPath(deckId: string, query: CardQuery): string {
  const params = new URLSearchParams({
    sort: query.sort,
    offset: String(query.offset),
    limit: String(query.limit),
  })
  if (query.text.trim()) params.set("text", query.text.trim())
  if (query.state !== "all") params.set("state", query.state)
  if (query.tag) params.set("tag", query.tag)
  if (query.type) params.set("type", query.type)
  // Zero is a filter, so these test for null rather than for truthiness.
  if (query.minLapses !== null) params.set("minLapses", String(query.minLapses))
  if (query.maxLapses !== null) params.set("maxLapses", String(query.maxLapses))
  if (query.sortDescending) params.set("desc", "true")
  return `/decks/${deckId}/cards?${params.toString()}`
}

export function useDeckQuery(deckId: string) {
  return useQuery<DeckSummaryDto, ApiError>({
    queryKey: [...deckKey(deckId), "summary"],
    queryFn: () => apiFetch<DeckSummaryDto>(`/decks/${deckId}`),
    // A deck that no longer exists is a navigation signal, not a transient failure.
    retry: (_count, error) => error.status !== 404,
  })
}

export function useCardsQuery(deckId: string, query: CardQuery) {
  return useQuery<CardPageDto, ApiError>({
    queryKey: [...deckKey(deckId), "cards", query],
    queryFn: () => apiFetch<CardPageDto>(cardsPath(deckId, query)),
    // Without this the table blanks to its empty state on every keystroke and page
    // step; keeping the last page on screen matches the desktop's loading wash.
    placeholderData: (previous) => previous,
  })
}

/** Distinct tags across the whole deck, for the filter menu. */
export function useCardTagsQuery(deckId: string) {
  return useQuery<string[], ApiError>({
    queryKey: [...deckKey(deckId), "card-tags"],
    queryFn: () => apiFetch<string[]>(`/decks/${deckId}/card-tags`),
  })
}

/**
 * Every card id in a deck, walked a page at a time. Backs "suspend all cards",
 * which the batch endpoints express as an explicit id list rather than a
 * deck-wide statement.
 */
export async function fetchAllCardIds(deckId: string): Promise<string[]> {
  const ids: string[] = []
  const limit = 200
  for (let offset = 0; ; offset += limit) {
    const page = await apiFetch<CardPageDto>(`/decks/${deckId}/cards?offset=${offset}&limit=${limit}`)
    ids.push(...page.items.map((item) => item.card.id))
    if (offset + limit >= page.totalCount) return ids
  }
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

/**
 * Every card mutation invalidates both this deck and the library: card counts,
 * due counts and retention all appear on the library page too.
 */
function useCardMutation<TArgs>(deckId: string, mutationFn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, TArgs>({
    mutationFn,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: deckKey(deckId) })
      await client.invalidateQueries({ queryKey: libraryKey })
    },
  })
}

export function useCreateCard(deckId: string) {
  return useCardMutation(deckId, (body: CreateCardDto) =>
    apiFetch<CardDto>(`/decks/${deckId}/cards`, json(body)),
  )
}

export function useUpdateCard(deckId: string) {
  return useCardMutation(deckId, ({ id, ...body }: UpdateCardDto & { id: string }) =>
    apiSend(`/cards/${id}`, { ...json(body), method: "PUT" }),
  )
}

export function useDeleteCards(deckId: string) {
  return useCardMutation(deckId, (cardIds: string[]) => apiSend("/cards/delete", json({ cardIds })))
}

// Its own hook rather than useCardMutation: a move's target deck is never the
// deckId this page is scoped to, so it has to invalidate every open deck's cache,
// the same way a cross-deck selection on the browse page already does. The
// parameter stays, unused, so the call site reads the same as every sibling
// hook in this file.
export function useMoveCards(_deckId: string) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, { cardIds: string[]; targetDeckId: string }>({
    mutationFn: ({ cardIds, targetDeckId }) => apiSend("/cards/move", json({ cardIds, targetDeckId })),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: everyDeckKey })
      await client.invalidateQueries({ queryKey: libraryKey })
    },
  })
}

export function useSuspendCards(deckId: string) {
  return useCardMutation(deckId, ({ cardIds, value }: { cardIds: string[]; value: boolean }) =>
    apiSend("/cards/suspend", json({ cardIds, value })),
  )
}

export function useFlagCards(deckId: string) {
  return useCardMutation(deckId, ({ cardIds, value }: { cardIds: string[]; value: boolean }) =>
    apiSend("/cards/flag", json({ cardIds, value })),
  )
}

export function useTagCards(deckId: string) {
  return useCardMutation(deckId, ({ cardIds, tag }: { cardIds: string[]; tag: string }) =>
    apiSend("/cards/tag", json({ cardIds, tag })),
  )
}
