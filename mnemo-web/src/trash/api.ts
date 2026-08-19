import { useCallback } from "react"
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiFetchExpecting, type ApiError } from "@/api/client"
import type {
  TrashCountDto,
  TrashEmptyResultDto,
  TrashPageDto,
  TrashPurgeResultDto,
  TrashRestoreResponseDto,
} from "@/trash/types"

/**
 * Query keys for the trash.
 *
 * Everything invalidates the whole key rather than patching caches by hand: a restore puts
 * content back into whichever module owned it, so the deck list, the note tree and the mindmap
 * library are all potentially stale afterwards, and so is the page the row was on.
 */
export const trashKey = ["trash"] as const
const countKey = [...trashKey, "count"] as const
const listKey = [...trashKey, "list"] as const

/** Every module list a restore can put content back into. */
const OWNER_KEYS = [["flashcards", "library"], ["notes"], ["mindmap"]] as const

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ""
}

/** One page of the trash, newest first. */
export function fetchTrash(options: { cursor?: string; limit?: number; kind?: string; query?: string } = {}) {
  return apiFetch<TrashPageDto>(`/trash${query(options)}`)
}

export function fetchTrashCount() {
  return apiFetch<TrashCountDto>("/trash/count")
}

export function restoreEntries(entryIds: string[], destinationId?: string) {
  return apiFetch<TrashRestoreResponseDto>("/trash/restore", json({ entryIds, destinationId: destinationId ?? null }))
}

/** Undo: everything one delete took, back where it was. */
export function restoreBatch(batchId: string) {
  return apiFetch<TrashRestoreResponseDto>(`/trash/batches/${encodeURIComponent(batchId)}/restore`, { method: "POST" })
}

/**
 * Destroys one entry for good.
 *
 * A 409 is not a failure to report as one: it means another entry is holding content this
 * destruction would reach, and its body names those entries so the page can say which. The
 * caller reads `purged` rather than assuming success.
 */
export async function purgeEntry(entryId: string): Promise<TrashPurgeResultDto> {
  const { data } = await apiFetchExpecting<TrashPurgeResultDto>(`/trash/${encodeURIComponent(entryId)}`, [409], {
    method: "DELETE",
  })
  return data
}

export function emptyTrash() {
  return apiFetch<TrashEmptyResultDto>("/trash/empty", { method: "POST" })
}

/**
 * The trash, filtered, a page at a time.
 *
 * Cursor paging rather than a growing limit: the list is ordered by deletion time and the
 * expiry sweep removes from the far end of it, so an offset would skip a row whenever something
 * expired between two pages. The filter is part of the key, so changing it starts a new list
 * instead of appending rows gathered under different terms.
 */
export function useTrashQuery(filters: { kind?: string; query?: string } = {}) {
  return useInfiniteQuery({
    queryKey: [...listKey, filters.kind ?? "", filters.query ?? ""],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => fetchTrash({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: TrashPageDto) => last.nextCursor ?? undefined,
  })
}

/**
 * The number on the badge.
 *
 * Refetched whenever the window is focused, because the count also moves without anybody
 * touching this app: expiry runs on the host, and content deleted in another window lands here.
 */
export function useTrashCountQuery() {
  return useQuery<TrashCountDto, ApiError>({
    queryKey: countKey,
    queryFn: fetchTrashCount,
    refetchOnWindowFocus: true,
  })
}

/**
 * Invalidates the trash and every module list a restore could have written into.
 *
 * Stable, so a presenter can hold it in a memoized callback rather than rebuilding one on every
 * render of whatever page happens to own the delete.
 */
export function useTrashInvalidator() {
  const client = useQueryClient()
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: trashKey })
    for (const key of OWNER_KEYS) void client.invalidateQueries({ queryKey: key })
  }, [client])
}

export function useRestoreMutation() {
  const invalidate = useTrashInvalidator()
  return useMutation<TrashRestoreResponseDto, ApiError, { entryIds: string[]; destinationId?: string }>({
    mutationFn: ({ entryIds, destinationId }) => restoreEntries(entryIds, destinationId),
    onSuccess: invalidate,
  })
}

export function usePurgeMutation() {
  const invalidate = useTrashInvalidator()
  return useMutation<TrashPurgeResultDto, ApiError, string>({
    mutationFn: purgeEntry,
    onSuccess: invalidate,
  })
}

export function useEmptyTrashMutation() {
  const invalidate = useTrashInvalidator()
  return useMutation<TrashEmptyResultDto, ApiError, void>({
    mutationFn: emptyTrash,
    onSuccess: invalidate,
  })
}
