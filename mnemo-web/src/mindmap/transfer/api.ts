import { useQuery } from "@tanstack/react-query"

import { apiFetch, apiSend, ApiError } from "@/api/client"
import { downloadFromApi } from "@/api/download"
import type {
  MindmapTransferExportDto,
  MindmapTransferImportDto,
  MindmapTransferImportResultDto,
  MindmapTransferUploadDto,
  TransferFormatDto,
} from "@/api/types"

const formatsKey = ["mindmap", "transfer", "formats"] as const

/**
 * The mindmap formats this build can read and write. Fixed for the life of the process, since they
 * come from the adapters registered at startup, so it is fetched once and never refetched.
 */
export function useMindmapTransferFormatsQuery(enabled: boolean) {
  return useQuery<TransferFormatDto[], ApiError>({
    queryKey: formatsKey,
    queryFn: () => apiFetch<TransferFormatDto[]>("/mindmaps/transfer/formats"),
    enabled,
    staleTime: Infinity,
  })
}

/** Stages a file server-side and reports what reading it turned up. */
export function uploadMindmapTransferFile(file: File, signal?: AbortSignal): Promise<MindmapTransferUploadDto> {
  const form = new FormData()
  form.append("file", file)
  // No Content-Type header: the browser has to set the multipart boundary itself.
  return apiFetch<MindmapTransferUploadDto>("/mindmaps/transfer/uploads", { method: "POST", body: form, signal })
}

/**
 * Gives back a staged file the user removed or abandoned. Failures are swallowed: this is
 * housekeeping the server also does on a timer, and it is never the reason to interrupt someone.
 */
export function discardMindmapUpload(uploadId: string): Promise<void> {
  return apiSend(`/mindmaps/transfer/uploads/${encodeURIComponent(uploadId)}`, { method: "DELETE" }).catch(() => {})
}

export function runMindmapImport(body: MindmapTransferImportDto): Promise<MindmapTransferImportResultDto> {
  return apiFetch<MindmapTransferImportResultDto>("/mindmaps/transfer/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

/** Exports the selected maps and saves the file the server streams back. */
export function runMindmapExport(body: MindmapTransferExportDto): Promise<void> {
  return downloadFromApi("/mindmaps/transfer/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}
