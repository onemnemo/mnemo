import { useQuery } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import { downloadFromApi } from "@/api/download"
import type {
  TransferExportDto,
  TransferFormatDto,
  TransferImportDto,
  TransferImportResultDto,
  TransferUploadDto,
} from "@/api/types"

const formatsKey = ["flashcards", "transfer", "formats"] as const

/**
 * The formats this build can read and write. Fixed for the life of the process - they come from
 * the adapters registered at startup - so it is fetched once and never refetched.
 */
export function useTransferFormatsQuery(enabled: boolean) {
  return useQuery<TransferFormatDto[], ApiError>({
    queryKey: formatsKey,
    queryFn: () => apiFetch<TransferFormatDto[]>("/flashcards/transfer/formats"),
    enabled,
    staleTime: Infinity,
  })
}

/** Stages a file server-side and reports what reading it turned up. */
export function uploadTransferFile(file: File, signal?: AbortSignal): Promise<TransferUploadDto> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  return apiFetch<TransferUploadDto>("/flashcards/transfer/uploads", { method: "POST", body: form, signal })
}

/**
 * Gives back a staged file the user removed or abandoned. Failures are swallowed: this is
 * housekeeping the server also does on a timer, and it is never the reason to interrupt someone.
 */
export function discardUpload(uploadId: string): Promise<void> {
  return apiSend(`/flashcards/transfer/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(
    () => {},
  )
}

export function runImport(body: TransferImportDto): Promise<TransferImportResultDto> {
  return apiFetch<TransferImportResultDto>("/flashcards/transfer/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Exports the selected decks and saves the file the server streams back. */
export function runExport(body: TransferExportDto): Promise<void> {
  return downloadFromApi("/flashcards/transfer/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
