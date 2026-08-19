/**
 * The trash surface reads every one of its strings through `t("Trash", ...)`, and translate.ts
 * returns a miss as the bare key rather than failing anything, so a key that was never written
 * ships as the literal `RestoreContainerHeld` in a toast. Eight of the keys are never named at a
 * call site at all (the kind labels and the expiry fragments are picked by lookup), so a grep
 * would not find them either. This pins the whole namespace in both directions: every key the
 * code can ask for exists, and every key that exists is one the code can ask for.
 */
import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"

/** Chosen by kind, in kinds.ts, so no call site names them. */
const KIND_KEYS = [
  "KindNote",
  "KindNoteFolder",
  "KindMindmap",
  "KindMindmapFolder",
  "KindDeck",
  "KindDeckFolder",
  "KindCard",
  "KindFact",
] as const

/** Chosen by how much time is left, in retention.ts. */
const RETENTION_KEYS = ["ExpiresSoon", "ExpiresHour", "ExpiresHours", "ExpiresDay", "ExpiresDays"] as const

/** The delete toast and its undo button. */
const UNDO_KEYS = [
  "DeletedOneFormat",
  "DeletedManyFormat",
  "KeptForDay",
  "KeptForDays",
  "Undo",
  "UndoIncomplete",
  "UndoFailed",
] as const

/** The page, its toolbar and one row. */
const PAGE_KEYS = [
  "SearchPlaceholder",
  "AllKinds",
  "EmptyTrash",
  "EmptyTrashConfirm",
  "EmptyDoneFormat",
  "EmptyBlockedFormat",
  "LoadMore",
  "NoMatches",
  "EmptyTitle",
  "EmptyDescription",
  "Unavailable",
  "Restore",
  "RestoreInto",
  "DeleteForever",
  "DeleteForeverConfirmFormat",
  "SourceUnavailable",
  "FromFormat",
  "ContainedOne",
  "ContainedManyFormat",
  "NoDecks",
] as const

/** One per restore outcome the server can report, plus the two ways a purge is refused. */
const OUTCOME_KEYS = [
  "RestoredFormat",
  "RestoredToRootFormat",
  "RestoreContainerHeld",
  "RestoreNeedsDestination",
  "RestoreMissing",
  "PurgeBlockedFormat",
  "PurgeBlockedByFormat",
] as const

const TRASH_KEYS = [...KIND_KEYS, ...RETENTION_KEYS, ...UNDO_KEYS, ...PAGE_KEYS, ...OUTCOME_KEYS] as const

/** Every key whose copy has somewhere to put a value. */
const FORMAT_KEYS = TRASH_KEYS.filter(
  (key) => key.endsWith("Format") || key.startsWith("Expires") || key.startsWith("KeptFor"),
).filter((key) => key !== "ExpiresSoon")

describe("Trash translations", () => {
  const bundle = mergedEnglishBundle()

  it.each(TRASH_KEYS)("resolves Trash/%s", (key) => {
    expect(resolves(bundle, "Trash", key), `Trash/${key} is missing from the merged bundle`).toBe(true)
  })

  it("carries no strings the surface cannot reach", () => {
    const written = Object.keys(bundle.Trash ?? {})
    expect(written.filter((key) => !TRASH_KEYS.includes(key as (typeof TRASH_KEYS)[number]))).toEqual([])
  })

  it.each(FORMAT_KEYS)("keeps the placeholder in Trash/%s", (key) => {
    expect(bundle.Trash?.[key] ?? "").toContain("{0}")
  })

  it("names the settings category the trash page hangs off", () => {
    expect(resolves(bundle, "Settings", "TrashCategoryTitle")).toBe(true)
    expect(resolves(bundle, "Settings", "TrashSubtitle")).toBe(true)
  })
})
