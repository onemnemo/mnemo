import type { CardStateFilter, CardType } from "@/api/types"

/**
 * The deck table's filter vocabulary.
 *
 * State is a strip of chips because it is the one you reach for constantly, and a
 * chip shows whether it is on without being opened. Type and lapses sit behind a
 * menu: they are used occasionally, and as chips they would crowd out the strip
 * that matters.
 */

export const STATE_FILTERS: readonly CardStateFilter[] = [
  "all",
  "due",
  "new",
  "learning",
  "suspended",
  "flagged",
]

export const CARD_TYPES: readonly CardType[] = ["classic", "cloze"]

/**
 * How many times a card has been forgotten after it was learned.
 *
 * Spelled out rather than borrowing Anki's "leech": the word means nothing to
 * anyone who has not already met it, and the whole point of the filter is to be
 * findable by someone who has just noticed they keep failing the same card.
 */
export type LapsesFilter = "any" | "once-or-more" | "three-or-more" | "never"

export const LAPSES_FILTERS: readonly LapsesFilter[] = ["once-or-more", "three-or-more", "never"]

/** Inclusive bounds for the query. Never forgotten is a maximum of zero, not a minimum. */
export function lapsesBounds(filter: LapsesFilter): { min: number | null; max: number | null } {
  switch (filter) {
    case "once-or-more":
      return { min: 1, max: null }
    case "three-or-more":
      return { min: 3, max: null }
    case "never":
      return { min: null, max: 0 }
    default:
      return { min: null, max: null }
  }
}

/** Translation keys, kept beside the values so a new option cannot forget its label. */
export const STATE_FILTER_KEY: Record<CardStateFilter, string> = {
  all: "StateFilterAll",
  due: "StateFilterDue",
  "new": "StateFilterNew",
  learning: "StateFilterLearning",
  suspended: "StateFilterSuspended",
  flagged: "StateFilterFlagged",
}

export const CARD_TYPE_KEY: Record<CardType, string> = {
  classic: "CardTypeClassic",
  cloze: "CardTypeCloze",
}

export const LAPSES_FILTER_KEY: Record<LapsesFilter, string> = {
  any: "LapsesFilterAny",
  "once-or-more": "LapsesFilterOnceOrMore",
  "three-or-more": "LapsesFilterThreeOrMore",
  never: "LapsesFilterNever",
}
