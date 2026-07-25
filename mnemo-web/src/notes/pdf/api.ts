import { ApiError, apiToken } from "@/api/client"
import { downloadFromApi } from "@/api/download"

import { toRequestBody, type PdfOptions } from "./options"

/**
 * Fetches a preview PDF for the note under the current options. Returns the raw bytes for pdf.js to
 * render in the browser; a bearer blob rather than a plain URL because the route lives behind the
 * token. The caller's signal cancels a preview it has already superseded, which the server honors by
 * killing the in-flight Typst compile.
 */
export async function fetchNotePdfPreview(
  noteId: string,
  options: PdfOptions,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/pdf" })
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/pdf/preview`, {
    method: "POST",
    headers,
    body: JSON.stringify(toRequestBody(options)),
    signal,
  })

  if (!response.ok) {
    // Success is a PDF but failures answer as JSON, so an error body still carries a message.
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null
    throw new ApiError(
      body?.message ?? body?.error ?? response.statusText ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error,
    )
  }

  return response.arrayBuffer()
}

/** Exports the note to PDF and saves the file the server streams back under the note's title. */
export function exportNotePdf(noteId: string, options: PdfOptions): Promise<void> {
  return downloadFromApi(`/notes/${encodeURIComponent(noteId)}/pdf/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toRequestBody(options)),
  })
}
