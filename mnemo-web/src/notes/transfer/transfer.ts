import type { NoteTransferUploadDto, TransferFormatDto } from "@/api/types"

// Pure rules behind the note transfer dialog: what a file is allowed to be, which formats an export
// can offer, and how the queue reads. Kept clear of React so the parts that are easy to get subtly
// wrong, the queue's counts and the format filter, can be reasoned about on their own.

/** Files one import batch may hold, matching the server's own cap. */
export const MAX_FILES = 5

/** The `.mnemo` format id, the only one that can carry more than one note plus its folders. */
export const PACKAGE_FORMAT = "notes.mnemo"

/** The markdown format id, which exports one note at a time. */
export const MARKDOWN_FORMAT = "notes.markdown"

export type QueueStatus = "uploading" | "ready" | "rejected"

/**
 * One row of the import queue. A file that failed keeps its row with the reason attached rather
 * than vanishing, since being told which file was unreadable, next to the file, is the difference
 * between an explanation and a shrug.
 */
export interface QueuedFile {
  key: string
  name: string
  sizeBytes: number
  status: QueueStatus
  /** The server's handle for the staged bytes; absent until the upload lands. */
  uploadId?: string
  formatName?: string
  /** Notes the file will yield, or null if a preview could not read it. */
  noteCount?: number | null
  /** Why the file was rejected, or what the server warned about after reading it. */
  notes?: string[]
}

export function queuedFromUpload(key: string, upload: NoteTransferUploadDto): QueuedFile {
  return {
    key,
    name: upload.fileName,
    sizeBytes: upload.sizeBytes,
    status: upload.canImport ? "ready" : "rejected",
    uploadId: upload.uploadId,
    formatName: upload.formatName,
    noteCount: upload.noteCount,
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
 * Export formats for a selection of a given size. A single note can go out as any of them; a wider
 * selection is offered only as a package, because markdown is one note with no id and has no way to
 * carry a folder of them.
 */
export function exportFormats(
  formats: readonly TransferFormatDto[],
  noteCount: number,
): TransferFormatDto[] {
  const exportable = formats.filter((format) => format.supportsExport)
  return noteCount === 1 ? exportable : exportable.filter((format) => format.formatId === PACKAGE_FORMAT)
}

/** Uploads to send when the user confirms: the ones that read cleanly, in queue order. */
export function readyUploadIds(queue: readonly QueuedFile[]): string[] {
  return queue.flatMap((file) => (file.status === "ready" && file.uploadId ? [file.uploadId] : []))
}

/**
 * Notes the queue will import, or null unless EVERY file in it can say. One file that cannot makes
 * the whole total unknowable, and a partial sum is worse than no figure.
 */
export function readyNoteCount(queue: readonly QueuedFile[]): number | null {
  const ready = queue.filter((file) => file.status === "ready")
  if (ready.length === 0 || ready.some((file) => typeof file.noteCount !== "number")) return null
  return ready.reduce((sum, file) => sum + (file.noteCount ?? 0), 0)
}

/** Whether the dialog can commit: something to import, and nothing still being read. */
export function canImport(queue: readonly QueuedFile[]): boolean {
  return queue.some((file) => file.status === "ready") && !queue.some((file) => file.status === "uploading")
}

/**
 * A file size for the row's detail line. Kilobytes, stepping up at a megabyte because a package with
 * images is routinely large enough to make "204800 KB" unreadable.
 */
export function formatFileSize(sizeBytes: number): string {
  const kb = Math.max(1, Math.round(sizeBytes / 1024))
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`
}
