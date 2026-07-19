import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import type {
  CreateNoteDto,
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

/** Every note without its body, newest-modified first. */
export function useNotesQuery() {
  return useQuery<NoteSummaryDto[], ApiError>({
    queryKey: noteListKey,
    queryFn: () => apiFetch<NoteSummaryDto[]>("/notes"),
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
 * Retitles, files, reorders or favourites a note. A full replace of its metadata,
 * so send the whole summary back, not just the field that changed. Note content is
 * not writable here and is never touched by this call.
 */
export function useUpdateNoteMetadata() {
  return useNotesMutation(({ id, ...body }: UpdateNoteMetadataDto & { id: string }) =>
    apiSend(`/notes/${id}/metadata`, { ...json(body), method: "PUT" }),
  )
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
