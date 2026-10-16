import { describe, expect, it } from "vitest"

import type { TransferFormatDto } from "@/api/types"
import { exportFormats, exportKind } from "./transfer"

const PACKAGE: TransferFormatDto = {
  formatId: "flashcards.mnemo",
  displayName: "Mnemo Package",
  extensions: [".mnemo"],
  supportsImport: true,
  supportsExport: true,
  supportsConflictPolicy: true,
}

describe("exporting the whole collection", () => {
  it("is a backup, and a chosen part of it is an export", () => {
    expect(exportKind(true)).toBe("backup")
    expect(exportKind(false)).toBe("export")
    expect(exportKind(undefined)).toBe("export")
  })
})

describe("exportFormats", () => {
  const CSV: TransferFormatDto = { ...PACKAGE, formatId: "flashcards.csv", extensions: [".csv"] }

  it("offers every format for one deck", () => {
    expect(exportFormats([PACKAGE, CSV], 1).map((f) => f.formatId)).toEqual(["flashcards.mnemo", "flashcards.csv"])
  })

  it("offers only the package for a folder, even one holding a single deck", () => {
    expect(exportFormats([PACKAGE, CSV], 1, true).map((f) => f.formatId)).toEqual(["flashcards.mnemo"])
  })
})
