import { describe, expect, it } from "vitest"

import type {
  PackageEvidenceDto,
  PayloadEvidenceDto,
  TransferFormatDto,
  TransferImportResultDto,
} from "@/api/types"
import type { TranslateFn } from "@/i18n/types"
import {
  conflictPolicyApplies,
  evidenceHeadline,
  evidenceLines,
  exportKind,
  importResultNotice,
  packageCaptionKey,
  replaceNeedsConfirmation,
  type QueuedFile,
} from "./transfer"

const PACKAGE: TransferFormatDto = {
  formatId: "flashcards.mnemo",
  displayName: "Mnemo Package",
  extensions: [".mnemo"],
  supportsImport: true,
  supportsExport: true,
  supportsConflictPolicy: true,
}

const ANKI: TransferFormatDto = {
  formatId: "flashcards.anki",
  displayName: "Anki Package",
  extensions: [".apkg"],
  supportsImport: true,
  supportsExport: true,
  supportsConflictPolicy: false,
}

const FORMATS = [PACKAGE, ANKI]

function queued(formatId: string, status: QueuedFile["status"] = "ready"): QueuedFile {
  return { key: formatId + status, name: "file", sizeBytes: 1, status, formatId }
}

describe("conflictPolicyApplies", () => {
  it("keeps the question for an empty queue", () => {
    expect(conflictPolicyApplies([], FORMATS)).toBe(true)
  })

  it("drops it when nothing queued carries ids to collide on", () => {
    expect(conflictPolicyApplies([queued("flashcards.anki")], FORMATS)).toBe(false)
  })

  it("keeps it when one file in a mixed queue reads the answer", () => {
    expect(conflictPolicyApplies([queued("flashcards.anki"), queued("flashcards.mnemo")], FORMATS)).toBe(true)
  })

  it("ignores files that will not be imported", () => {
    const queue = [queued("flashcards.anki"), queued("flashcards.mnemo", "rejected")]
    expect(conflictPolicyApplies(queue, FORMATS)).toBe(false)
  })

  it("keeps it for a format the list does not describe rather than guessing", () => {
    expect(conflictPolicyApplies([queued("flashcards.unknown")], FORMATS)).toBe(true)
  })

  it("treats a server that does not report the flag as honouring it", () => {
    const older: TransferFormatDto = { ...ANKI, supportsConflictPolicy: undefined }
    expect(conflictPolicyApplies([queued("flashcards.anki")], [older])).toBe(true)
  })
})

// The dialog reads keys, not sentences, so these render "Key(param=value)" and assert on that.
// A translated string would only prove that de.json says what de.json says.
const t: TranslateFn = (ns, key, params) => {
  const rendered = Object.entries(params ?? {})
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(",")
  return rendered ? `${ns}.${key}(${rendered})` : `${ns}.${key}`
}

function evidence(payload: Partial<PayloadEvidenceDto> = {}, kind = "backup", here = true): PackageEvidenceDto {
  return {
    kind,
    collectionId: "collection-a",
    fromThisCollection: here,
    createdAtUtc: null,
    createdByAppVersion: null,
    canRead: payload.canRead ?? true,
    payloads: [
      {
        payloadType: "flashcards",
        payloadVersion: 3,
        supportedPayloadVersion: 3,
        canRead: true,
        inPackage: 4,
        alreadyHere: 3,
        newHere: 1,
        missingFromPackage: 2,
        replaceWouldDiscard: 17,
        ...payload,
      },
    ],
  }
}

function packageRow(payload: Partial<PayloadEvidenceDto> = {}, status: QueuedFile["status"] = "ready"): QueuedFile {
  return { ...queued("flashcards.mnemo", status), evidence: evidence(payload) }
}

describe("package evidence", () => {
  it("names the kind of file and where it came from", () => {
    expect(evidenceHeadline(t, evidence())).toBe("Common.TransferEvidenceBackupHere")
    expect(evidenceHeadline(t, evidence({}, "backup", false))).toBe("Common.TransferEvidenceBackupElsewhere")
    expect(evidenceHeadline(t, evidence({}, "export", true))).toBe("Common.TransferEvidenceExportHere")
    expect(evidenceHeadline(t, evidence({}, "export", false))).toBe("Common.TransferEvidenceExportElsewhere")
  })

  it("reports what is in the file, what is already here, what is missing and what a replace destroys", () => {
    expect(evidenceLines(t, evidence())).toEqual([
      "Common.TransferEvidenceDecksFormat(0=4)",
      "Common.TransferEvidenceAlreadyHereFormat(0=3,1=1)",
      "Common.TransferEvidenceMissingFormat(0=2)",
      "Common.TransferEvidenceReplaceDiscardsFormat(0=17)",
    ])
  })

  it("stays quiet about the lines that have nothing to say", () => {
    const fresh = evidence({ alreadyHere: 0, newHere: 4, missingFromPackage: 0, replaceWouldDiscard: 0 })
    expect(evidenceLines(t, fresh)).toEqual(["Common.TransferEvidenceDecksFormat(0=4)"])
  })

  it("refuses to count anything in a payload this build cannot read", () => {
    expect(evidenceLines(t, evidence({ canRead: false }))).toEqual(["Common.TransferEvidenceTooNew"])
  })
})

describe("replaceNeedsConfirmation", () => {
  it("asks when replacing would take decks this collection already has", () => {
    expect(replaceNeedsConfirmation([packageRow()], "Replace")).toBe(true)
  })

  it("stays out of the way for the policies that destroy nothing", () => {
    expect(replaceNeedsConfirmation([packageRow()], "KeepBoth")).toBe(false)
    expect(replaceNeedsConfirmation([packageRow()], "Skip")).toBe(false)
  })

  it("does not ask when the file overlaps nothing here", () => {
    const fresh = packageRow({ alreadyHere: 0, newHere: 4, replaceWouldDiscard: 0 })
    expect(replaceNeedsConfirmation([fresh], "Replace")).toBe(false)
  })

  it("ignores a file that is not going to be imported", () => {
    expect(replaceNeedsConfirmation([packageRow({}, "rejected")], "Replace")).toBe(false)
  })

  it("ignores a format that carries no evidence at all", () => {
    expect(replaceNeedsConfirmation([queued("flashcards.anki")], "Replace")).toBe(false)
  })
})

describe("exporting the whole collection", () => {
  it("is a backup, and a chosen part of it is an export", () => {
    expect(exportKind(true)).toBe("backup")
    expect(exportKind(false)).toBe("export")
    expect(exportKind(undefined)).toBe("export")
  })

  it("carries its own caption rather than the shared archive one", () => {
    expect(packageCaptionKey(true)).toBe("TransferFormatCaptionBackup")
    expect(packageCaptionKey(false)).toBe("TransferFormatCaptionSelection")
  })
})

describe("importResultNotice", () => {
  const result = (over: Partial<TransferImportResultDto> = {}): TransferImportResultDto => ({
    succeededFiles: 1,
    failedFiles: 0,
    importedCards: 12,
    warnings: [],
    errors: [],
    ...over,
  })

  it("reports a clean import as a success", () => {
    const notice = importResultNotice(t, result(), "12 cards")
    expect(notice.tone).toBe("success")
    expect(notice.description).toBe("Common.TransferImportFinishedFormat(0=12 cards)")
  })

  it("surfaces a warning the import raised rather than dropping it", () => {
    const refused = result({
      warnings: [{ key: "FlashcardsPackageTooNew", params: { packageVersion: "9", supportedVersion: "3" } }],
    })

    const notice = importResultNotice(t, refused, "0 cards")

    expect(notice.tone).toBe("warning")
    expect(notice.description).toContain(
      "TransferWarnings.FlashcardsPackageTooNew(packageVersion=9,supportedVersion=3)",
    )
  })

  it("keeps the errors and the warnings when only some files landed", () => {
    const partial = result({
      failedFiles: 1,
      errors: ["deck.apkg failed"],
      warnings: [{ key: "FlashcardsPayloadUnreadable", params: {} }],
    })

    const notice = importResultNotice(t, partial, "12 cards")

    expect(notice.tone).toBe("warning")
    expect(notice.description).toContain("deck.apkg failed")
    expect(notice.description).toContain("TransferWarnings.FlashcardsPayloadUnreadable")
  })

  it("reports nothing landing as a failure, with every reason it was given", () => {
    const failed = result({
      succeededFiles: 0,
      failedFiles: 1,
      importedCards: 0,
      errors: ["unreadable"],
      warnings: [{ key: "FlashcardsPayloadUnreadable", params: {} }],
    })

    const notice = importResultNotice(t, failed, "0 cards")

    expect(notice.tone).toBe("warning")
    expect(notice.titleKey).toBe("ImportFailedTitle")
    expect(notice.description).toContain("unreadable")
    expect(notice.description).toContain("TransferWarnings.FlashcardsPayloadUnreadable")
  })
})
