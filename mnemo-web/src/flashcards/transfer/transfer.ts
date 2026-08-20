import type {
  ConflictPolicy,
  PackageEvidenceDto,
  PayloadEvidenceDto,
  TransferFormatDto,
  TransferImportResultDto,
  TransferUploadDto,
  TransferWarningDto,
} from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

// Pure rules behind the transfer dialog: what a file is allowed to be, which formats an export
// can offer, and how the queue reads. Kept clear of React so the parts that are easy to get
// subtly wrong - the queue's counts, the format filter - can be reasoned about on their own.

/** Files one import batch may hold, matching the desktop dialog and the server's own cap. */
export const MAX_FILES = 5

/** The `.mnemo` format id, the only one that can carry more than one deck's worth of structure. */
const PACKAGE_FORMAT = "flashcards.mnemo"

export type QueueStatus = "uploading" | "ready" | "rejected"

/**
 * One row of the import queue. A file that failed keeps its row with the reason attached rather
 * than vanishing the way the desktop's does - being told which file was unreadable, next to the
 * file, is the difference between an explanation and a shrug.
 */
export interface QueuedFile {
  key: string
  name: string
  sizeBytes: number
  status: QueueStatus
  /** The server's handle for the staged bytes; absent until the upload lands. */
  uploadId?: string
  /** Which adapter read the file, so the dialog can tell what that format actually honours. */
  formatId?: string
  formatName?: string
  /** Null for a format that only knows its card count once it has been imported. */
  cardCount?: number | null
  /** Why the file was rejected, or what the server warned about after reading it. */
  notes?: FileNote[]
  /** What importing this file would mean. Only a package can say; every other format leaves it out. */
  evidence?: PackageEvidenceDto
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

/** The flashcards part of a package's evidence, or null when the package carries none. */
export function flashcardEvidence(evidence: PackageEvidenceDto): PayloadEvidenceDto | null {
  return evidence.payloads.find((payload) => payload.payloadType === "flashcards") ?? null
}

/** What kind of file the package says it is, and where it came from, as one line. */
export function evidenceHeadline(t: TranslateFn, evidence: PackageEvidenceDto): string {
  const backup = evidence.kind === "backup"
  const here = evidence.fromThisCollection
  if (backup) return t("Common", here ? "TransferEvidenceBackupHere" : "TransferEvidenceBackupElsewhere")
  return t("Common", here ? "TransferEvidenceExportHere" : "TransferEvidenceExportElsewhere")
}

/**
 * What the file holds against what is already here, one statement per line: how much of it this
 * collection already has, what this collection has that the file does not, and what replacing
 * would destroy. A line only appears when it has something to say, so a package that adds nothing
 * but new decks does not read as a warning.
 */
export function evidenceLines(t: TranslateFn, evidence: PackageEvidenceDto): string[] {
  const payload = flashcardEvidence(evidence)
  if (!payload) return []
  if (!payload.canRead) return [t("Common", "TransferEvidenceTooNew")]

  const lines = [t("Common", "TransferEvidenceDecksFormat", { 0: payload.inPackage })]
  if (payload.alreadyHere > 0) {
    lines.push(
      t("Common", "TransferEvidenceAlreadyHereFormat", { 0: payload.alreadyHere, 1: payload.newHere }),
    )
  }
  if (payload.missingFromPackage > 0) {
    lines.push(t("Common", "TransferEvidenceMissingFormat", { 0: payload.missingFromPackage }))
  }
  if (payload.replaceWouldDiscard > 0) {
    lines.push(t("Common", "TransferEvidenceReplaceDiscardsFormat", { 0: payload.replaceWouldDiscard }))
  }
  return lines
}

/**
 * Whether replacing would destroy something, so the dialog has to ask outright before it runs.
 * Measured on decks the file also carries rather than on the card count it would discard: a
 * replace that happens to match card for card still takes what is here and puts the file in its
 * place, and that is the thing being consented to.
 */
export function replaceNeedsConfirmation(
  queue: readonly QueuedFile[],
  policy: ConflictPolicy,
): boolean {
  if (policy !== "Replace") return false
  return queue.some((file) => {
    if (file.status !== "ready" || !file.evidence) return false
    const payload = flashcardEvidence(file.evidence)
    return payload !== null && payload.canRead && payload.alreadyHere > 0
  })
}

/** What an export of this scope produces: a backup of the collection, or a package of its parts. */
export function exportKind(wholeCollection: boolean | undefined): string {
  return wholeCollection === true ? "backup" : "export"
}

/** Which caption the package format's tile carries, which depends on what it would contain. */
export function packageCaptionKey(wholeCollection: boolean | undefined): string {
  return wholeCollection === true ? "TransferFormatCaptionBackup" : "TransferFormatCaptionSelection"
}

/** How a finished import reads: which toast, and every line it has to say. */
export interface ImportNotice {
  tone: "success" | "warning"
  titleKey: "ImportCompleteTitle" | "ImportFailedTitle"
  description: string
}

/**
 * What to tell the user about a finished import. Warnings are part of the answer rather than
 * something only the errors get to say: an import that lands but refuses a payload it could not
 * read has succeeded and has something the reader needs to know, so it reports as a warning with
 * the reason attached instead of a silent success.
 */
export function importResultNotice(
  t: TranslateFn,
  result: TransferImportResultDto,
  importedPhrase: string,
): ImportNotice {
  const warnings = result.warnings.map((warning) => fileNoteText(t, warning))
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join("\n")

  if (result.succeededFiles === 0) {
    return {
      tone: "warning",
      titleKey: "ImportFailedTitle",
      description: join(result.errors.join("\n"), ...warnings),
    }
  }

  if (result.failedFiles > 0) {
    return {
      tone: "warning",
      titleKey: "ImportCompleteTitle",
      description: join(
        t("Common", "TransferImportPartialFormat", { 0: importedPhrase, 1: result.errors.join("\n") }),
        ...warnings,
      ),
    }
  }

  return {
    tone: warnings.length > 0 ? "warning" : "success",
    titleKey: "ImportCompleteTitle",
    description: join(t("Common", "TransferImportFinishedFormat", { 0: importedPhrase }), ...warnings),
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
 * Export formats for a selection of a given size. A selection of one deck can go out as any of
 * them; anything wider is offered only as a Mnemo package, which is the desktop's rule. CSV and
 * Anki both can hold several decks, so this is caution rather than a limit of the formats.
 */
export function exportFormats(
  formats: readonly TransferFormatDto[],
  deckCount: number,
): TransferFormatDto[] {
  const exportable = formats.filter((format) => format.supportsExport)
  return deckCount === 1 ? exportable : exportable.filter((format) => format.formatId === PACKAGE_FORMAT)
}

/** Uploads to send when the user confirms: the ones that read cleanly, in queue order. */
export function readyUploadIds(queue: readonly QueuedFile[]): string[] {
  return queue.flatMap((file) => (file.status === "ready" && file.uploadId ? [file.uploadId] : []))
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

/**
 * Whether asking about collisions means anything for what is queued. CSV rows and Anki notes carry
 * no id the import can match against, so every import of one is new content whatever was picked.
 * Putting the question on screen anyway promises a behaviour that never runs, so it is asked only
 * when at least one queued file is in a format that reads the answer. An empty queue keeps it:
 * there is nothing yet to contradict.
 */
export function conflictPolicyApplies(
  queue: readonly QueuedFile[],
  formats: readonly TransferFormatDto[],
): boolean {
  const ready = queue.filter((file) => file.status === "ready")
  if (ready.length === 0) return true

  const byId = new Map(formats.map((format) => [format.formatId, format]))
  // An unrecognised format is left alone: guessing "it does not apply" would hide a real choice.
  return ready.some((file) => {
    if (file.formatId === undefined) return true
    const format = byId.get(file.formatId)
    return format === undefined || format.supportsConflictPolicy !== false
  })
}

/** Whether the dialog can commit: something to import, and nothing still being read. */
export function canImport(queue: readonly QueuedFile[]): boolean {
  return queue.some((file) => file.status === "ready") && !queue.some((file) => file.status === "uploading")
}

/**
 * A file size for the row's detail line. Kilobytes like the desktop, stepping up at a megabyte
 * because an Anki package with media is routinely large enough to make "204800 KB" unreadable.
 */
export function formatFileSize(sizeBytes: number): string {
  const kb = Math.max(1, Math.round(sizeBytes / 1024))
  return kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`
}
