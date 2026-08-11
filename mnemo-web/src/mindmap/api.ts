/**
 * The mindmap data layer: query keys, the fetchers, and the one mutation every edit goes through.
 *
 * Two things here are unlike the rest of the app's modules. First, an accepted edit patches the open
 * document's cache entry with the delta the server returned rather than invalidating it, for the
 * same reason note autosave does: a refetch per edit on a document built for tens of thousands of
 * elements is the wrong shape of cost, and it goes stale between the write and the refetch landing.
 * Second, a 409 is a value here, not a throw: the request was well formed and the map simply moved
 * on, and the current revision in that body is the whole point of the response.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { apiFetch, apiFetchExpecting, apiSend } from "@/api/client"

import { applyDelta, type MindmapDocumentOrder, type MindmapRestoreDelta } from "./model/delta"
import type {
  MindmapDocument,
  MindmapDocumentSummary,
  MindmapFolder,
  MindmapLibraryEntry,
  StyleTemplate,
} from "./model/document"
import type { MindmapOp } from "./model/ops"

export const mindmapKey = ["mindmap"] as const
export const mindmapLibraryKey = [...mindmapKey, "library"] as const
export const mindmapFoldersKey = [...mindmapKey, "folders"] as const
export const mindmapListKey = [...mindmapKey, "list"] as const
export const mindmapTemplatesKey = [...mindmapKey, "templates"] as const

/**
 * One open document, keyed outside the library key on purpose: filing a map into a folder changes
 * the library and must not refetch the graph of every map in it.
 */
export const mapKey = (id: string) => [...mindmapKey, "map", id] as const

/* -------------------------------------------------------------------------- */
/* Wire shapes                                                                */
/* -------------------------------------------------------------------------- */

/** Mirrors Mnemo.Host/Contracts/MindmapDto.cs. */
export interface MindmapOpsResult {
  revision: number
  createdIds: Record<string, string>
  deletedCount: number
  /** Null when a concurrent commit interleaved, in which case the client refetches instead. */
  undo: MindmapRestoreDelta | null
  redo: MindmapRestoreDelta | null
  order: MindmapDocumentOrder | null
}

export interface MindmapRestoreResult {
  revision: number
  order: MindmapDocumentOrder
}

export interface MindmapEditError {
  code: "rev_conflict" | "not_found" | "would_cycle" | "bad_content_type" | "validation_error"
  message: string
  revision: number
  failedOpIndex: number | null
  contendedIds: string[] | null
  suggestions: string[] | null
}

/** What an edit came back as. `conflict` is the only one the caller recovers from by refetching. */
export type EditOutcome =
  | { status: "applied"; result: MindmapOpsResult }
  | { status: "conflict"; error: MindmapEditError }
  | { status: "rejected"; error: MindmapEditError }

/* -------------------------------------------------------------------------- */
/* Fetchers                                                                   */
/* -------------------------------------------------------------------------- */

export function fetchMindmap(id: string): Promise<MindmapDocument> {
  return apiFetch<MindmapDocument>(`/mindmaps/${encodeURIComponent(id)}`)
}

export function fetchMindmapLibrary(): Promise<MindmapLibraryEntry[]> {
  return apiFetch<MindmapLibraryEntry[]>("/mindmaps/library")
}

export function fetchMindmapFolders(): Promise<MindmapFolder[]> {
  return apiFetch<MindmapFolder[]>("/mindmaps/folders")
}

export function fetchMindmapList(): Promise<MindmapDocumentSummary[]> {
  return apiFetch<MindmapDocumentSummary[]>("/mindmaps")
}

/** The cascade's inputs: six shipped templates plus the user's, and which one an unclaimed map uses. */
export interface MindmapTemplates {
  defaultId: string
  templates: StyleTemplate[]
}

export function fetchMindmapTemplates(): Promise<MindmapTemplates> {
  return apiFetch<MindmapTemplates>("/mindmaps/templates")
}

/**
 * Applies one batch. Never throws for an outcome the protocol has an answer for; a transport failure
 * still throws, because that is not an outcome, it is a failure.
 */
export async function applyMindmapOps(
  id: string,
  expectedRevision: number,
  ops: MindmapOp[],
): Promise<EditOutcome> {
  const { status, data } = await apiFetchExpecting<MindmapOpsResult | MindmapEditError>(
    `/mindmaps/${encodeURIComponent(id)}/ops`,
    [400, 404, 409],
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, ops }),
    },
  )

  if (status === 200) {
    return { status: "applied", result: data as MindmapOpsResult }
  }
  return {
    status: status === 409 ? "conflict" : "rejected",
    error: data as MindmapEditError,
  }
}

/**
 * Asks the server to lay the map out.
 *
 * It answers in the shape one edit batch does, because that is what it is: the moves are computed on
 * the server and committed through the same op path, so an arrange folds into the cache like any other
 * write and takes exactly one Ctrl+Z to take back.
 *
 * The sizes travel with the request because a node's size is the width of its rendered text, and the
 * client that rendered it is the only thing that knows. Without them the layout spaces the map by a
 * guess about a font it has never seen.
 */
export async function arrangeMindmap(
  id: string,
  expectedRevision: number,
  sizes: Record<string, [number, number]>,
  algorithm?: string,
): Promise<EditOutcome> {
  const { status, data } = await apiFetchExpecting<MindmapOpsResult | MindmapEditError>(
    `/mindmaps/${encodeURIComponent(id)}/arrange`,
    [400, 404, 409],
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, algorithm, sizes }),
    },
  )

  if (status === 200) {
    return { status: "applied", result: data as MindmapOpsResult }
  }
  return {
    status: status === 409 ? "conflict" : "rejected",
    error: data as MindmapEditError,
  }
}

export async function restoreMindmap(
  id: string,
  expectedRevision: number,
  delta: MindmapRestoreDelta,
): Promise<{ status: "applied"; result: MindmapRestoreResult } | { status: "conflict"; error: MindmapEditError }> {
  const { status, data } = await apiFetchExpecting<MindmapRestoreResult | MindmapEditError>(
    `/mindmaps/${encodeURIComponent(id)}/restore`,
    [409],
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision, delta }),
    },
  )

  return status === 200
    ? { status: "applied", result: data as MindmapRestoreResult }
    : { status: "conflict", error: data as MindmapEditError }
}

export function createMindmap(body: {
  title?: string
  layoutAlgorithm?: string
  templateId?: string
  folderId?: string | null
}): Promise<MindmapDocument> {
  return apiFetch<MindmapDocument>("/mindmaps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

export function renameMindmap(id: string, title: string): Promise<MindmapDocument> {
  return apiFetch<MindmapDocument>(`/mindmaps/${encodeURIComponent(id)}/title`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
}

export function duplicateMindmap(id: string, title?: string): Promise<MindmapDocument> {
  return apiFetch<MindmapDocument>(`/mindmaps/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
}

export function deleteMindmap(id: string): Promise<void> {
  return apiSend(`/mindmaps/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export function moveMindmapToFolder(id: string, folderId: string | null): Promise<void> {
  return apiSend(`/mindmaps/${encodeURIComponent(id)}/folder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId }),
  })
}

export function saveMindmapFolder(folder: MindmapFolder): Promise<void> {
  return apiSend(`/mindmaps/folders/${encodeURIComponent(folder.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(folder),
  })
}

export function deleteMindmapFolder(id: string): Promise<void> {
  return apiSend(`/mindmaps/folders/${encodeURIComponent(id)}`, { method: "DELETE" })
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Folds an accepted edit into the cached document.
 *
 * Returns false when it could not, which happens only when the server withheld the delta because
 * another session's commit interleaved. The caller's answer to that is a refetch, and it must be a
 * refetch: folding a delta that does not describe the document you hold produces a map that renders
 * fine and is quietly wrong.
 */
export function foldEditIntoCache(client: QueryClient, id: string, result: MindmapOpsResult): boolean {
  if (!result.redo || !result.order) {
    return false
  }

  const current = client.getQueryData<MindmapDocument>(mapKey(id))
  if (!current) {
    return false
  }

  client.setQueryData<MindmapDocument>(mapKey(id), applyDelta(current, result.redo, result.revision, result.order))
  return true
}

export function foldRestoreIntoCache(
  client: QueryClient,
  id: string,
  delta: MindmapRestoreDelta,
  result: MindmapRestoreResult,
): boolean {
  const current = client.getQueryData<MindmapDocument>(mapKey(id))
  if (!current) {
    return false
  }

  client.setQueryData<MindmapDocument>(mapKey(id), applyDelta(current, delta, result.revision, result.order))
  return true
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                      */
/* -------------------------------------------------------------------------- */

export function useMindmapLibrary() {
  return useQuery({ queryKey: mindmapLibraryKey, queryFn: fetchMindmapLibrary })
}

export function useMindmapFolders() {
  return useQuery({ queryKey: mindmapFoldersKey, queryFn: fetchMindmapFolders })
}

/**
 * Templates change when the user saves one and at no other time, so they are fetched once and kept.
 * Every open map's cascade reads them, and refetching per map would be one request per open for data
 * that is the same every time.
 *
 * Barely retried on purpose. A map is styled by these but not made of them, so the caller draws with
 * theme defaults rather than waiting; every retry is time the map is not on screen for a request that
 * has already failed once, and a 4xx means the endpoint is not there and will not become there.
 */
export function useMindmapTemplates() {
  return useQuery({
    queryKey: mindmapTemplatesKey,
    queryFn: fetchMindmapTemplates,
    staleTime: Infinity,
    retry: (count, error) => count < 1 && !isClientError(error),
  })
}

function isClientError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  )
}

export function useMindmap(id: string | null) {
  return useQuery({
    queryKey: mapKey(id ?? ""),
    queryFn: () => fetchMindmap(id!),
    enabled: id != null,
    // A map that is not there will not appear by asking again.
    retry: (_count, error) => !(error instanceof Error && "status" in error && error.status === 404),
  })
}

export function useCreateMindmap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: createMindmap,
    onSuccess: (document) => {
      client.setQueryData(mapKey(document.id), document)
      void client.invalidateQueries({ queryKey: mindmapKey })
    },
  })
}

export function useRenameMindmap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameMindmap(id, title),
    onSuccess: (document) => {
      // Both keys: the library lists the title, and the open document carries the revision the
      // rename just bumped. Patching one and not the other is how the header and the gallery
      // disagree about what the map is called.
      client.setQueryData(mapKey(document.id), document)
      void client.invalidateQueries({ queryKey: mindmapLibraryKey })
      void client.invalidateQueries({ queryKey: mindmapListKey })
    },
  })
}

export function useDuplicateMindmap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title?: string }) => duplicateMindmap(id, title),
    onSuccess: () => void client.invalidateQueries({ queryKey: mindmapKey }),
  })
}

export function useDeleteMindmap() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: deleteMindmap,
    onSuccess: (_void, id) => {
      client.removeQueries({ queryKey: mapKey(id) })
      void client.invalidateQueries({ queryKey: mindmapKey })
    },
  })
}

export function useMoveMindmapToFolder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ id, folderId }: { id: string; folderId: string | null }) => moveMindmapToFolder(id, folderId),
    // Filing changes where a map sits, not what is in it, so the open document is left alone.
    onSuccess: () => void client.invalidateQueries({ queryKey: mindmapLibraryKey }),
  })
}

export function useSaveMindmapFolder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: saveMindmapFolder,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: mindmapFoldersKey })
      void client.invalidateQueries({ queryKey: mindmapLibraryKey })
    },
  })
}

export function useDeleteMindmapFolder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: deleteMindmapFolder,
    // Deleting a folder orphans its maps to the root, so the library moves too.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: mindmapFoldersKey })
      void client.invalidateQueries({ queryKey: mindmapLibraryKey })
    },
  })
}
