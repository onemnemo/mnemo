import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type {
  CreateDeckDto,
  DeckSummaryDto,
  DueCountsDto,
  FolderDto,
  MoveDeckDto,
  RetentionTrendPointDto,
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

/**
 * One deck's retention day by day, always exactly `days` points and zero-filled for days with no
 * reviews. The service honours a ceiling of 90 whatever is asked for.
 *
 * A plain function rather than a hook: its callers fan out over every deck behind a single query
 * of their own, and a hook cannot be called in a loop.
 */
export function fetchRetentionTrend(deckId: string, days: number): Promise<RetentionTrendPointDto[]> {
  return apiFetch<RetentionTrendPointDto[]>(`/decks/${encodeURIComponent(deckId)}/retention-trend?days=${days}`)
}

/**
 * Card queries sit under their own deck key rather than nested inside the library
 * key, so renaming a deck does not refetch every card page. Declared here beside
 * the library key so a mutation can reach both without importing back from the
 * deck module.
 */
export const deckKey = (deckId: string) => ["flashcards", "deck", deckId] as const

function useLibraryMutation<TArgs>(
  mutationFn: (args: TArgs) => Promise<unknown>,
  /** Keys outside the library that this mutation also invalidates. */
  alsoInvalidate?: (args: TArgs) => readonly (readonly unknown[])[],
) {
  const client = useQueryClient()
  return useMutation<unknown, ApiError, TArgs>({
    mutationFn,
    onSuccess: (_result, args) => {
      void client.invalidateQueries({ queryKey: libraryKey })
      for (const queryKey of alsoInvalidate?.(args) ?? []) void client.invalidateQueries({ queryKey })
    },
  })
}

export function useCreateDeck() {
  return useLibraryMutation((body: CreateDeckDto) => apiFetch<DeckSummaryDto>("/decks", json(body)))
}

export function useUpdateDeck() {
  return useLibraryMutation(
    ({ id, ...body }: UpdateDeckDto & { id: string }) =>
      apiSend(`/decks/${id}`, { ...json(body), method: "PUT" }),
    // An open deck page reads its own summary, which is not under the library key,
    // so without this a rename or a new icon does not reach the header until the
    // page is left and reopened.
    ({ id }) => [[...deckKey(id), "summary"]],
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

/** One reorganize's worth of writes: folder rows to save, and at most one deck to re-home. */
export interface LibraryWrites {
  folders: (SaveFolderDto & { id: string })[]
  deck?: MoveDeckDto & { id: string }
}

/**
 * Applies a reorganize as a single unit of work. Reordering renumbers every sibling that
 * shifted and there is no batch endpoint for folders, so the writes go out one at a time - but
 * the library is invalidated once at the end rather than per write, or the tree would repaint
 * itself mid-move. Invalidated on failure too: a run that stops half way still moved rows.
 */
export function useApplyLibraryMove() {
  const client = useQueryClient()
  return useMutation<void, ApiError, LibraryWrites>({
    mutationFn: async ({ folders, deck }) => {
      for (const { id, ...body } of folders) {
        await apiSend(`/deck-folders/${id}`, { ...json(body), method: "PUT" })
      }
      if (deck) {
        const { id, ...body } = deck
        await apiSend(`/decks/${id}/move`, json(body))
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: libraryKey }),
  })
}
