/**
 * The peek reads every string it owns through `t("App", "Peek...")`, and translate.ts
 * answers a miss with the bare key rather than failing anything, so a key that was never
 * written ships as the literal `PeekDockLeft` in a menu. Several are aria labels that no
 * screenshot would ever show. This pins the namespace in both directions: every key the
 * panel can ask for exists, and every `Peek` key that exists is one it can ask for.
 */
import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"

/** The panel, its header, and the entry that opens it. */
const PEEK_KEYS = [
  "PeekLabel",
  "PeekOpenInSidePeek",
  "PeekResize",
  "PeekRefresh",
  "PeekOpenFull",
  "PeekOptions",
  "PeekPin",
  "PeekUnpin",
  "PeekOverlay",
  "PeekDockRight",
  "PeekDockLeft",
  "PeekBackground",
  "PeekBackgroundFormat",
  "PeekCollapse",
  "PeekExpand",
  "PeekTooLongTitle",
  "PeekTooLongDescription",
] as const

/** Read by the note renderer from the module that owns the note copy. */
const BORROWED = [
  ["Notes", "Untitled"],
  ["Notes", "LoadFailedTitle"],
  ["Notes", "LoadFailedDescription"],
  ["Notes", "QuarantineTitle"],
  ["Notes", "QuarantineDescription"],
  ["Notes", "Retry"],
  ["Flashcards", "PeekCard"],
  ["Flashcards", "ColLapses"],
  ["Flashcards", "FieldFront"],
  ["Flashcards", "FieldBack"],
  ["Common", "Close"],
] as const

describe("side peek translations", () => {
  const bundle = mergedEnglishBundle()

  it.each(PEEK_KEYS)("resolves App/%s", (key) => {
    expect(resolves(bundle, "App", key), `App/${key} is missing from the merged bundle`).toBe(true)
  })

  it("carries no App/Peek key the panel cannot reach", () => {
    const written = Object.keys(bundle.App ?? {}).filter((key) => key.startsWith("Peek"))
    expect(written.filter((key) => !PEEK_KEYS.includes(key as (typeof PEEK_KEYS)[number]))).toEqual([])
  })

  it("keeps the placeholder in the background percentage", () => {
    expect(bundle.App?.PeekBackgroundFormat ?? "").toContain("{0}")
  })

  it.each(BORROWED)("resolves %s/%s, which the renderers read", (namespace, key) => {
    expect(resolves(bundle, namespace, key), `${namespace}/${key} is missing`).toBe(true)
  })
})
