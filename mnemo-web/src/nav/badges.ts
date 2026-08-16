import { useAggregateDueQuery } from "@/flashcards/api"

/**
 * `due` is the one count in a study app worth spending the accent colour on;
 * everything else is a quantity, and a quantity reads like a folder count.
 */
export interface NavBadge {
  value: number
  tone: "quiet" | "due"
}

/**
 * Badges by route.
 *
 * Client-side rather than a field on the nav model: the rail's structure is
 * fetched once and does not change, while these numbers move every time a card is
 * graded. Folding them into the nav payload would mean refetching the whole
 * sidebar to update a number.
 */
export function useNavBadges(): Record<string, NavBadge> {
  const due = useAggregateDueQuery()

  const total = due.data?.total ?? 0
  // A zero badge renders nothing, so an empty queue reads as finished rather than
  // as a zero someone forgot to hide.
  return total > 0 ? { flashcards: { value: total, tone: "due" } } : {}
}
