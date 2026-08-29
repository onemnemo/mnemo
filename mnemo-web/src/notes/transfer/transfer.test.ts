import { describe, expect, it } from "vitest"

import type { TransferFormatDto } from "@/api/types"
import {
  canImport,
  exportFormats,
  isImportable,
  readyNoteCount,
  replaceNeedsConfirmation,
  type QueuedFile,
} from "./transfer"

const PACKAGE: TransferFormatDto = {
  formatId: "notes.mnemo",
  displayName: "Mnemo Package (.mnemo)",
  extensions: [".mnemo"],
  supportsImport: true,
  supportsExport: true,
}
const MARKDOWN: TransferFormatDto = {
  formatId: "notes.markdown",
  displayName: "Markdown (.md)",
  extensions: [".md"],
  supportsImport: true,
  supportsExport: true,
}

const ready = (noteCount: number | null | undefined): QueuedFile => ({
  key: crypto.randomUUID(),
  name: "n.md",
  sizeBytes: 10,
  status: "ready",
  uploadId: "u",
  noteCount,
})

describe("exportFormats", () => {
  it("offers every format for a single note", () => {
    expect(exportFormats([PACKAGE, MARKDOWN], 1).map((f) => f.formatId)).toEqual(["notes.mnemo", "notes.markdown"])
  })

  it("offers only the package for a multi-note selection, since markdown carries one note", () => {
    expect(exportFormats([PACKAGE, MARKDOWN], 3).map((f) => f.formatId)).toEqual(["notes.mnemo"])
  })
})

describe("readyNoteCount", () => {
  it("sums the counts when every ready file can say", () => {
    expect(readyNoteCount([ready(1), ready(4)])).toBe(5)
  })

  it("is unknowable when any ready file cannot say", () => {
    expect(readyNoteCount([ready(1), ready(null)])).toBeNull()
    expect(readyNoteCount([])).toBeNull()
  })
})

describe("isImportable", () => {
  it("accepts a claimed extension and rejects the rest", () => {
    expect(isImportable("notes.mnemo", [PACKAGE, MARKDOWN])).toBe(true)
    expect(isImportable("deck.apkg", [PACKAGE, MARKDOWN])).toBe(false)
  })
})

describe("canImport", () => {
  it("waits for uploads to settle", () => {
    expect(canImport([ready(1)])).toBe(true)
    expect(canImport([{ ...ready(1), status: "uploading" }])).toBe(false)
    expect(canImport([{ ...ready(1), status: "rejected" }])).toBe(false)
  })
})

describe("replaceNeedsConfirmation", () => {
  it("stays quiet under a policy that takes nothing", () => {
    expect(replaceNeedsConfirmation([ready(1)], "KeepBoth")).toBe(false)
    expect(replaceNeedsConfirmation([ready(1)], "Skip")).toBe(false)
  })

  it("stays quiet while no file in the queue could import", () => {
    expect(
      replaceNeedsConfirmation(
        [
          { ...ready(1), status: "uploading" },
          { ...ready(1), status: "rejected" },
        ],
        "Replace",
      ),
    ).toBe(false)
  })

  it("asks as soon as one file is ready to replace something", () => {
    expect(replaceNeedsConfirmation([ready(1)], "Replace")).toBe(true)
  })
})
