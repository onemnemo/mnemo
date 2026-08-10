import { EMOJI_ALIASES } from "./aliases"
import {
  CURATED_CATEGORIES,
  EMOJI_CATEGORIES,
  RECENT_CATEGORY,
  UNICODE_GROUP_CATEGORY,
  type EmojiCategoryId,
} from "./categories"
import type { EmojiEntry, EmojiIndex } from "./types"

/**
 * Turns the shipped emoji data into the index the picker reads.
 *
 * The two datasets are the only place emoji facts come from, so updating the
 * packages updates the picker without anything here or in the UI changing. What
 * this module adds on top is Mnemo's grouping and search vocabulary.
 *
 * Loaded on demand: the data is around 1900 entries across two files, which is
 * not worth carrying in the initial bundle for a picker most sessions never open.
 */

interface RawEmoji {
  readonly name: string
  readonly group: string
}

let pending: Promise<EmojiIndex> | undefined

/** Builds the index once and hands the same one to every later caller. */
export function loadEmojiIndex(): Promise<EmojiIndex> {
  pending ??= Promise.all([
    import("unicode-emoji-json/data-by-emoji.json"),
    import("unicode-emoji-json/data-ordered-emoji.json"),
    import("emojilib"),
  ]).then(([byEmoji, ordered, lib]) =>
    buildEmojiIndex(
      (byEmoji.default ?? byEmoji) as unknown as Record<string, RawEmoji>,
      (ordered.default ?? ordered) as unknown as string[],
      (lib.default ?? lib) as unknown as Record<string, string[]>,
    ),
  )

  return pending
}

/**
 * Assembles the index from raw data. Exported separately from the loader so it can
 * be driven with fixtures rather than the real 1900-entry files.
 */
export function buildEmojiIndex(
  byEmoji: Record<string, RawEmoji>,
  ordered: readonly string[],
  keywordsByEmoji: Record<string, readonly string[]>,
): EmojiIndex {
  const curatedOf = invertCurated()
  const aliasesOf = invertAliases()

  const all: EmojiEntry[] = []
  const byChar = new Map<string, EmojiEntry>()

  for (const char of ordered) {
    const raw = byEmoji[char]
    // An emoji present in the order file but not the data file would be a broken
    // release; skip rather than publish an entry with no name to search.
    if (!raw) continue

    const categories = new Set<EmojiCategoryId>(curatedOf.get(char))
    const group = UNICODE_GROUP_CATEGORY[raw.group]
    if (group) categories.add(group)
    // Nothing may land in Recent, which is filled from what the user picks.
    categories.delete(RECENT_CATEGORY)

    const entry: EmojiEntry = {
      char,
      name: raw.name,
      keywords: mergeKeywords(raw.name, keywordsByEmoji[char], aliasesOf.get(char)),
      categories: [...categories],
    }

    all.push(entry)
    byChar.set(char, entry)
  }

  return { all, byCategory: groupByCategory(all), byChar }
}

/** Lowercased, deduped, and with the name included so a name-only match still works. */
function mergeKeywords(
  name: string,
  datasetKeywords: readonly string[] | undefined,
  aliases: readonly string[] | undefined,
): readonly string[] {
  const seen = new Set<string>()

  for (const term of [name, ...(datasetKeywords ?? []), ...(aliases ?? [])]) {
    const value = term.trim().toLowerCase()
    if (value) seen.add(value)
  }

  return [...seen]
}

function invertCurated(): Map<string, EmojiCategoryId[]> {
  const result = new Map<string, EmojiCategoryId[]>()

  for (const [category, chars] of Object.entries(CURATED_CATEGORIES)) {
    for (const char of chars ?? []) {
      const existing = result.get(char)
      if (existing) existing.push(category as EmojiCategoryId)
      else result.set(char, [category as EmojiCategoryId])
    }
  }

  return result
}

function invertAliases(): Map<string, string[]> {
  const result = new Map<string, string[]>()

  for (const [term, chars] of Object.entries(EMOJI_ALIASES)) {
    for (const char of chars) {
      const existing = result.get(char)
      if (existing) existing.push(term)
      else result.set(char, [term])
    }
  }

  return result
}

/** Curated order first, then the rest in Unicode order, so the hand-picked sets lead. */
function groupByCategory(all: readonly EmojiEntry[]): Map<EmojiCategoryId, EmojiEntry[]> {
  const byChar = new Map(all.map((entry) => [entry.char, entry]))
  const result = new Map<EmojiCategoryId, EmojiEntry[]>()

  for (const category of EMOJI_CATEGORIES) {
    const curated = CURATED_CATEGORIES[category] ?? []
    const members: EmojiEntry[] = []
    const taken = new Set<string>()

    for (const char of curated) {
      const entry = byChar.get(char)
      if (entry && !taken.has(char)) {
        members.push(entry)
        taken.add(char)
      }
    }

    for (const entry of all) {
      if (!taken.has(entry.char) && entry.categories.includes(category)) members.push(entry)
    }

    result.set(category, members)
  }

  return result
}
