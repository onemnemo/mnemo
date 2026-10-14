import { describe, expect, it } from "vitest"

import type { PayloadEvidenceDto, TransferFormatDto, TransferImportResultDto } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

import {
  canImport,
  chunked,
  isImportable,
  packageCollidingKeys,
  packageCollisions,
  readyOutside,
  replaceLabel,
  packageTooNew,
  replaceDiscards,
  type QueuedImport,
} from "./import-queue"
import { importResultNotice, mergeResults } from "./import-result"

// Renders "ns.Key(param=value)" so assertions do not depend on a locale.
const t: TranslateFn = (ns, key, params) => {
  const rendered = Object.entries(params ?? {})
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(",")
  return rendered ? `${ns}.${key}(${rendered})` : `${ns}.${key}`
}

const PACKAGE: TransferFormatDto = {
  formatId: "flashcards.mnemo",
  displayName: "Mnemo Package",
  extensions: [".mnemo"],
  supportsImport: true,
  supportsExport: true,
}

function row(status: QueuedImport["status"] = "ready", payload: Partial<PayloadEvidenceDto> | null = null): QueuedImport {
  return {
    key: crypto.randomUUID(),
    name: "file.mnemo",
    sizeBytes: 1,
    status,
    evidence: payload
      ? {
          kind: "export",
          collectionId: null,
          fromThisCollection: true,
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
              missingFromPackage: 0,
              replaceWouldDiscard: 17,
              ...payload,
            },
          ],
        }
      : undefined,
  }
}

describe("package collisions", () => {
  it("sums what ready packages already have here, and what a replace would delete", () => {
    const queue = [row("ready", {}), row("ready", { alreadyHere: 2, replaceWouldDiscard: 1 }), row("ready")]
    expect(packageCollisions(queue, "flashcards")).toBe(5)
    expect(replaceDiscards(queue, "flashcards")).toBe(18)
  })

  it("ignores rows that will not import, other payloads and unreadable ones", () => {
    const queue = [row("uploading", {}), row("rejected", {}), row("ready", { canRead: false })]
    expect(packageCollisions(queue, "flashcards")).toBe(0)
    expect(packageCollisions([row("ready", {})], "notes")).toBe(0)
    expect(packageTooNew(queue[2], "flashcards")).toBe(true)
    expect(packageTooNew(queue[0], "flashcards")).toBe(false)
  })
})

describe("the replace label", () => {
  it("names only the replace when every ready file collides, and both counts otherwise", () => {
    const hit = row("ready", {})
    const queue = [hit, row("ready"), row("ready"), row("rejected")]
    const colliding = packageCollidingKeys(queue, "flashcards")

    expect([...colliding]).toEqual([hit.key])
    expect(readyOutside(queue, colliding)).toBe(2)
    expect(replaceLabel(t, 3, 0)).toBe("Common.TransferReplaceCountMany(count=3)")
    expect(replaceLabel(t, 3, 2)).toBe("Common.TransferImportAndReplaceMany(replaced=3,count=2)")
  })
})

describe("the queue rules", () => {
  it("accepts a claimed extension in any case and refuses the rest", () => {
    expect(isImportable("Deck.MNEMO", [PACKAGE])).toBe(true)
    expect(isImportable("deck.apkg", [PACKAGE])).toBe(false)
    expect(isImportable("deck.mnemo", [{ ...PACKAGE, supportsImport: false }])).toBe(false)
  })

  it("waits for every upload before it can import", () => {
    expect(canImport([row()])).toBe(true)
    expect(canImport([row(), row("uploading")])).toBe(false)
    expect(canImport([row("rejected")])).toBe(false)
  })

  it("chunks at the host's limit", () => {
    expect(chunked(Array.from({ length: 120 }, (_, i) => i)).map((chunk) => chunk.length)).toEqual([50, 50, 20])
    expect(chunked([])).toEqual([])
  })
})

describe("mergeResults", () => {
  it("adds the counts and joins the lists of every chunk", () => {
    const first: TransferImportResultDto = { succeededFiles: 50, failedFiles: 0, importedCards: 400, warnings: [], errors: [] }
    const second: TransferImportResultDto = {
      succeededFiles: 9,
      failedFiles: 1,
      importedCards: 30,
      warnings: [{ key: "W", params: {} }],
      errors: ["bad.apkg"],
    }
    expect(mergeResults([first, second])).toEqual({
      succeededFiles: 59,
      failedFiles: 1,
      importedCards: 430,
      warnings: [{ key: "W", params: {} }],
      errors: ["bad.apkg"],
    })
    expect(mergeResults([])).toBeNull()
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

  it("keeps the success tone for lines that are information, not problems", () => {
    const news = result({ warnings: [{ key: "AnkiReviewHistoryImported", params: { count: "40" }, severity: "info" }] })

    const notice = importResultNotice(t, news, "12 cards")

    expect(notice.tone).toBe("success")
    expect(notice.description).toContain("TransferWarnings.AnkiReviewHistoryImported(count=40)")
  })

  it("reads as a warning when any line is one, beside information", () => {
    const mixed = result({
      warnings: [
        { key: "AnkiReviewHistoryImported", params: { count: "40" }, severity: "info" },
        { key: "FlashcardsPayloadUnreadable", params: {}, severity: "warning" },
      ],
    })

    expect(importResultNotice(t, mixed, "12 cards").tone).toBe("warning")
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
