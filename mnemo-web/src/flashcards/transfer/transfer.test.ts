import { describe, expect, it } from "vitest"

import type { TransferFormatDto } from "@/api/types"
import { conflictPolicyApplies, type QueuedFile } from "./transfer"

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
