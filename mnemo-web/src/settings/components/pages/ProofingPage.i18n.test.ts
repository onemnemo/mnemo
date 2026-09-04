/**
 * The spelling page, its two dialogs and the module they share all translate
 * through a local `st(key)` bound to the Settings namespace, and the settings
 * schema names two more keys for the nav entry itself. None of those are
 * connected to whether the key exists, and a settings page rendering
 * `ProofingStateAbsent` where a sentence should be is the most visible way this
 * surface can look broken.
 *
 * The scrape is over a fixed file list, so a key that moves into a new file
 * loses its cover unless that file is added here.
 */

import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const PAGES = ["ProofingPage.tsx", "ProofingLanguageRow.tsx", "ProofingLanguagePicker.tsx", "ProofingWordsDialog.tsx"]

const SOURCES = [...PAGES, "proofing-languages.ts"].map((file) => ({
  file,
  text: readRepoText("mnemo-web", "src", "settings", "components", "pages", file),
}))

const SCHEMA = readRepoText("mnemo-web", "src", "settings", "schema.ts")

/**
 * The reasons an absent dictionary reports. The catalogue chose these names, so
 * they reach the bundle through a variable and no scrape can find them.
 */
const REASONS = [
  "proofing.language.notAvailableYet",
  "proofing.language.unsupportedByEngine",
  "proofing.language.filesMissing",
]

function keysIn(source: string): string[] {
  return [...source.matchAll(/\bst\("([A-Za-z0-9_.]+)"/g)].map((match) => match[1])
}

/** The title and subtitle the nav row and the search index read. */
function schemaKeys(source: string): string[] {
  const category = /\{\s*id: "Proofing",[\s\S]*?\},\s*\n\n/.exec(source)?.[0] ?? ""
  return [...category.matchAll(/(?:title|subtitle): "([A-Za-z0-9_.]+)"/g)].map((match) => match[1])
}

const KEYS = [...new Set([...SOURCES.flatMap((source) => keysIn(source.text)), ...schemaKeys(SCHEMA), ...REASONS])]

describe("Proofing settings translations", () => {
  const bundle = mergedEnglishBundle()

  it.each(PAGES)("reads %s from the Settings namespace", (file) => {
    expect(SOURCES.find((source) => source.file === file)?.text).toMatch(/const NS = "Settings"/)
  })

  it("finds every key the page can render", () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(30)
    expect(KEYS).toContain("ProofingCategoryTitle")
    expect(KEYS).toContain("ProofingSubtitle")
  })

  it.each(KEYS)("resolves Settings/%s", (key) => {
    expect(resolves(bundle, "Settings", key), `Settings/${key} is missing from the merged bundle`).toBe(true)
  })

  it.each(["ProofingPersonalCountOne", "ProofingPersonalCountMany"])("keeps %s a slot for the number", (key) => {
    expect(bundle.Settings?.[key] ?? "").toContain("{0}")
  })
})
