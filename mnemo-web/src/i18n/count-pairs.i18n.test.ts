import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { pluralKey, tPlural } from "./plural"
import { findModuleEnglishBundles, repoFile, type Bundle } from "./test-bundle"
import { createTranslate } from "./translate"

const LANGUAGES = ["en", "de", "es", "ja", "nb"] as const

function mergedBundle(language: string): Bundle {
  const files = [
    repoFile("Mnemo.Infrastructure", "Languages", `${language}.json`),
    ...findModuleEnglishBundles().map((file) => file.replace(/en\.json$/, `${language}.json`)),
  ]
  const merged: Bundle = {}
  for (const file of files) {
    for (const [ns, entries] of Object.entries(JSON.parse(readFileSync(file, "utf8")) as Bundle)) {
      merged[ns] ??= {}
      Object.assign(merged[ns], entries)
    }
  }
  return merged
}

/** Count strings outside flashcards that read the count's form from the language's rules. */
const PAIRS = [
  ["Notes", "WordCount"],
  ["WidgetActivity", "ReviewsTotal"],
  ["WidgetActivity", "ReviewsOnDay"],
  ["WidgetStreak", "ReviewsOnDay"],
  ["WidgetDeck", "CaughtUp"],
  ["Settings", "HiddenSettings"],
  ["Settings", "SearchResultsSubtitle"],
  ["Settings", "KeyboardConflicts"],
  ["Trash", "EmptyDone"],
  ["Trash", "EmptyBlocked"],
  ["Trash", "Contained"],
  ["Trash", "KeptForDays"],
  ["Common", "MinutesAgo"],
  ["Common", "HoursAgo"],
  ["Common", "DaysAgo"],
  ["Common", "WeeksAgo"],
  ["Common", "MonthsAgo"],
  ["Common", "YearsAgo"],
] as const

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()

describe("count strings outside flashcards", () => {
  it.each(LANGUAGES)("fills both halves of every pair in %s, reading the count in each", (language) => {
    const bundle = mergedBundle(language)
    for (const [ns, base] of PAIRS) {
      const one = bundle[ns]?.[`${base}One`]
      const many = bundle[ns]?.[`${base}Many`]
      expect(one, `${language} ${ns}.${base}One`).toBeTypeOf("string")
      expect(many, `${language} ${ns}.${base}Many`).toBeTypeOf("string")
      expect(placeholders(one!), `${language} ${ns}.${base}`).toEqual(placeholders(many!))
      expect(placeholders(one!), `${language} ${ns}.${base}`).toContain("count")
    }
  })

  it("reads a count of one in the singular in English", () => {
    const t = createTranslate(mergedBundle("en"))
    const one = (ns: string, base: string, params?: Record<string, string | number>) =>
      tPlural(t, ns, { one: `${base}One`, many: `${base}Many` }, 1, params, "en")

    expect(one("Notes", "WordCount")).toBe("1 word")
    expect(one("WidgetActivity", "ReviewsTotal")).toBe("1 review")
    expect(one("WidgetStreak", "ReviewsOnDay", { 1: "May 3" })).toBe("1 review on May 3")
    expect(one("WidgetDeck", "CaughtUp")).toBe("Caught up · 1 card")
    expect(one("Settings", "HiddenSettings")).toBe("1 setting hidden, turn on to configure.")
    expect(one("Trash", "EmptyDone")).toBe("Deleted 1 item for good")
    expect(pluralKey({ one: "WordCountOne", many: "WordCountMany" }, 0, "en")).toBe("WordCountMany")
  })

  it.each(LANGUAGES)("leaves no copy of the old word count key in %s", (language) => {
    expect(mergedBundle(language).Notes?.WordCountFormat).toBeUndefined()
    const shared = JSON.parse(
      readFileSync(repoFile("Mnemo.Infrastructure", "Languages", `${language}.json`), "utf8"),
    ) as Bundle
    expect(shared.Notes?.WordCountFormat).toBeUndefined()
  })

  it("reads a trash count of one in the singular in English", () => {
    const t = createTranslate(mergedBundle("en"))
    expect(tPlural(t, "Trash", { one: "ContainedOne", many: "ContainedMany" }, 1, undefined, "en")).toBe("1 item inside")
    expect(tPlural(t, "Trash", { one: "KeptForDaysOne", many: "KeptForDaysMany" }, 1, undefined, "en")).toBe(
      "Kept for 1 day, then deleted for good.",
    )
  })
})
