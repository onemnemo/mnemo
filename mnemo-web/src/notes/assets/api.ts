// The notes side of image storage: uploads, reference resolution, and the session handshake
// the host's orphan sweep runs on.
//
// An image block's `path` is a stored reference, not a URL, and real data carries three
// shapes: a managed asset id minted by upload (`{guid}.png`), a desktop-era absolute path
// into the shared images directory, and the oldest `attachment:{guid}:{name}` form that
// resolves by bare guid. This module owns the mapping from each shape to the API route that
// serves its bytes; anything unmappable (an http URL from a pasted page, a data URI) gets
// null and renders as a placeholder rather than a hole the editor trusts.

import { fetchAssetBlobUrl } from "@/api/asset-blob"
import { apiFetch, apiSend } from "@/api/client"
import type { NoteAssetDto, NoteAssetSessionDto } from "@/api/types"

const attachmentPrefix = "attachment:"

/** Uploads an image the moment it is picked or pasted, so the block renders before any save. */
export function uploadNoteAsset(file: File): Promise<NoteAssetDto> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  return apiFetch<NoteAssetDto>("/notes/assets", { method: "POST", body: form })
}

function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/")
}

/** The API request path serving a stored reference's bytes, or null when nothing can. */
export function noteAssetRequestPath(path: string): string | null {
  if (path.length === 0) return null

  if (path.toLowerCase().startsWith(attachmentPrefix)) {
    const rest = path.slice(attachmentPrefix.length)
    const end = rest.indexOf(":")
    const guid = end >= 0 ? rest.slice(0, end) : rest
    return guid.length > 0 ? `/api/notes/assets/${encodeURIComponent(guid)}` : null
  }

  // Desktop-era blocks store where the file actually is; the host serves it read-only from
  // there after checking the path stays inside the profile's images directory.
  if (isAbsolutePath(path)) {
    return `/api/notes/assets/legacy?path=${encodeURIComponent(path)}`
  }

  // A managed id is a bare filename; anything with separators or a scheme is not ours.
  if (path.includes("/") || path.includes("\\") || path.includes(":")) return null
  return `/api/notes/assets/${encodeURIComponent(path)}`
}

/** Fetches a stored reference as an object URL. Rejects for missing files and foreign shapes. */
export function loadNoteAssetUrl(path: string): Promise<string> {
  const requestPath = noteAssetRequestPath(path)
  if (requestPath === null) return Promise.reject(new Error(`Unresolvable image reference '${path}'`))
  return fetchAssetBlobUrl(requestPath)
}

/**
 * Registers an editing session with the host. While any session is open the asset sweep
 * stands down, because this editor's undo history can reference uploads no saved note does.
 */
export function openNoteAssetSession(): Promise<string> {
  return apiFetch<NoteAssetSessionDto>("/notes/asset-sessions", { method: "POST" }).then((dto) => dto.sessionId)
}

/**
 * Closes the session once its undo history is gone, which tells the host cleanup is safe
 * and triggers a sweep.
 */
export function closeNoteAssetSession(sessionId: string): Promise<void> {
  return apiSend(`/notes/asset-sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" })
}
