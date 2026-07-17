import { useQuery } from "@tanstack/react-query"

import { apiFetch, ApiError } from "@/api/client"
import type { DeckSummaryDto } from "@/api/types"

export function useDecksQuery() {
  return useQuery<DeckSummaryDto[], ApiError>({
    queryKey: ["decks"],
    queryFn: () => apiFetch<DeckSummaryDto[]>("/decks"),
  })
}
