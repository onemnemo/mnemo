import type { PackageEvidenceDto, TransferFormatDto, TransferWarningDto } from "@/api/types"
import { tPlural } from "@/i18n/plural"
import type { TranslateFn } from "@/i18n/types"
import { transferWarningText } from "@/lib/transfer-warnings"

/** The host's cap on upload ids per import request. */
export const IMPORT_CHUNK = 50

export const MAX_QUEUED = 1000

export type FileNote = TransferWarningDto | { text: string }

export function fileNoteText(t: TranslateFn, note: FileNote): string {
  return "text" in note ? note.text : transferWarningText(t, note)
}

export interface QueuedImport {
  key: string
  name: string
  /** As "Vault/Biology". Absent for a loose file. */
  path?: string
  sizeBytes: number
  status: "uploading" | "ready" | "rejected"
  uploadId?: string
  formatId?: string
  notes?: FileNote[]
  evidence?: PackageEvidenceDto
}

export interface PickedFile {
  file: File
  path: string
}

export function dedupeKey(path: string, name: string, sizeBytes: number): string {
  return `${path}\u001F${name}\u001F${String(sizeBytes)}`
}

export function chunked<T>(items: readonly T[], size = IMPORT_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) chunks.push(items.slice(start, start + size))
  return chunks
}

export function importExtensions(formats: readonly TransferFormatDto[]): string[] {
  return formats.filter((format) => format.supportsImport).flatMap((format) => format.extensions)
}

export function isImportable(fileName: string, formats: readonly TransferFormatDto[]): boolean {
  const lower = fileName.toLowerCase()
  return importExtensions(formats).some((extension) => lower.endsWith(extension.toLowerCase()))
}

export function canImport(queue: readonly QueuedImport[]): boolean {
  return queue.some((file) => file.status === "ready") && !queue.some((file) => file.status === "uploading")
}

function readablePayload(file: QueuedImport, payloadType: string) {
  if (file.status !== "ready") return null
  const payload = file.evidence?.payloads.find((entry) => entry.payloadType === payloadType)
  return payload?.canRead ? payload : null
}

export function packageCollisions(queue: readonly QueuedImport[], payloadType: string): number {
  return queue.reduce((sum, file) => sum + (readablePayload(file, payloadType)?.alreadyHere ?? 0), 0)
}

/** What a replace deletes that the packages do not bring back. */
export function replaceDiscards(queue: readonly QueuedImport[], payloadType: string): number {
  return queue.reduce((sum, file) => sum + (readablePayload(file, payloadType)?.replaceWouldDiscard ?? 0), 0)
}

export function packageCollidingKeys(queue: readonly QueuedImport[], payloadType: string): Set<string> {
  return new Set(queue.filter((file) => (readablePayload(file, payloadType)?.alreadyHere ?? 0) > 0).map((file) => file.key))
}

/** A package from a newer build, which the host refuses to read. */
export function packageTooNew(file: QueuedImport, payloadType: string): boolean {
  return file.evidence?.payloads.some((entry) => entry.payloadType === payloadType && !entry.canRead) === true
}

export function formatFileSize(sizeBytes: number): string {
  const kb = Math.max(1, Math.round(sizeBytes / 1024))
  return kb < 1024 ? `${String(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`
}

/** Naming the counts is the consent to a replace. */
export function replaceLabel(t: TranslateFn, replaced: number, alsoImported: number): string {
  if (alsoImported === 0) {
    return tPlural(t, "Common", { one: "TransferReplaceCountOne", many: "TransferReplaceCountMany" }, replaced)
  }
  return tPlural(t, "Common", { one: "TransferImportAndReplaceOne", many: "TransferImportAndReplaceMany" }, alsoImported, {
    replaced,
  })
}

export function readyOutside(queue: readonly QueuedImport[], colliding: ReadonlySet<string>): number {
  return queue.filter((file) => file.status === "ready" && !colliding.has(file.key)).length
}

export function replaceWarning(t: TranslateFn, overwrites: boolean, trashes: boolean): string | null {
  const lines = [
    overwrites ? t("Common", "TransferReplaceCannotUndo") : null,
    trashes ? t("Common", "TransferReplaceKeepsTrash") : null,
  ]
  return lines.filter(Boolean).join(" ") || null
}

export const REPLACE_BUTTON_CLASS = "bg-danger text-canvas hover:bg-danger hover:opacity-90"

const IMPORTING = { one: "TransferImportingOne", many: "TransferImportingMany" }

/** The primary button's label while an import runs. */
export function importingLabel(t: TranslateFn, progress: { done: number; total: number }): string {
  return tPlural(t, "Common", IMPORTING, progress.total, { done: progress.done })
}
