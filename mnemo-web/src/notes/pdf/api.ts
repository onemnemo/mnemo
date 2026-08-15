import { ApiError, apiToken } from "@/api/client"
import { saveBlob } from "@/api/download"

import { toRequestBody, type PdfDocumentText, type PdfOptions } from "./options"

async function post(
  noteId: string,
  route: "preview" | "export",
  options: PdfOptions,
  text: PdfDocumentText,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/pdf" })
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/pdf/${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(toRequestBody(options, text)),
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

  return response
}

/**
 * Fetches a preview PDF for the note under the current options. Returns the raw bytes for pdf.js to
 * render in the browser; a bearer blob rather than a plain URL because the route lives behind the
 * token. The caller's signal cancels a preview it has already superseded, which the server honors by
 * killing the in-flight Typst compile.
 */
export async function fetchNotePdfPreview(
  noteId: string,
  options: PdfOptions,
  text: PdfDocumentText,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await post(noteId, "preview", options, text, signal)
  return response.arrayBuffer()
}

/**
 * Exports the note and saves it. The name comes from the dialog rather than from the server's
 * Content-Disposition: the field in the footer is the one the user just typed, and a download that
 * ignores it would make the field a decoration.
 */
export async function exportNotePdf(
  noteId: string,
  options: PdfOptions,
  text: PdfDocumentText,
  fileName: string,
): Promise<void> {
  const response = await post(noteId, "export", options, text)
  saveBlob(await response.blob(), fileName)
}
