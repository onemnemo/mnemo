import { useQuery } from "@tanstack/react-query"

import { apiFetch, type ApiError } from "@/api/client"
import type { NoteDto } from "@/api/types"

/**
 * The peek's own copy of a note, under its own key.
 *
 * It must not observe the key the writable pane reads. That entry is not a cache of the
 * server, it is the truth: autosave patches it with the blocks it just sent rather than
 * invalidating it, so that reopening the note builds from what was typed instead of from
 * the version that predates it. A second observer with the default zero stale time
 * refetches on mount and writes the server's answer over that patch, rolling the entry
 * backwards mid debounce. The pane then rebuilds from the older body at the older
 * version, and the next commit is a stale write the authority holds as a conflict until
 * the note is reloaded.
 *
 * The refresh counter is part of the key, and that is what makes Refresh a read. A
 * remount alone cannot be one: the entry is never stale and the remount does not ask, and
 * a key change unmounts and remounts inside a single synchronous commit, so React Query's
 * own eviction is a timer that has no gap to run in. A counter the panel owns is
 * an entry nothing has fetched yet, which is the only thing that reliably asks the server
 * again. Nothing else moves the document under the reader: this key sits outside
 * `["notes", ...]`, so the invalidation every note mutation runs cannot reach it.
 */
export const peekNoteKey = (id: string, refresh: number) => ["peek", "note", id, refresh] as const

export function usePeekNoteQuery(id: string, refresh: number) {
  return useQuery<NoteDto, ApiError>({
    queryKey: peekNoteKey(id, refresh),
    queryFn: () => apiFetch<NoteDto>(`/notes/${id}`),
    staleTime: Infinity,
    // Nothing reads a superseded refresh, so it goes as soon as its renderer does.
    gcTime: 0,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    // A note that is gone will not come back on a retry.
    retry: (_count, error) => error.status !== 404,
  })
}
