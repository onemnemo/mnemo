import { describe, expect, it } from "vitest"

import type { NoteSummaryDto, TransferFormatDto } from "@/api/types"
import { exportFormats, markdownCollisions, readyNoteCount, type QueuedFile } from "./transfer"

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

  it("offers only the package for a folder, even one holding a single note", () => {
    expect(exportFormats([PACKAGE, MARKDOWN], 1, true).map((f) => f.formatId)).toEqual(["notes.mnemo"])
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

describe("markdownCollisions", () => {
  const note = (title: string, folderId: string | null, parentNoteId: string | null = null) =>
    ({ title, folderId, parentNoteId }) as NoteSummaryDto
  const md = (name: string): QueuedFile => ({ ...ready(1), name, formatId: "notes.markdown" })

  it("matches titles case-insensitively among the folder's top-level notes", () => {
    const notes = [note("Cells", "bio"), note("Tissue", null), note("Organs", "bio", "parent")]
    const files = [md("cells.md"), md("Tissue.md"), md("Organs.md")]
    expect([...markdownCollisions(files, notes, "bio")]).toEqual([files[0].key])
  })

  it("counts a repeat inside the batch and skips packages", () => {
    const pkg: QueuedFile = { ...ready(3), name: "Cells.mnemo", formatId: "notes.mnemo" }
    const files = [md("Cells.md"), md("CELLS.md"), pkg]
    expect([...markdownCollisions(files, [], null)]).toEqual([files[1].key])
  })
})
