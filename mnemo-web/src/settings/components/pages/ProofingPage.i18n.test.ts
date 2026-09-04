/**
 * The spelling page and its dictionary section both translate through a local
 * `st(key)` bound to the Settings namespace, and the settings schema names two
 * more keys for the nav entry itself. None of those are connected to whether
 * the key exists, and a settings page rendering `ProofingStateAbsent` where a
 * sentence should be is the most visible way this surface can look broken.
 */

import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, readRepoText, resolves } from "@/i18n/test-bundle"

const PAGE = readRepoText("mnemo-web", "src", "settings", "components", "pages", "ProofingPage.tsx")
const WORDS = readRepoText("mnemo-web", "src", "settings", "components", "pages", "ProofingPersonalWords.tsx")
const SCHEMA = readRepoText("mnemo-web", "src", "settings", "schema.ts")

function keysIn(source: string): string[] {
  return [...source.matchAll(/\bst\("([A-Za-z0-9_.]+)"/g)].map((match) => match[1])
}

/** The title and subtitle the nav row and the search index read. */
function schemaKeys(source: string): string[] {
  const category = /\{\s*id: "Proofing",[\s\S]*?\},\s*\n\n/.exec(source)?.[0] ?? ""
  return [...category.matchAll(/(?:title|subtitle): "([A-Za-z0-9_.]+)"/g)].map((match) => match[1])
}

describe("Proofing settings translations", () => {
  const bundle = mergedEnglishBundle()
  const keys = [...new Set([...keysIn(PAGE), ...keysIn(WORDS), ...schemaKeys(SCHEMA)])]

  it("reads its strings from the Settings namespace", () => {
    expect(PAGE).toMatch(/const NS = "Settings"/)
  })

  it("finds every key the page can render", () => {
    expect(keys.length).toBeGreaterThanOrEqual(18)
    expect(keys).toContain("ProofingCategoryTitle")
    expect(keys).toContain("ProofingSubtitle")
  })

  it.each([...new Set([...keysIn(PAGE), ...keysIn(WORDS), ...schemaKeys(SCHEMA)])])(
    "resolves Settings/%s",
    (key) => {
      expect(resolves(bundle, "Settings", key), `Settings/${key} is missing from the merged bundle`).toBe(true)
    },
  )

  it("keeps the word count a format string with a slot for the number", () => {
    expect(bundle.Settings?.ProofingPersonalCountFormat ?? "").toContain("{0}")
  })
})
