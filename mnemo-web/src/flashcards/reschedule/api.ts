import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { NewQueueDto, RepositionCardsDto, ResetCardsDto, SetCardsDueDto } from "@/api/types"

import { deckKey, libraryKey } from "../api"
import { browseKey } from "../browse/api"
import type { RescheduleRequest } from "./reschedule"

// The prefix every deck's card key sits under. The dialog serves both the deck page and the
// cross-deck browser, so a mutation reaches every open deck rather than one it was scoped to.
const everyDeckKey = ["flashcards", "deck"] as const

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

/** The route and body a reschedule request maps to. */
export function rescheduleCall(request: RescheduleRequest): { path: string; body: SetCardsDueDto | ResetCardsDto | RepositionCardsDto } {
  switch (request.mode) {
    case "due":
      return {
        path: "/cards/reschedule/due",
        body: { cardIds: request.cardIds, days: request.days, matchInterval: request.matchInterval },
      }
    case "reset":
      return { path: "/cards/reschedule/reset", body: { cardIds: request.cardIds, keepCounts: request.keepCounts } }
    case "position":
      return {
        path: "/cards/reschedule/position",
        body: { cardIds: request.cardIds, place: request.place, position: request.position },
      }
  }
}

/**
 * Applies one reschedule request. Invalidates the browse list, every open deck and the library:
 * a due date moves the deck's due counts, and a start-over moves its new count, both of which
 * the library page shows.
 */
export function useRescheduleCards() {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, RescheduleRequest>({
    mutationFn: (request) => {
      const { path, body } = rescheduleCall(request)
      return apiSend(path, json(body))
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: browseKey })
      await client.invalidateQueries({ queryKey: everyDeckKey })
      await client.invalidateQueries({ queryKey: libraryKey })
    },
  })
}

/**
 * How many new cards a deck's queue holds, for the placement sentence. Keyed under the deck so
 * every card mutation on the deck refreshes it. Disabled with no deck, which is what a selection
 * whose new cards span decks passes.
 */
export function useNewQueueQuery(deckId: string | null) {
  return useQuery<NewQueueDto, ApiError>({
    queryKey: [...deckKey(deckId ?? ""), "new-queue"],
    queryFn: () => apiFetch<NewQueueDto>(`/decks/${deckId}/new-queue`),
    enabled: deckId !== null,
  })
}
