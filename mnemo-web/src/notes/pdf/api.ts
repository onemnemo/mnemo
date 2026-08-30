import { ApiError, apiToken } from "@/api/client"
import {
  exportRequest,
  saveServerExport,
  type ChosenTarget,
  type ExportOutcome,
  type ExportRequest,
} from "@/api/export-file"

import { toRequestBody, type PdfDocumentText, type PdfOptions } from "./options"

async function preview(
  noteId: string,
  options: PdfOptions,
  text: PdfDocumentText,
  signal?: AbortSignal,
): Promise<Response> {
  const headers = new Headers({ "Content-Type": "application/json", Accept: "application/pdf" })
  const token = apiToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)

  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}/pdf/preview`, {
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
  const response = await preview(noteId, options, text, signal)
  return response.arrayBuffer()
}

/**
 * Renders the note and saves it wherever the user says, answering with the path it wrote so the
 * toast can name the file and offer to show it.
 *
 * Two routes behind one call, because the render happens on the server and the destination is
 * settled before it starts: `save` writes the PDF straight there, and `export` is only for a
 * browser tab with no window to choose with, which has to take the bytes itself.
 *
 * @param settled A destination the footer's Browse already chose, so Save does not ask twice.
 */
export function saveNotePdf(
  noteId: string,
  options: PdfOptions,
  text: PdfDocumentText,
  save: ExportRequest,
  settled?: ChosenTarget | null,
): Promise<ExportOutcome> {
  const body = toRequestBody(options, text)
  return saveServerExport(
    save,
    (grant) =>
      exportRequest(`/notes/${encodeURIComponent(noteId)}/pdf/${grant === null ? "export" : "save"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(grant === null ? body : { options: body, grant }),
      }),
    settled,
  )
}
