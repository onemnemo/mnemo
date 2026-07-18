import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type {
  CardPageDto,
  CardSort,
  CardStateFilter,
  CardDto,
  CreateCardDto,
  DeckSummaryDto,
  UpdateCardDto,
} from "@/api/types"

import { libraryKey } from "../api"

// Card queries sit under their own deck key rather than nested inside the library
// key, so renaming a deck does not refetch every card page. The trade is that card
// mutations have to invalidate the library themselves - which they must anyway,
// since adding or deleting a card moves the deck's counts on the library page.
export const deckKey = (deckId: string) => ["flashcards", "deck", deckId] as const

export interface CardQuery {
  text: string
  state: CardStateFilter
  tag: string | null
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

export function useMoveCards(deckId: string) {
  return useCardMutation(deckId, ({ cardIds, targetDeckId }: { cardIds: string[]; targetDeckId: string }) =>
    apiSend("/cards/move", json({ cardIds, targetDeckId })),
  )
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
