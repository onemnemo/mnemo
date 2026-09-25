import { describe, expect, it } from "vitest"

import type { TransferWarningDto } from "@/api/types"
import { createTranslate } from "@/i18n/translate"
import { mergedEnglishBundle } from "@/i18n/test-bundle"
import type { TranslateFn } from "@/i18n/types"

import { groupedWarningLines, withoutTrailingPeriod } from "./transfer-warnings"

// The fake t renders keys and params, not sentences.
const t: TranslateFn = (ns, key, params) => {
  const rendered = Object.entries(params ?? {})
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(",")
  return rendered ? `${ns}.${key}(${rendered})` : `${ns}.${key}`
}

// The real English bundle, for assertions on the finished sentence.
const real: TranslateFn = createTranslate(mergedEnglishBundle())

function mediaFailed(mediaName: string, error: string): TransferWarningDto {
  return { key: "AnkiMediaImportFailed", params: { mediaName, error } }
}

describe("withoutTrailingPeriod", () => {
  it("strips exactly one trailing period", () => {
    expect(withoutTrailingPeriod("unsupported type.")).toBe("unsupported type")
  })

  it("leaves an ellipsis alone rather than eating part of it", () => {
    expect(withoutTrailingPeriod("Waiting for a response...")).toBe("Waiting for a response...")
  })

  it("leaves an abbreviation's period alone when it is not the sentence end being trimmed for", () => {
    expect(withoutTrailingPeriod("things, etc.")).toBe("things, etc")
  })

  it("leaves text with no trailing period unchanged", () => {
    expect(withoutTrailingPeriod("no punctuation here")).toBe("no punctuation here")
  })
})

describe("groupedWarningLines", () => {
  it("collapses a hundred same-reason warnings into one grouped line", () => {
    const warnings = Array.from({ length: 100 }, (_, i) =>
      mediaFailed(`file-${i}.svg`, "File is not a supported image (PNG, JPEG, GIF, WebP or BMP)."),
    )

    const lines = groupedWarningLines(t, warnings)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("TransferWarnings.AnkiMediaImportFailedCount(")
    expect(lines[0]).toContain("count=100")
    // The trailing period on the underlying error is gone from the reason that gets spliced in.
    expect(lines[0]).toContain("reason=File is not a supported image (PNG, JPEG, GIF, WebP or BMP)")
    expect(lines[0]).not.toContain("BMP).")
    expect(lines[0]).toContain("file-0.svg")
    expect(lines[0]).toContain("file-1.svg")
    expect(lines[0]).toContain("file-2.svg")
    expect(lines[0]).not.toContain("file-3.svg")
  })

  it("renders through the real English bundle without a doubled period or raw braces", () => {
    const warnings = Array.from({ length: 100 }, (_, i) =>
      mediaFailed(`file-${i}.svg`, "File is not a supported image (PNG, JPEG, GIF, WebP or BMP)."),
    )

    const lines = groupedWarningLines(real, warnings)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe(
      "100 media files could not be imported: File is not a supported image (PNG, JPEG, GIF, WebP or BMP). " +
        "For example: 'file-0.svg', 'file-1.svg', 'file-2.svg', and 97 more.",
    )
    expect(lines[0]).not.toContain("..")
    expect(lines[0]).not.toMatch(/[{}]/)
  })

  it("omits the reason clause instead of splicing in an empty one, keeping the item's own wording", () => {
    const warnings = [
      { key: "NoteImportFailed", params: { noteTitle: "a", error: "" } },
      { key: "NoteImportFailed", params: { noteTitle: "b", error: "" } },
    ] satisfies TransferWarningDto[]

    const lines = groupedWarningLines(real, warnings)

    expect(lines).toHaveLength(1)
    // Says "notes", not a generic "items".
    expect(lines[0]).toBe("2 notes could not be imported. For example: 'a', 'b'.")
    expect(lines[0]).not.toContain(": .")
  })

  it("gives a different item kind its own reason-less wording rather than a shared generic one", () => {
    const warnings = [
      { key: "MindmapImportFailed", params: { mapTitle: "a", error: "" } },
      { key: "MindmapImportFailed", params: { mapTitle: "b", error: "" } },
    ] satisfies TransferWarningDto[]

    const lines = groupedWarningLines(real, warnings)

    expect(lines).toEqual(["2 mindmaps were skipped. For example: 'a', 'b'."])
  })

  it("keeps different reasons under the same key separate", () => {
    const warnings = [
      ...Array.from({ length: 5 }, (_, i) => mediaFailed(`a-${i}.svg`, "unsupported type")),
      ...Array.from({ length: 5 }, (_, i) => mediaFailed(`b-${i}.svg`, "file too large")),
    ]

    const lines = groupedWarningLines(t, warnings)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("reason=unsupported type")
    expect(lines[1]).toContain("reason=file too large")
  })

  it("leaves a single warning worded exactly as it always was", () => {
    const warnings = [mediaFailed("only.svg", "unsupported type")]

    const lines = groupedWarningLines(t, warnings)

    expect(lines).toEqual(["TransferWarnings.AnkiMediaImportFailed(mediaName=only.svg,error=unsupported type)"])
  })

  it("does not group a warning key outside the table", () => {
    const warnings = [
      { key: "FlashcardsPayloadUnreadable", params: {} },
      { key: "FlashcardsPayloadUnreadable", params: {} },
    ] satisfies TransferWarningDto[]

    const lines = groupedWarningLines(t, warnings)

    expect(lines).toEqual(["TransferWarnings.FlashcardsPayloadUnreadable", "TransferWarnings.FlashcardsPayloadUnreadable"])
  })

  it("groups a key with no reason param by the item name alone", () => {
    const warnings = Array.from({ length: 2 }, (_, i) => ({
      key: "AnkiMediaNotFound",
      params: { mediaName: `missing-${i}.png` },
    })) satisfies TransferWarningDto[]

    const lines = groupedWarningLines(real, warnings)

    expect(lines).toEqual(["2 referenced media files were not found in the package. For example: 'missing-0.png', 'missing-1.png'."])
  })

  it("keeps two interleaved groups in first-seen order", () => {
    const warnings = [
      mediaFailed("a1.svg", "unsupported type"),
      mediaFailed("b1.svg", "file too large"),
      mediaFailed("a2.svg", "unsupported type"),
      mediaFailed("b2.svg", "file too large"),
    ]

    const lines = groupedWarningLines(t, warnings)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("reason=unsupported type")
    expect(lines[0]).toContain("a1.svg")
    expect(lines[0]).toContain("a2.svg")
    expect(lines[1]).toContain("reason=file too large")
    expect(lines[1]).toContain("b1.svg")
    expect(lines[1]).toContain("b2.svg")
  })
})
