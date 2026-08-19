import { useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { CardTypeDto, CardTypeSummaryDto, FactDto, FactSavedDto, SaveCardTypeDto, SaveFactDto } from "@/api/types"

export const cardTypesKey = ["flashcards", "card-types"] as const

/**
 * Every card type, with how much material uses each. Collection wide rather than per deck, so this
 * is one cache the editor and the type manager share.
 */
export function useCardTypesQuery(enabled = true) {
  return useQuery<CardTypeSummaryDto[], ApiError>({
    queryKey: cardTypesKey,
    queryFn: () => apiFetch<CardTypeSummaryDto[]>("/card-types"),
    enabled,
  })
}

/**
 * The material behind a card, for opening the editor from a row someone clicked. Keyed by card
 * because that is what the caller has; a save invalidates the whole flashcard tree anyway.
 */
export function useFactForCardQuery(cardId: string | null) {
  return useQuery<FactDto, ApiError>({
    queryKey: ["flashcards", "fact-for-card", cardId],
    queryFn: () => apiFetch<FactDto>(`/cards/${cardId}/fact`),
    enabled: cardId !== null,
    // Material that is not there is not going to appear on a retry.
    retry: (_count, error) => error.status !== 404,
  })
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function saveFact(body: SaveFactDto): Promise<FactSavedDto> {
  return body.id
    ? apiFetch<FactSavedDto>(`/facts/${body.id}`, { ...json(body), method: "PUT" })
    : apiFetch<FactSavedDto>("/facts", json(body))
}

export function deleteFacts(factIds: string[]): Promise<void> {
  return apiSend("/facts/delete", json({ factIds }))
}

export function saveCardType(body: SaveCardTypeDto): Promise<CardTypeDto> {
  return body.id
    ? apiFetch<CardTypeDto>(`/card-types/${body.id}`, { ...json(body), method: "PUT" })
    : apiFetch<CardTypeDto>("/card-types", json(body))
}

export function deleteCardType(typeId: string): Promise<void> {
  return apiSend(`/card-types/${typeId}`, { method: "DELETE" })
}

/**
 * Invalidates everything flashcards after material or a card type is written.
 *
 * Saving material adds and removes whole cards, and editing a type does that to every fact using
 * it, so deck rows, due counts and any open queue are all downstream. Naming the affected caches
 * would mean knowing which decks those are; the root key is honest instead.
 */
export function useRefreshAfterFactWrite() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ["flashcards"] })
}
