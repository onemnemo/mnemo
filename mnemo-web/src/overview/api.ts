// The overview board's persistence, over Mnemo.Host/Overview/OverviewEndpoints.cs.
//
// DTO types live in @/api/types and are hand-mirrored from Mnemo.Host/Contracts; nothing here
// redeclares a wire shape.
//
// The load answers three things, and the difference between two of them is the whole reason this
// endpoint is careful: `null` means this profile has never saved a board and the caller should
// seed the default one, while a thrown ApiError means the board could not be read. Seeding
// defaults on the error path would write a starter board over one that is still on disk, so the
// error state renders an error and saves nothing.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { OverviewLayoutDto } from "@/api/types"

export const overviewKey = ["overview"] as const
export const layoutKey = [...overviewKey, "layout"] as const

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

/**
 * The saved board, or null when this profile has never saved one.
 *
 * Null is a real answer carried in a 200 body, not an empty response: the fetch wrapper parses
 * every body it gets, so a 204 would throw a parse error rather than an ApiError and nothing
 * downstream could classify it. A throw is the third answer and never means "no board".
 */
export function loadOverviewLayout(): Promise<OverviewLayoutDto | null> {
  return apiFetch<OverviewLayoutDto | null>("/overview/layout")
}

/**
 * What a caller is allowed to know about the board.
 *
 * Four states rather than the query's `data`/`error` pair, because that pair collapses at exactly
 * the point this endpoint spends the most effort keeping apart. React Query leaves `data`
 * undefined while a request is in flight *and* after it fails, and `null` is the never-saved
 * answer, so `if (!data) seedDefaultBoard()` typechecks and quietly writes a starter board over a
 * board that is merely unreadable this once. Here only `empty` says "nothing was ever saved", and
 * it is the one state that carries nothing else, so the collapse has nowhere to happen.
 */
export type OverviewBoard =
  | { kind: "loading" }
  | { kind: "loaded"; layout: OverviewLayoutDto }
  | { kind: "empty" }
  | { kind: "error"; error: ApiError }

/**
 * The part of a query result the classification reads, stated as a union so the pending and
 * failed cases cannot offer a board and the successful one cannot offer an error.
 */
export type OverviewLayoutQueryState =
  | { status: "pending" }
  | { status: "error"; error: ApiError }
  | { status: "success"; data: OverviewLayoutDto | null }

/**
 * Classifies a load. Split from the hook so it can be tested without a renderer.
 *
 * Switches on `status`, never on `data`: data is undefined for two unrelated reasons and null for
 * a third, and only one of the three may lead to a write.
 */
export function toOverviewBoard(query: OverviewLayoutQueryState): OverviewBoard {
  switch (query.status) {
    case "pending":
      return { kind: "loading" }
    case "error":
      return { kind: "error", error: query.error }
    case "success":
      // An empty widget list is a board the user deliberately cleared, not an absent one, so it
      // stays "loaded" and nothing reseeds it.
      return query.data === null ? { kind: "empty" } : { kind: "loaded", layout: query.data }
  }
}

/** The board for this profile, as one of {@link OverviewBoard}'s four states. */
export function useOverviewBoard(): OverviewBoard {
  const query = useQuery<OverviewLayoutDto | null, ApiError>({
    queryKey: layoutKey,
    queryFn: loadOverviewLayout,
  })
  return toOverviewBoard(query)
}

/**
 * Writes the whole board. Invalidates the layout key alone rather than the module root, unlike
 * the library and notes mutations: widget contents have nothing to do with where tiles sit, and
 * invalidating the root would refetch every widget's data each time someone drags a tile.
 */
export function useSaveOverviewLayout() {
  const client = useQueryClient()
  return useMutation<void, ApiError, OverviewLayoutDto>({
    mutationFn: (layout) => apiSend("/overview/layout", { ...json(layout), method: "PUT" }),
    onSuccess: () => client.invalidateQueries({ queryKey: layoutKey }),
  })
}
