/**
 * The image editor's strings, pinned against the real bundle.
 *
 * `translate` returns a miss as the bare key, so a typo here does not fail a build, it ships a
 * button labelled `ImageEditorChoose`. The C# bundle tests guard that every other language carries
 * every key English does, so pinning English pins all five.
 */
import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"

const IMAGE_EDITOR_KEYS = [
  "ImageEditorTitle",
  "ImageEditorChoose",
  "ImageEditorDropHint",
  "ImageEditorDropToAdd",
  "ImageEditorDropToReplace",
  "ImageEditorReading",
  "ImageEditorZoom",
  "ImageEditorReset",
  "ImageEditorAspect",
  "ImageEditorAspectOriginal",
  "ImageEditorAspectSquare",
  "ImageEditorAspect43",
  "ImageEditorAspect169",
  "ImageEditorStageLabel",
  "ImageEditorTooLarge",
  "ImageEditorUnsupported",
  "ImageEditorLoadFailed",
] as const

/** Reached through the Common namespace rather than through NotesEditor. */
const COMMON_KEYS = ["Close", "Cancel", "Save"] as const

describe("image editor translations", () => {
  const bundle = mergedEnglishBundle()

  it.each(IMAGE_EDITOR_KEYS)("resolves NotesEditor/%s", (key) => {
    expect(resolves(bundle, "NotesEditor", key), `NotesEditor/${key} is missing`).toBe(true)
  })

  it.each(COMMON_KEYS)("resolves Common/%s", (key) => {
    expect(resolves(bundle, "Common", key), `Common/${key} is missing`).toBe(true)
  })
})
