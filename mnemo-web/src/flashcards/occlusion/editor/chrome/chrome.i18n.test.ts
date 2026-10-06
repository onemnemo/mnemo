import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { mergedEnglishBundle, resolves } from "@/i18n/test-bundle"

const SOURCES = [import.meta.dirname, path.resolve(import.meta.dirname, "../../../facts")]

function sourceFiles(): string[] {
  return SOURCES.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && name !== "chrome-harness.tsx")
      .map((name) => path.join(dir, name)),
  )
}

describe("editor chrome strings", () => {
  const bundle = mergedEnglishBundle()
  const keys = new Set<string>()
  for (const file of sourceFiles()) {
    for (const match of readFileSync(file, "utf8").matchAll(/"(Occlusion[A-Za-z]+|FactRemovesCards(?:One|Many))"/g)) keys.add(match[1])
  }

  it("reads some keys", () => {
    expect(keys.size).toBeGreaterThan(30)
  })

  it("resolves every key it names in the Flashcards namespace", () => {
    const missing = [...keys].filter((key) => !resolves(bundle, "Flashcards", key))
    expect(missing).toEqual([])
  })
})
