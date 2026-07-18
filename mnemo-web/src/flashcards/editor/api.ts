import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { CardDto, CreateCardDto, UpdateCardDto } from "@/api/types"

import { deckKey } from "../deck/api"

/**
 * A single card, for the editor's edit mode. It hangs off the card's own deck key so saving it
 * refetches with everything else on that deck rather than leaving a stale copy behind.
 */
export function useCardQuery(deckId: string, cardId: string | null) {
  return useQuery<CardDto, ApiError>({
    queryKey: [...deckKey(deckId), "card", cardId],
    queryFn: () => apiFetch<CardDto>(`/cards/${cardId}`),
    enabled: cardId !== null,
    // A card that no longer exists is not going to appear on a retry.
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

/**
 * Saving from the editor invalidates every flashcard query rather than one deck's, because the
 * deck picker can re-home the card: the deck it left and the deck it joined both changed, and
 * the editor is not the right place to reason about which caches those were.
 */
function useEditorSave<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, TArgs>({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: ["flashcards"] }),
  })
}

export function useCreateCard() {
  return useEditorSave(({ deckId, ...body }: CreateCardDto & { deckId: string }) =>
    apiFetch<CardDto>(`/decks/${deckId}/cards`, json(body)),
  )
}

export function useUpdateCard() {
  return useEditorSave(({ cardId, ...body }: UpdateCardDto & { cardId: string }) =>
    apiSend(`/cards/${cardId}`, { ...json(body), method: "PUT" }),
  )
}
