import type { ConflictPolicy, MindmapTransferUploadDto, TransferFormatDto, TransferWarningDto } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

// Pure rules behind the mindmap transfer dialog: what a file is allowed to be, and how the import
// queue reads. Kept clear of React so the parts that are easy to get subtly wrong, the queue's
// counts and the "can we commit yet" test, can be reasoned about on their own.

/** Files one import batch may hold, matching the server's own cap. */
export const MAX_FILES = 5

export type QueueStatus = "uploading" | "ready" | "rejected"

/**
 * One row of the import queue. A file that failed keeps its row with the reason attached rather than
 * vanishing, since being told which file was unreadable, next to the file, is the difference between
 * an explanation and a shrug.
 */
export interface QueuedFile {
  key: string
  name: string
  sizeBytes: number
  status: QueueStatus
  /** The server's handle for the staged bytes; absent until the upload lands. */
  uploadId?: string
  formatName?: string
  /** Maps the file will yield, or null if a preview could not read it. */
  mapCount?: number | null
  /** Why the file was rejected, or what the server warned about after reading it. */
  notes?: FileNote[]
}

/**
 * A file row's note: either a server warning key to resolve through `useT()`, or text already
 * settled on the client (a network failure has no translation key of its own). Rendered with
 * {@link fileNoteText} rather than displayed as `key` or read directly, so both shapes end up as
 * words the reader's locale actually uses.
 */
export type FileNote = TransferWarningDto | { text: string }

/** Resolves one {@link FileNote} to display text, translating a server warning through `t`. */
export function fileNoteText(t: TranslateFn, note: FileNote): string {
  return "text" in note ? note.text : t("TransferWarnings", note.key, note.params)
}

export function queuedFromUpload(key: string, upload: MindmapTransferUploadDto): QueuedFile {
  return {
    key,
    name: upload.fileName,
    sizeBytes: upload.sizeBytes,
    status: upload.canImport ? "ready" : "rejected",
    uploadId: upload.uploadId,
    formatName: upload.formatName,
    mapCount: upload.mapCount,
    notes: upload.warnings.length > 0 ? upload.warnings : undefined,
  }
}

/** Every extension that can be imported, for the file input's `accept` and the dropzone's chips. */
export function importExtensions(formats: readonly TransferFormatDto[]): string[] {
  return formats.filter((format) => format.supportsImport).flatMap((format) => format.extensions)
}

/** True when the name ends in an extension some import adapter claims. */
export function isImportable(fileName: string, formats: readonly TransferFormatDto[]): boolean {
  const lower = fileName.toLowerCase()
  return importExtensions(formats).some((extension) => lower.endsWith(extension.toLowerCase()))
}

/**
 * Formats an export can be written in. Unfiltered by selection size, unlike notes, because the only
 * mindmap format is the `.mnemo` package and it carries one map as happily as a hundred, along with
 * the folders they were filed in and the style templates they reference.
 */
export function exportFormats(formats: readonly TransferFormatDto[]): TransferFormatDto[] {
  return formats.filter((format) => format.supportsExport)
}

/** Uploads to send when the user confirms: the ones that read cleanly, in queue order. */
export function readyUploadIds(queue: readonly QueuedFile[]): string[] {
  return queue.flatMap((file) => (file.status === "ready" && file.uploadId ? [file.uploadId] : []))
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

/** Whether the dialog can commit: something to import, and nothing still being read. */
export function canImport(queue: readonly QueuedFile[]): boolean {
  return queue.some((file) => file.status === "ready") && !queue.some((file) => file.status === "uploading")
}

/**
 * Requires consent for Replace with any ready file. The preview does not report collisions.
 */
export function replaceNeedsConfirmation(queue: readonly QueuedFile[], policy: ConflictPolicy): boolean {
  if (policy !== "Replace") return false
  return queue.some((file) => file.status === "ready")
}

/**
 * A file size for the row's detail line. Kilobytes, stepping up at a megabyte because a package with
 * images is routinely large enough to make "204800 KB" unreadable.
 */
export function formatFileSize(sizeBytes: number): string {
  const kb = Math.max(1, Math.round(sizeBytes / 1024))
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`
}
