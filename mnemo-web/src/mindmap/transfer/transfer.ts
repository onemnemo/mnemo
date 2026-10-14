import type { MindmapTransferUploadDto, TransferFormatDto } from "@/api/types"
import type { QueuedImport } from "@/components/transfer/import-queue"

// Pure rules behind the mindmap transfer dialog: what a file is allowed to be, and how the import
// queue reads. Kept clear of React so the parts that are easy to get subtly wrong, the queue's
// counts and the "can we commit yet" test, can be reasoned about on their own.

export interface QueuedFile extends QueuedImport {
  formatName?: string
  /** Maps the file will yield, or null if a preview could not read it. */
  mapCount?: number | null
}

export function queuedFromUpload(key: string, upload: MindmapTransferUploadDto): QueuedFile {
  return {
    key,
    name: upload.fileName,
    sizeBytes: upload.sizeBytes,
    status: upload.canImport ? "ready" : "rejected",
    uploadId: upload.uploadId,
    formatId: upload.formatId,
    formatName: upload.formatName,
    mapCount: upload.mapCount,
    notes: upload.warnings.length > 0 ? upload.warnings : undefined,
    evidence: upload.evidence ?? undefined,
  }
}

/**
 * Formats an export can be written in. Unfiltered by selection size, unlike notes, because the only
 * mindmap format is the `.mnemo` package and it carries one map as happily as a hundred, along with
 * the folders they were filed in and the style templates they reference.
 */
export function exportFormats(formats: readonly TransferFormatDto[]): TransferFormatDto[] {
  return formats.filter((format) => format.supportsExport)
}

/**
 * Maps the queue will import, or null unless EVERY file in it can say. One file that cannot makes the
 * whole total unknowable, and a partial sum is worse than no figure.
 */
export function readyMapCount(queue: readonly QueuedFile[]): number | null {
  const ready = queue.filter((file) => file.status === "ready")
  if (ready.length === 0 || ready.some((file) => typeof file.mapCount !== "number")) {
    return null
  }
  return ready.reduce((sum, file) => sum + (file.mapCount ?? 0), 0)
}
