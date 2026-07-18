import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type {
  CreateDeckDto,
  DeckSummaryDto,
  DueCountsDto,
  FolderDto,
  MoveDeckDto,
  SaveFolderDto,
  UpdateDeckDto,
} from "@/api/types"

// Query keys for the library. Every mutation invalidates the whole library key
// rather than patching caches by hand: folder and deck moves change counts,
// aggregates and ordering together, so a partial update is a bug waiting to happen.
export const libraryKey = ["flashcards", "library"] as const
const decksKey = [...libraryKey, "decks"] as const
const foldersKey = [...libraryKey, "folders"] as const
const aggregateDueKey = [...libraryKey, "due"] as const

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

export function useDecksQuery() {
  return useQuery<DeckSummaryDto[], ApiError>({
    queryKey: decksKey,
    queryFn: () => apiFetch<DeckSummaryDto[]>("/decks"),
  })
}

export function useFoldersQuery() {
  return useQuery<FolderDto[], ApiError>({
    queryKey: foldersKey,
    queryFn: () => apiFetch<FolderDto[]>("/deck-folders"),
  })
}

/**
 * Due counts across every deck, each capped by its own preset's daily limits.
 * The library banner reports this rather than summing the visible rows, so a
 * search filter never changes what it says is waiting.
 */
export function useAggregateDueQuery() {
  return useQuery<DueCountsDto, ApiError>({
    queryKey: aggregateDueKey,
    queryFn: () => apiFetch<DueCountsDto>("/study/due"),
  })
}

function useLibraryMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, TArgs>({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: libraryKey }),
  })
}

export function useCreateDeck() {
  return useLibraryMutation((body: CreateDeckDto) => apiFetch<DeckSummaryDto>("/decks", json(body)))
}

export function useUpdateDeck() {
  return useLibraryMutation(({ id, ...body }: UpdateDeckDto & { id: string }) =>
    apiSend(`/decks/${id}`, { ...json(body), method: "PUT" }),
  )
}

export function useDeleteDeck() {
  return useLibraryMutation((id: string) => apiSend(`/decks/${id}`, { method: "DELETE" }))
}

export function useMoveDeck() {
  return useLibraryMutation(({ id, ...body }: MoveDeckDto & { id: string }) =>
    apiSend(`/decks/${id}/move`, json(body)),
  )
}

export function useCreateFolder() {
  return useLibraryMutation((body: SaveFolderDto) => apiFetch<FolderDto>("/deck-folders", json(body)))
}

export function useSaveFolder() {
  return useLibraryMutation(({ id, ...body }: SaveFolderDto & { id: string }) =>
    apiSend(`/deck-folders/${id}`, { ...json(body), method: "PUT" }),
  )
}

/** Deletes a folder; the server lifts its decks and subfolders to the root. */
export function useDeleteFolder() {
  return useLibraryMutation((id: string) => apiSend(`/deck-folders/${id}`, { method: "DELETE" }))
}
