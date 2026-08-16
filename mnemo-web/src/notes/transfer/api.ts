import { useQuery } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import { downloadFromApi } from "@/api/download"
import type {
  NoteTransferExportDto,
  NoteTransferImportDto,
  NoteTransferImportResultDto,
  NoteTransferUploadDto,
  TransferFormatDto,
} from "@/api/types"

const formatsKey = ["notes", "transfer", "formats"] as const

/**
 * The note formats this build can read and write. Fixed for the life of the process, since they
 * come from the adapters registered at startup, so it is fetched once and never refetched.
 */
export function useNoteTransferFormatsQuery(enabled: boolean) {
  return useQuery<TransferFormatDto[], ApiError>({
    queryKey: formatsKey,
    queryFn: () => apiFetch<TransferFormatDto[]>("/notes/transfer/formats"),
    enabled,
    staleTime: Infinity,
  })
}

/** Stages a file server-side and reports what reading it turned up. */
export function uploadNoteTransferFile(file: File, signal?: AbortSignal): Promise<NoteTransferUploadDto> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  return apiFetch<NoteTransferUploadDto>("/notes/transfer/uploads", { method: "POST", body: form, signal })
}

/**
 * Gives back a staged file the user removed or abandoned. Failures are swallowed: this is
 * housekeeping the server also does on a timer, and it is never the reason to interrupt someone.
 */
export function discardNoteUpload(uploadId: string): Promise<void> {
  return apiSend(`/notes/transfer/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => {})
}

export function runNoteImport(body: NoteTransferImportDto): Promise<NoteTransferImportResultDto> {
  return apiFetch<NoteTransferImportResultDto>("/notes/transfer/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Exports the selected notes and saves the file the server streams back. */
export function runNoteExport(body: NoteTransferExportDto): Promise<void> {
  return downloadFromApi("/notes/transfer/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
