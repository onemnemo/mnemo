/**
 * The weighted-retention arithmetic, separated from the fetching that feeds it.
 *
 * Two decks with wildly different review volumes cannot count equally: a deck reviewed twice at
 * 100% would otherwise drag the headline as hard as one reviewed four hundred times at 80%. So
 * each deck's retention is weighted by how much of it was actually reviewed in the window, which
 * makes the number "how well do you remember what you have been studying" rather than an average
 * of averages.
 */

export interface DeckRetention {
  deckId: string
  name: string
  /** The deck's true retention over the window, already a whole percentage. */
  retentionPercent: number
  /** Reviews in the window. Both the weight and the tie-break for the trend line. */
  volume: number
}

export interface WeightedRetention {
  /** The headline, a whole percentage. */
  retentionPercent: number
  /** The deck the sparkline is drawn for: the one reviewed most in the window. */
  busiest: DeckRetention
}

/**
 * The volume-weighted mean across every deck with at least one review, or null when there is no
 * such deck. Null is the widget's empty state, not a failure.
 */
export function weightedRetention(decks: readonly DeckRetention[]): WeightedRetention | null {
  // A deck nobody reviewed in the window contributes nothing to either the mean or the pick, and
  // including it would divide by a weight of zero.
  const reviewed = decks.filter((deck) => deck.volume > 0)
  if (reviewed.length === 0) return null

  let totalVolume = 0
  let weightedSum = 0
  let busiest = reviewed[0]

  for (const deck of reviewed) {
    totalVolume += deck.volume
    weightedSum += deck.retentionPercent * deck.volume
    // Strictly greater, so a tie keeps the earlier deck. The desktop's descending sort is stable
    // and picks the same one.
    if (deck.volume > busiest.volume) busiest = deck
  }

  // Retention is never negative, so rounding half up is rounding half away from zero, which is
  // what the desktop asks for explicitly.
  return { retentionPercent: Math.round(weightedSum / totalVolume), busiest }
}
