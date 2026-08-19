/**
 * translate.ts renders a miss as the bare key, so a string the optimizer row never got a
 * translation for reads as "ReviewSettingsOptimizeApply" on screen rather than failing anything.
 * The keys are scraped from the source instead of listed here, so a row added later is covered
 * without anyone remembering to come back.
 */
import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const WEB = ["mnemo-web", "src", "flashcards", "presets", "components"]
const SOURCE =
  readRepoText(...WEB, "PresetOptimizer.tsx") + readRepoText(...WEB, "PresetDetails.tsx")

const KEYS = [...new Set([...SOURCE.matchAll(/fc\("([A-Za-z0-9]+)"/g)].map((match) => match[1]!))]

describe("PresetOptimizer translations", () => {
  const bundle = mergedEnglishBundle()

  it("found the keys to check", () => {
    expect(KEYS).toContain("ReviewSettingsOptimizeAction")
    expect(KEYS).toContain("ReviewSettingsMemoryLabel")
  })

  it.each(KEYS)("resolves Flashcards/%s", (key) => {
    expect(resolves(bundle, "Flashcards", key), `Flashcards/${key} is missing from the bundle`).toBe(true)
  })

  it("keeps both counts in the message that asks for more history", () => {
    const value = bundle.Flashcards?.ReviewSettingsOptimizeNotEnoughFormat ?? ""
    expect(value).toContain("{0}")
    expect(value).toContain("{1}")
  })

  it("keeps both the review count and the gain in the fitted message", () => {
    const value = bundle.Flashcards?.ReviewSettingsOptimizeImprovedFormat ?? ""
    expect(value).toContain("{0}")
    expect(value).toContain("{1}")
  })
})
