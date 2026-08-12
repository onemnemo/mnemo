import { describe, expect, it } from "vitest"

import type { MindmapTransferUploadDto, TransferFormatDto } from "@/api/types"
import {
  canImport,
  exportFormats,
  isImportable,
  queuedFromUpload,
  readyMapCount,
  readyUploadIds,
  type QueuedFile,
} from "./transfer"

const PACKAGE: TransferFormatDto = {
  formatId: "mindmaps.mnemo",
  displayName: "Mnemo Package (.mnemo)",
  extensions: [".mnemo"],
  supportsImport: true,
  supportsExport: true,
}
const IMAGE: TransferFormatDto = {
  formatId: "mindmaps.png",
  displayName: "PNG (.png)",
  extensions: [".png"],
  supportsImport: false,
  supportsExport: true,
}

const ready = (mapCount: number | null | undefined, uploadId = "u"): QueuedFile => ({
  key: crypto.randomUUID(),
  name: "map.mnemo",
  sizeBytes: 10,
  status: "ready",
  uploadId,
  mapCount,
})

describe("exportFormats", () => {
  it("offers every exporting format whatever the selection holds", () => {
    expect(exportFormats([PACKAGE, IMAGE]).map((f) => f.formatId)).toEqual(["mindmaps.mnemo", "mindmaps.png"])
  })

  it("leaves out a format that cannot be written", () => {
    expect(exportFormats([{ ...PACKAGE, supportsExport: false }])).toEqual([])
  })
})

describe("readyMapCount", () => {
  it("sums the counts when every ready file can say", () => {
    expect(readyMapCount([ready(1), ready(4)])).toBe(5)
  })

  it("is unknowable when any ready file cannot say", () => {
    expect(readyMapCount([ready(1), ready(null)])).toBeNull()
    expect(readyMapCount([])).toBeNull()
  })

  it("ignores files that are not going to be imported", () => {
    expect(readyMapCount([ready(2), { ...ready(null), status: "rejected" }])).toBe(2)
  })
})

describe("readyUploadIds", () => {
  it("sends the ready ones, in queue order", () => {
    const queue = [ready(1, "a"), { ...ready(1, "b"), status: "rejected" as const }, ready(1, "c")]
    expect(readyUploadIds(queue)).toEqual(["a", "c"])
  })
})

describe("isImportable", () => {
  it("accepts a claimed extension and rejects the rest", () => {
    expect(isImportable("Study.mnemo", [PACKAGE, IMAGE])).toBe(true)
    expect(isImportable("map.png", [PACKAGE, IMAGE])).toBe(false)
    expect(isImportable("notes.md", [PACKAGE, IMAGE])).toBe(false)
  })
})

describe("canImport", () => {
  it("waits for uploads to settle", () => {
    expect(canImport([ready(1)])).toBe(true)
    expect(canImport([{ ...ready(1), status: "uploading" }])).toBe(false)
    expect(canImport([{ ...ready(1), status: "rejected" }])).toBe(false)
  })

  it("is false while one file is still going up beside a settled one", () => {
    expect(canImport([ready(1), { ...ready(1), status: "uploading" }])).toBe(false)
  })
})

describe("queuedFromUpload", () => {
  const upload: MindmapTransferUploadDto = {
    uploadId: "u1",
    fileName: "Study.mnemo",
    sizeBytes: 2048,
    formatId: "mindmaps.mnemo",
    formatName: "Mnemo Package (.mnemo)",
    canImport: true,
    mapCount: 3,
    warnings: [],
  }

  it("keeps a file the server could not read, with the reason attached", () => {
    const row = queuedFromUpload("k", { ...upload, canImport: false, mapCount: null, warnings: ["Corrupt archive."] })
    expect(row.status).toBe("rejected")
    expect(row.notes).toEqual(["Corrupt archive."])
    expect(row.uploadId).toBe("u1")
  })

  it("carries the preview through for a file that read cleanly", () => {
    const row = queuedFromUpload("k", upload)
    expect(row).toMatchObject({ key: "k", status: "ready", mapCount: 3, notes: undefined })
  })
})
