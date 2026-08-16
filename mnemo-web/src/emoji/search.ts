import type { EmojiEntry, EmojiIndex } from "./types"

/**
 * Ranked lookup over names, dataset keywords and Mnemo's aliases.
 *
 * Ranking matters more than it looks: "art" matches "heart", "cart" and "artist"
 * as a substring, so a plain contains-filter buries 🎨 under a dozen unrelated
 * faces. Whole-word and prefix hits are therefore scored above substrings, and
 * ties keep dataset order, which puts the familiar emoji of a group first.
 */

const SCORE = {
  nameExact: 100,
  keywordExact: 80,
  namePrefix: 60,
  keywordPrefix: 40,
  substring: 10,
} as const

/** Caps the grid at a size that stays scrollable; matches beyond this are noise anyway. */
export const SEARCH_LIMIT = 180

export function searchEmoji(index: EmojiIndex, query: string, limit = SEARCH_LIMIT): readonly EmojiEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const scored: { entry: EmojiEntry; score: number; order: number }[] = []

  index.all.forEach((entry, order) => {
    const score = scoreEntry(entry, needle)
    if (score > 0) scored.push({ entry, score, order })
  })

  scored.sort((a, b) => b.score - a.score || a.order - b.order)

  return scored.slice(0, limit).map((hit) => hit.entry)
}

function scoreEntry(entry: EmojiEntry, needle: string): number {
  // Typing the emoji itself, which happens when pasting one in to find its name.
  if (entry.char === needle) return SCORE.nameExact

  let best = 0

  if (entry.name === needle) return SCORE.nameExact
  if (startsWithWord(entry.name, needle)) best = SCORE.namePrefix

  for (const keyword of entry.keywords) {
    if (keyword === needle) return SCORE.keywordExact
    if (startsWithWord(keyword, needle)) best = Math.max(best, SCORE.keywordPrefix)
    else if (keyword.includes(needle)) best = Math.max(best, SCORE.substring)
  }

  return best
}

/** True when any word of the haystack begins with the needle, not just the first. */
function startsWithWord(haystack: string, needle: string): boolean {
  if (haystack.startsWith(needle)) return true

  let from = haystack.indexOf(" ")
  while (from !== -1) {
    if (haystack.startsWith(needle, from + 1)) return true
    from = haystack.indexOf(" ", from + 1)
  }

  return false
}
