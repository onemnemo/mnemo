import type { EmojiCategoryId } from "./categories"

/** One emoji as the picker uses it: the character plus everything it can be found by. */
export interface EmojiEntry {
  /** The Unicode value, which is also what gets stored. */
  readonly char: string
  /** Dataset name, e.g. "anatomical heart". */
  readonly name: string
  /** Dataset keywords merged with Mnemo's own aliases, lowercased and deduped. */
  readonly keywords: readonly string[]
  /** Every category this emoji belongs to. An emoji can sit in more than one. */
  readonly categories: readonly EmojiCategoryId[]
}

/** The built dataset: an ordered list plus the lookups the picker reads. */
export interface EmojiIndex {
  /** Unicode order, which is roughly "most familiar first" within a group. */
  readonly all: readonly EmojiEntry[]
  readonly byCategory: ReadonlyMap<EmojiCategoryId, readonly EmojiEntry[]>
  readonly byChar: ReadonlyMap<string, EmojiEntry>
}
