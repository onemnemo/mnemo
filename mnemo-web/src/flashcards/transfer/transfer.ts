import type { TransferFormatDto, TransferUploadDto } from "@/api/types"
import type { QueuedImport } from "@/components/transfer/import-queue"

// Pure rules behind the transfer dialog: what a file is allowed to be, which formats an export
// can offer, and how the queue reads. Kept clear of React so the parts that are easy to get
// subtly wrong - the queue's counts, the format filter - can be reasoned about on their own.

/** The `.mnemo` format id, the only one that can carry more than one deck's worth of structure. */
const PACKAGE_FORMAT = "flashcards.mnemo"

export interface QueuedFile extends QueuedImport {
  formatName?: string
  /** Null for a format that only knows its card count once it has been imported. */
  cardCount?: number | null
}

export function queuedFromUpload(key: string, upload: TransferUploadDto): QueuedFile {
  return {
    key,
    name: upload.fileName,
    sizeBytes: upload.sizeBytes,
    status: upload.canImport ? "ready" : "rejected",
    uploadId: upload.uploadId,
    formatId: upload.formatId,
    formatName: upload.formatName,
    cardCount: upload.cardCount,
    notes: upload.warnings.length > 0 ? upload.warnings : undefined,
    evidence: upload.evidence ?? undefined,
  }
}

/** What an export of this scope produces: a backup of the collection, or a package of its parts. */
export function exportKind(wholeCollection: boolean | undefined): string {
  return wholeCollection === true ? "backup" : "export"
}

/** Which caption the package format's tile carries, which depends on what it would contain. */
export function packageCaptionKey(wholeCollection: boolean | undefined): string {
  return wholeCollection === true ? "TransferFormatCaptionBackup" : "TransferFormatCaptionSelection"
}

/**
 * Export formats for a selection of a given size. A selection of one deck can go out as any of
 * them; anything wider is offered only as a Mnemo package, which is the desktop's rule. CSV and
 * Anki both can hold several decks, so this is caution rather than a limit of the formats. A folder
 * goes out only as a package, the one format that keeps its subfolders.
 */
export function exportFormats(
  formats: readonly TransferFormatDto[],
  deckCount: number,
  hasFolders = false,
): TransferFormatDto[] {
  const exportable = formats.filter((format) => format.supportsExport)
  return deckCount === 1 && !hasFolders
    ? exportable
    : exportable.filter((format) => format.formatId === PACKAGE_FORMAT)
}

/**
 * Cards the queue will import, or null unless EVERY file in it can say. One file that cannot
 * makes the whole total unknowable, and a partial sum is worse than no figure: a package beside an
 * Anki file would put "42 cards" on the button and then import 942. The per-row lines stay silent
 * about the files that cannot say, so the total is the only place this could go wrong.
 */
export function readyCardCount(queue: readonly QueuedFile[]): number | null {
  const ready = queue.filter((file) => file.status === "ready")
  if (ready.length === 0 || ready.some((file) => typeof file.cardCount !== "number")) return null
  return ready.reduce((sum, file) => sum + (file.cardCount ?? 0), 0)
}
