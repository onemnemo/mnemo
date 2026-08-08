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

import { useCallback } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type { OverviewLayoutDto, StatRecordDto } from "@/api/types"

export const overviewKey = ["overview"] as const
export const layoutKey = [...overviewKey, "layout"] as const
export const statRecordKey = (ns: string, kind: string, key: string) =>
  [...overviewKey, "stat", ns, kind, key] as const
export const statRecordsKey = (ns: string, kind: string, limit: number, descending: boolean) =>
  [...overviewKey, "stats", ns, kind, limit, descending] as const
export const statDailyKey = (ns: string, kind: string, from: string, to: string) =>
  [...overviewKey, "daily", ns, kind, from, to] as const

/**
 * Whole-library reads that fan out over every deck.
 *
 * One key for the fan-out rather than one per deck, because the widgets behind them need every
 * answer or none: a partial set gives a weighted mean over the decks that happened to arrive, and
 * a per-deck key would let the cache serve exactly that. The deck ids are part of the key, so
 * adding or removing a deck asks again instead of reusing a set that no longer describes the
 * library.
 */
export const deckFanOutRoot = (name: string) => [...overviewKey, "decks", name] as const
export const deckFanOutKey = (name: string, deckIds: readonly string[]) =>
  [...deckFanOutRoot(name), deckIds.join(",")] as const

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

export interface OverviewBoardResult {
  board: OverviewBoard
  /**
   * When the last fetch settled, however it settled.
   *
   * The caller mirrors the load into a store, and a retry that fails the same way as the first
   * attempt changes nothing else on the query: the status stays `error` and the error is often the
   * same object. Without a value that moves on every settled fetch, that retry is indistinguishable
   * from no retry and the mirror never runs again.
   */
  settledAt: number
  /** Re-runs the load. The only way out of the error state. */
  retry: () => void
  /**
   * Records a board the client has just written as the current answer.
   *
   * Without this the cache still holds whatever the last GET said until the write lands and the
   * refetch answers, and for the never-saved answer that stale `null` is dangerous: anything that
   * remounts the page in that window reads "no board has ever been saved" a second time and seeds
   * a second starter board over the first. Publishing is synchronous, so the window closes in the
   * same turn the write opens it.
   */
  publish: (layout: OverviewLayoutDto) => void
}

/** The board for this profile, as one of {@link OverviewBoard}'s four states. */
export function useOverviewBoard(): OverviewBoardResult {
  const client = useQueryClient()
  const query = useQuery<OverviewLayoutDto | null, ApiError>({
    queryKey: layoutKey,
    queryFn: loadOverviewLayout,
  })

  // Both are stable, because the caller hands `publish` to the store as part of a save sink it
  // installs once. A fresh identity every render would reinstall that sink on every render.
  const retry = useCallback(() => void client.invalidateQueries({ queryKey: layoutKey }), [client])
  const publish = useCallback((layout: OverviewLayoutDto) => void client.setQueryData(layoutKey, layout), [client])

  return {
    board: toOverviewBoard(query),
    settledAt: Math.max(query.dataUpdatedAt, query.errorUpdatedAt),
    retry,
    publish,
  }
}

/**
 * One statistics record, or null when this profile has never had one written under that triple.
 *
 * Null is the ordinary answer on a fresh install, not a failure: nothing writes a daily summary
 * for a day the user has not studied. Widgets render zeroes for it, and keep the error state for
 * a read that actually failed.
 */
export function useStatRecord(ns: string, kind: string, key: string) {
  return useQuery<StatRecordDto | null, ApiError>({
    queryKey: statRecordKey(ns, kind, key),
    queryFn: () => {
      const query = new URLSearchParams({ ns, kind, key })
      return apiFetch<StatRecordDto | null>(`/stats/record?${query}`)
    },
  })
}

/**
 * The most recently written records of one kind, newest first.
 *
 * The limit is the caller's, not a page size: the desktop widgets pass a fixed ceiling and then
 * filter what came back, so passing the same ceiling here keeps the two apps looking at the same
 * set of rows rather than at two differently truncated ones.
 */
export function useStatRecords(ns: string, kind: string, limit: number, descending: boolean) {
  return useQuery<StatRecordDto[], ApiError>({
    queryKey: statRecordsKey(ns, kind, limit, descending),
    queryFn: () => {
      const query = new URLSearchParams({ ns, kind, limit: String(limit), desc: String(descending) })
      return apiFetch<StatRecordDto[]>(`/stats/records?${query}`)
    },
  })
}

/**
 * Every day-keyed record in an inclusive day range, ascending by day and sparse.
 *
 * Sparse because nothing writes a summary for a day the user did not study, so a caller sums what
 * arrived rather than expecting one row per day. Build the range with `utcDayWindow` instead of
 * subtracting days by hand; the endpoint's bounds are inclusive at both ends.
 *
 * A disabled read stays pending forever rather than resolving empty, so a caller that turns one
 * off has to leave it out of its own loading rule as well.
 */
export function useStatDaily(ns: string, kind: string, from: string, to: string, enabled = true) {
  return useQuery<StatRecordDto[], ApiError>({
    queryKey: statDailyKey(ns, kind, from, to),
    queryFn: () => {
      const query = new URLSearchParams({ ns, kind, from, to })
      return apiFetch<StatRecordDto[]>(`/stats/daily?${query}`)
    },
    enabled,
  })
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
