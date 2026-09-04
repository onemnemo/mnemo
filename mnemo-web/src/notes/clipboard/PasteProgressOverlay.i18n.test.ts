/**
 * PasteProgressOverlay reads its three strings from the Keybinds namespace (see the
 * comment on `nt` in PasteProgressOverlay.tsx), because that is where the editor's
 * clipboard action labels, and the paste-staging copy filed alongside them, actually
 * live: Mnemo.Infrastructure/Modules/Notes/Translations/en.json. translate.ts returns a miss as
 * the bare key, so a namespace typo here renders as `editor.clipboard.pasteStagingImage`
 * instead of failing a build. This pins both the namespace and the keys against the
 * real bundle so that regression shows up here first.
 */
import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const OVERLAY_SOURCE = readRepoText("mnemo-web", "src", "notes", "clipboard", "PasteProgressOverlay.tsx")

const PASTE_KEYS = [
  "editor.clipboard.pasteStagingImage",
  "editor.clipboard.pasteStagingImages",
  "editor.clipboard.pasteCancel",
] as const

describe("PasteProgressOverlay translations", () => {
  const bundle = mergedEnglishBundle()

  it("still targets the Keybinds namespace, not Notes", () => {
    expect(OVERLAY_SOURCE).toMatch(/t\(\s*['"]Keybinds['"]/)
  })

  it.each(PASTE_KEYS)("resolves Keybinds/%s", (key) => {
    expect(resolves(bundle, "Keybinds", key), `Keybinds/${key} is missing from the merged bundle`).toBe(true)
  })

  it("keeps both {0} and {1} in the plural staging message", () => {
    const value = bundle.Keybinds?.["editor.clipboard.pasteStagingImages"] ?? ""
    expect(value).toContain("{0}")
    expect(value).toContain("{1}")
  })
})
