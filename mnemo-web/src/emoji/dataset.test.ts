import { describe, expect, it } from "vitest"

import { buildEmojiIndex } from "./dataset"

// Fixtures rather than the shipped data: these assert how the index is assembled,
// and pinning them to real emoji would make the test fail whenever the dataset
// adds a keyword.
const BY_EMOJI = {
  "🧬": { name: "dna", group: "Objects" },
  "😀": { name: "grinning face", group: "Smileys & Emotion" },
  "🐶": { name: "dog face", group: "Animals & Nature" },
  "🏳️": { name: "white flag", group: "Flags" },
}

const ORDERED = ["🧬", "😀", "🐶", "🏳️"]

const KEYWORDS = {
  "🧬": ["Evolution", "Gene"],
  "😀": ["smile"],
}

function build() {
  return buildEmojiIndex(BY_EMOJI, ORDERED, KEYWORDS)
}

describe("buildEmojiIndex", () => {
  it("keeps an emoji in every category that claims it", () => {
    const dna = build().byChar.get("🧬")

    // Curated into both study sciences, and its Unicode group adds a third.
    expect(dna?.categories).toEqual(expect.arrayContaining(["science", "medicine", "objects"]))
  })

  it("never assigns the recent category, which the user fills", () => {
    const assigned = build().all.flatMap((entry) => entry.categories)

    expect(assigned).not.toContain("recent")
  })

  it("folds each Unicode group into its Mnemo category", () => {
    const index = build()

    expect(index.byChar.get("😀")?.categories).toContain("people")
    expect(index.byChar.get("🐶")?.categories).toContain("nature")
    expect(index.byChar.get("🏳️")?.categories).toContain("symbols")
  })

  it("merges the name, dataset keywords and aliases, lowercased and deduped", () => {
    const dna = build().byChar.get("🧬")

    expect(dna?.keywords).toContain("dna")
    expect(dna?.keywords).toContain("evolution")
    // Reaches it through the alias table, which the dataset knows nothing about.
    expect(dna?.keywords).toContain("genetics")
    expect(new Set(dna?.keywords).size).toBe(dna?.keywords.length)
  })

  it("leads a category with its curated members, in curated order", () => {
    const science = build().byCategory.get("science")

    expect(science?.[0]?.char).toBe("🧬")
  })

  it("skips an emoji that is ordered but missing from the data", () => {
    const index = buildEmojiIndex(BY_EMOJI, [...ORDERED, "🫥"], KEYWORDS)

    expect(index.byChar.has("🫥")).toBe(false)
    expect(index.all).toHaveLength(ORDERED.length)
  })
})
