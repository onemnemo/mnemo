import byEmoji from "unicode-emoji-json/data-by-emoji.json"
import { describe, expect, it } from "vitest"

import { EMOJI_ALIASES } from "./aliases"
import { CURATED_CATEGORIES, EMOJI_CATEGORIES, EMOJI_CATEGORY_KEY, UNICODE_GROUP_CATEGORY } from "./categories"

const dataset = byEmoji as unknown as Record<string, { group: string }>

/**
 * The curated lists and aliases name emoji by literal character, and a bare "⚙"
 * looks identical to the dataset's "⚙️" while matching nothing. Only a check
 * against the real data catches that, so these run against the shipped package
 * rather than a fixture.
 */
describe("curated emoji resolve", () => {
  for (const [category, chars] of Object.entries(CURATED_CATEGORIES)) {
    it(`every ${category} emoji exists in the dataset`, () => {
      expect(chars?.filter((char) => !(char in dataset))).toEqual([])
    })
  }

  it("every alias points at emoji that exist", () => {
    const missing = Object.entries(EMOJI_ALIASES).flatMap(([term, chars]) =>
      chars.filter((char) => !(char in dataset)).map((char) => `${term}: ${char}`),
    )

    expect(missing).toEqual([])
  })
})

describe("category coverage", () => {
  it("maps every Unicode group, so no emoji is unreachable", () => {
    const groups = new Set(Object.values(dataset).map((entry) => entry.group))
    const unmapped = [...groups].filter((group) => !(group in UNICODE_GROUP_CATEGORY))

    expect(unmapped).toEqual([])
  })

  it("gives every category a label key", () => {
    expect(EMOJI_CATEGORIES.filter((category) => !EMOJI_CATEGORY_KEY[category])).toEqual([])
  })

  it("only curates categories that exist", () => {
    const unknown = Object.keys(CURATED_CATEGORIES).filter(
      (category) => !EMOJI_CATEGORIES.includes(category as (typeof EMOJI_CATEGORIES)[number]),
    )

    expect(unknown).toEqual([])
  })
})
