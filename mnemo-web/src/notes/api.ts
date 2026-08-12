import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiFetchExpecting, apiSend, ApiError } from "@/api/client"
import { queryClient } from "@/app/query-client"
import type { ReorderPlan } from "./tree/reorder"
import type {
  CommitNoteContentDto,
  CreateNoteDto,
  NoteCommitResultDto,
  NoteDto,
  NoteFolderDto,
  NoteSummaryDto,
  SaveNoteFolderDto,
  UpdateNoteMetadataDto,
} from "@/api/types"

// Query keys for the notes tree. Mutations invalidate the whole tree rather than
// patching caches by hand: a move changes ordering, folder membership and the
// breadcrumb of everything below it at once, so a partial update goes stale.
export const notesKey = ["notes"] as const
const noteListKey = [...notesKey, "list"] as const
const noteFoldersKey = [...notesKey, "folders"] as const
const noteKey = (id: string) => [...notesKey, "note", id] as const

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }
}

/**
 * Every note without its body, newest-modified first.
 *
 * `enabled` is for the surfaces that only sometimes need the list: a mindmap resolves note
 * references against it, and a map with no note nodes should not be paying for the whole corpus.
 */
export function useNotesQuery(enabled = true) {
  return useQuery<NoteSummaryDto[], ApiError>({
    queryKey: noteListKey,
    queryFn: () => apiFetch<NoteSummaryDto[]>("/notes"),
    enabled,
  })
}

export function useNoteFoldersQuery() {
  return useQuery<NoteFolderDto[], ApiError>({
    queryKey: noteFoldersKey,
    queryFn: () => apiFetch<NoteFolderDto[]>("/note-folders"),
  })
}

/**
 * One note including its stored blocks. Kept under its own key rather than derived
 * from the list, because the list deliberately carries no bodies.
 */
export function useNoteQuery(id: string | undefined) {
  return useQuery<NoteDto, ApiError>({
    queryKey: noteKey(id ?? ""),
    queryFn: () => apiFetch<NoteDto>(`/notes/${id!}`),
    enabled: Boolean(id),
    // A note that is gone will not come back on a retry - surface the failed
    // state at once rather than sitting on the loading skeleton through a backoff.
    retry: (_count, error) => error.status !== 404,
  })
}

function useNotesMutation<TArgs, TResult = unknown>(mutationFn: (args: TArgs) => Promise<TResult>) {
  const client = useQueryClient()
  return useMutation<TResult, ApiError, TArgs>({
    mutationFn,
    onSuccess: () => client.invalidateQueries({ queryKey: notesKey }),
  })
}

export function useCreateNote() {
  return useNotesMutation((body: CreateNoteDto) => apiFetch<NoteDto>("/notes", json(body)))
}

/**
 * The note list read from outside React, for the page cards in the block editor.
 *
 * A page card resolves the note it points at every time ProseMirror builds its view, and a
 * NodeView is not a component: it cannot hold a hook. These read the same cache entry
 * `useNotesQuery` fills, so a card costs no request of its own and follows every rename the
 * tree has already refetched.
 *
 * `noteListLoaded` is separate on purpose. A title that comes back undefined means one of two
 * very different things, the note is gone or the list has not arrived, and only the first is
 * something to tell the user about.
 */
export function noteListLoaded(): boolean {
  return queryClient.getQueryData<NoteSummaryDto[]>(noteListKey) !== undefined
}

export function readCachedNoteTitle(id: string): string | undefined {
  return queryClient.getQueryData<NoteSummaryDto[]>(noteListKey)?.find((note) => note.id === id)?.title
}

export function readCachedNoteEmoji(id: string): string | undefined {
  return queryClient.getQueryData<NoteSummaryDto[]>(noteListKey)?.find((note) => note.id === id)?.emoji ?? undefined
}

/** Fires on every write to the note list, so a card built before the fetch landed can redraw. */
export function subscribeToNoteList(listener: () => void): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey
    if (key[0] === noteListKey[0] && key[1] === noteListKey[1]) listener()
  })
}

/**
 * Creates the nested note a new page block points at, filed where its parent is.
 *
 * Not a hook: the slash menu awaits this before it commits the block, so a card is never
 * written pointing at a note that does not exist. Deliberately untitled, like every other
 * new note in the app; the card renders that as "Untitled" rather than as missing.
 */
export async function createChildNote(parentNoteId: string): Promise<string> {
  const parent = queryClient.getQueryData<NoteSummaryDto[]>(noteListKey)?.find((note) => note.id === parentNoteId)
  const created = await apiFetch<NoteDto>(
    "/notes",
    json({ parentNoteId: parentNoteId || null, folderId: parent?.folderId ?? null } satisfies CreateNoteDto),
  )
  await queryClient.invalidateQueries({ queryKey: notesKey })
  return created.id
}

/**
 * Retitles, files, reorders or favourites a note. A full replace of its metadata,
 * so send the whole summary back, not just the field that changed. Note content is
 * not writable here and is never touched by this call.
 */
export function useUpdateNoteMetadata() {
  return useNotesMutation(({ id, ...body }: UpdateNoteMetadataDto & { id: string }) =>
    apiSend(`/notes/${id}/metadata`, { ...json(body), method: "PUT" }),
  )
}

/**
 * Writes a note's body. The only call that does.
 *
 * Send the `ver` the editor loaded as `baseVer`. A 409 means someone else committed first
 * and the response carries the version actually stored, reload and rebase rather than
 * retrying, which would only conflict again. Keep `requestId` stable while retrying one
 * edit so a lost response resolves as `AlreadyApplied` instead of a spurious conflict.
 */
export function useCommitNoteContent() {
  return useNotesMutation(({ id, ...body }: CommitNoteContentDto & { id: string }) => commitNoteContent(id, body))
}

/**
 * The commit call itself, outside React.
 *
 * Autosave runs from the document authority rather than from a component, so it
 * needs the request without a hook around it. A stale write comes back as 409
 * carrying the version actually stored, which is an answer and not an error,
 * hence `apiFetchExpecting`, so that version survives to the caller instead of
 * being flattened into a thrown message.
 */
export function commitNoteContent(id: string, body: CommitNoteContentDto): Promise<NoteCommitResultDto> {
  return apiFetchExpecting<NoteCommitResultDto>(`/notes/${id}/content`, [409], {
    ...json(body),
    method: "PUT",
  }).then((response) => response.data)
}

/**
 * The commit autosave uses, with the cached note patched to match what landed.
 *
 * Deliberately not an invalidation. Autosave writes every few seconds, and a
 * refetch per write would re-download and re-parse the whole body, on a note
 * built for tens of thousands of blocks, repeatedly, for bytes this client
 * already has. Patching in what was just sent leaves the cache holding the
 * truth at no cost, which matters because reopening the note reads it: without
 * this, a second visit would build the editor from the version that predates
 * everything typed in the first one.
 */
export function useNoteContentCommitter() {
  const client = useQueryClient()
  return async (id: string, body: CommitNoteContentDto): Promise<NoteCommitResultDto> => {
    const result = await commitNoteContent(id, body)
    if (result.outcome === "Applied" || result.outcome === "AlreadyApplied") {
      client.setQueryData<NoteDto>(noteKey(id), (previous) =>
        previous ? { ...previous, blocks: body.blocks, ver: result.ver } : previous,
      )
    }
    return result
  }
}

/**
 * Copies a note: its body, its icon, cover and tags, filed beside the original.
 *
 * Assembled client side from the three calls the API already has, because there
 * is no server-side copy. The order matters: the body is committed against the
 * version the create returned, so the copy is never left as an empty note that
 * autosave could then write over. The copy is deliberately not a favourite and
 * takes a fresh title, so it never reads as the original in the tree.
 */
export function useDuplicateNote() {
  return useNotesMutation(async ({ id, title }: { id: string; title: string }) => {
    const source = await apiFetch<NoteDto>(`/notes/${id}`)
    const copy = await apiFetch<NoteDto>(
      "/notes",
      json({ title, folderId: source.folderId, parentNoteId: source.parentNoteId } satisfies CreateNoteDto),
    )

    const blocks = source.blocks ?? []
    if (blocks.length > 0) {
      await commitNoteContent(copy.id, { baseVer: copy.ver, requestId: crypto.randomUUID(), blocks })
    }

    await apiSend(`/notes/${copy.id}/metadata`, {
      ...json({
        title,
        folderId: copy.folderId,
        parentNoteId: copy.parentNoteId,
        order: copy.order,
        isFavorite: false,
        emoji: source.emoji ?? null,
        cover: source.cover ?? null,
        tags: source.tags ?? [],
      } satisfies UpdateNoteMetadataDto),
      method: "PUT",
    })

    return copy
  })
}

/** Deletes one note. Child pages and links to it survive and render as missing. */
export function useDeleteNote() {
  return useNotesMutation((id: string) => apiSend(`/notes/${id}`, { method: "DELETE" }))
}

export function useCreateNoteFolder() {
  return useNotesMutation((body: SaveNoteFolderDto) => apiFetch<NoteFolderDto>("/note-folders", json(body)))
}

export function useSaveNoteFolder() {
  return useNotesMutation(({ id, ...body }: SaveNoteFolderDto & { id: string }) =>
    apiSend(`/note-folders/${id}`, { ...json(body), method: "PUT" }),
  )
}

/** Deletes a folder; the server lifts its notes and subfolders to the root. */
export function useDeleteNoteFolder() {
  return useNotesMutation((id: string) => apiSend(`/note-folders/${id}`, { method: "DELETE" }))
}

/**
 * Applies one tree drag as a batch of metadata and folder writes.
 *
 * A reorder renumbers a whole sibling list, so it is many small PUTs, not one
 * call. They run in series and the cache is invalidated once at the end rather
 * than per write: a partial refetch mid-batch would render the tree in a state
 * that never existed on the server, ordering half-applied.
 */
export function useApplyNoteReorder() {
  const client = useQueryClient()
  return useMutation<void, ApiError, ReorderPlan>({
    mutationFn: async ({ folderUpdates, noteUpdates }) => {
      for (const { id, ...body } of folderUpdates) {
        await apiSend(`/note-folders/${id}`, { ...json(body), method: "PUT" })
      }
      for (const { id, ...body } of noteUpdates) {
        await apiSend(`/notes/${id}/metadata`, { ...json(body), method: "PUT" })
      }
    },
    onSettled: () => client.invalidateQueries({ queryKey: notesKey }),
    // The sidebar's drop handler already reports this one.
    meta: { silentError: true },
  })
}
