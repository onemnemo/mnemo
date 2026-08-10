import { EMOJI_CATEGORIES, RECENT_CATEGORY, type EmojiCategoryId } from "./categories"

/**
 * Reorders the category rail around what the user is naming.
 *
 * Opening the picker on a deck called "Emergency Care" and landing on Smileys
 * wastes the one piece of context we have. Matching the deck's own words against
 * these hints floats the likely categories to the front instead. It only ever
 * reorders: every category stays reachable, so a wrong guess costs a glance.
 */

/**
 * Words that suggest a category, matched whole. Deliberately not exhaustive and
 * deliberately English-led, since a miss just leaves the default order.
 */
const CATEGORY_HINTS: Partial<Record<EmojiCategoryId, readonly string[]>> = {
  study: ["study", "studies", "exam", "exams", "revision", "course", "school", "class", "lecture", "homework", "test"],
  science: [
    "science", "physics", "chemistry", "chemical", "biology", "astronomy", "geology", "ecology",
    "genetics", "lab", "molecule", "organic",
  ],
  medicine: [
    "medicine", "medical", "anatomy", "anatomical", "cardiology", "neurology", "pharmacology",
    "pathology", "radiology", "nursing", "clinical", "health", "surgery", "dental", "emergency", "care",
  ],
  languages: [
    "language", "languages", "vocabulary", "vocab", "grammar", "linguistics", "english", "spanish",
    "french", "german", "italian", "japanese", "chinese", "korean", "latin", "norsk", "tysk", "kanji",
  ],
  engineering: [
    "engineering", "engineer", "mechanics", "mechanical", "electronics", "electrical", "robotics",
    "architecture", "circuit", "programming", "software", "computing",
  ],
  nature: ["nature", "animal", "animals", "plant", "plants", "botany", "zoology", "food", "cooking"],
}

/**
 * The categories `context` suggests, strongest first. Returns an empty list when
 * nothing matches, which leaves the rail in its declared order.
 */
export function preferredCategories(context: string): readonly EmojiCategoryId[] {
  const words = new Set(context.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  if (words.size === 0) return []

  const scored: { category: EmojiCategoryId; hits: number }[] = []

  for (const category of EMOJI_CATEGORIES) {
    let hits = 0
    for (const hint of CATEGORY_HINTS[category] ?? []) {
      if (words.has(hint)) hits += 1
    }
    if (hits > 0) scored.push({ category, hits })
  }

  // Ties keep declared order, so a deck matching both Science and Medicine once
  // each still reads in the rail's usual sequence.
  scored.sort((a, b) => b.hits - a.hits)

  return scored.map((hit) => hit.category)
}

/**
 * The rail's order for a given context: preferred categories first, the rest
 * untouched behind them. Recent stays pinned to the front whatever the context
 * suggests, since a list of what you just picked is never less relevant than a
 * guess made from a name.
 */
export function orderCategories(
  context: string,
  available: readonly EmojiCategoryId[] = EMOJI_CATEGORIES,
): readonly EmojiCategoryId[] {
  const preferred = preferredCategories(context).filter(
    (category) => category !== RECENT_CATEGORY && available.includes(category),
  )
  if (preferred.length === 0) return available

  const lead = new Set<EmojiCategoryId>(preferred)
  const rest = available.filter((category) => category !== RECENT_CATEGORY && !lead.has(category))

  return available.includes(RECENT_CATEGORY)
    ? [RECENT_CATEGORY, ...preferred, ...rest]
    : [...preferred, ...rest]
}
