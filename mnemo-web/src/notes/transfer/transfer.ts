import type { NoteFolderDto, NoteSummaryDto, NoteTransferUploadDto, TransferFormatDto } from "@/api/types"
import type { QueuedImport } from "@/components/transfer/import-queue"

// Pure rules behind the note transfer dialog: what a file is allowed to be, which formats an export
// can offer, and how the queue reads. Kept clear of React so the parts that are easy to get subtly
// wrong, the queue's counts and the format filter, can be reasoned about on their own.

/** The `.mnemo` format id, the only one that can carry more than one note plus its folders. */
export const PACKAGE_FORMAT = "notes.mnemo"

/** The markdown format id, which exports one note at a time. */
export const MARKDOWN_FORMAT = "notes.markdown"

export interface QueuedFile extends QueuedImport {
  formatName?: string
  /** Notes the file will yield, or null if a preview could not read it. */
  noteCount?: number | null
}

export function queuedFromUpload(key: string, upload: NoteTransferUploadDto): QueuedFile {
  return {
    key,
    name: upload.fileName,
    sizeBytes: upload.sizeBytes,
    status: upload.canImport ? "ready" : "rejected",
    uploadId: upload.uploadId,
    formatId: upload.formatId,
    formatName: upload.formatName,
    noteCount: upload.noteCount,
    notes: upload.warnings.length > 0 ? upload.warnings : undefined,
    evidence: upload.evidence ?? undefined,
  }
}

/**
 * Export formats for a selection of a given size. A single note can go out as any of them; a wider
 * selection, or any folder even with one note in it, is offered only as a package, because markdown
 * is one note with no id and has no way to carry a folder.
 */
export function exportFormats(
  formats: readonly TransferFormatDto[],
  noteCount: number,
  hasFolders = false,
): TransferFormatDto[] {
  const exportable = formats.filter((format) => format.supportsExport)
  return noteCount === 1 && !hasFolders
    ? exportable
    : exportable.filter((format) => format.formatId === PACKAGE_FORMAT)
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

function markdownTitle(fileName: string): string {
  const dot = fileName.lastIndexOf(".")
  const stem = dot >= 0 ? fileName.slice(0, dot) : fileName
  return stem.trim() ? stem : "Imported Note"
}

/**
 * Markdown files whose title is taken where they land, earlier files included.
 * The host compares ignoring case, so both sides are upper-cased.
 */
export function markdownCollisions(
  queue: readonly QueuedFile[],
  notes: readonly NoteSummaryDto[],
  folders: readonly NoteFolderDto[],
  targetFolderId: string | null,
): Set<string> {
  const titlesByFolder = new Map<string, Set<string>>()
  const colliding = new Set<string>()
  for (const file of queue) {
    if (file.status !== "ready" || file.formatId !== MARKDOWN_FORMAT) continue
    const names = (file.path ?? "").split("/").map((name) => name.trim().toUpperCase()).filter(Boolean)
    let folderId: string | null | undefined = targetFolderId
    for (const name of names) {
      folderId = folders.find((folder) => folder.parentId === folderId && folder.name.toUpperCase() === name)?.id
      if (folderId === undefined) break
    }
    const key = folderId === undefined ? `new:${names.join("/")}` : `id:${folderId ?? ""}`
    let taken = titlesByFolder.get(key)
    if (!taken) {
      const here = folderId === undefined ? [] : notes.filter((note) => !note.parentNoteId && note.folderId === folderId)
      taken = new Set(here.map((note) => note.title.toUpperCase()))
      titlesByFolder.set(key, taken)
    }
    const title = markdownTitle(file.name).toUpperCase()
    if (taken.has(title)) colliding.add(file.key)
    else taken.add(title)
  }
  return colliding
}
