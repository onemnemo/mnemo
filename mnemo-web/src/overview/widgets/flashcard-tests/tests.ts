/**
 * Picking the deck the widget reports on, and reading its score movement.
 *
 * Pure, and separate from the fetching, because both rules are easy to get subtly wrong: the pick
 * is "most recently tested" rather than "best" or "most tested", and the movement has to keep
 * "there is nothing to compare against" apart from "exactly the same as last time".
 */

import type { TestSummaryDto } from "@/api/types"

export type ScoreTrend = "up" | "down" | "none"

export interface DeckTestSummary {
  deckId: string
  name: string
  summary: TestSummaryDto
}

export interface ScoreMovement {
  trend: ScoreTrend
  /** How far it moved, always positive. Zero when there is nothing to report. */
  deltaPercent: number
}

/**
 * Rounds the way the desktop asks for explicitly: a half goes away from zero in both directions,
 * where JavaScript's own rounding sends -0.5 up to -0 and turns a small drop into no change.
 */
export function roundAwayFromZero(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value))
}

/**
 * The most recently tested deck, or null when nothing in the library has a completed attempt.
 *
 * Recency, not score: the widget is reporting on what the user just did. A tie keeps the earlier
 * deck, which is the comparison the desktop's loop makes.
 */
export function latestTestedDeck(decks: readonly DeckTestSummary[]): DeckTestSummary | null {
  let best: DeckTestSummary | null = null
  let bestAt = 0

  for (const deck of decks) {
    const latest = deck.summary.latest
    if (!deck.summary.hasAttempts || latest === null) continue

    const completedAt = Date.parse(latest.completedAt)
    if (Number.isNaN(completedAt)) continue

    if (best === null || completedAt > bestAt) {
      best = deck
      bestAt = completedAt
    }
  }

  return best
}

/**
 * Which way the latest score moved against the one before it.
 *
 * A null delta means this is the deck's first attempt, and it reads as no movement rather than as
 * no change: there is nothing it could have changed from. A delta that rounds to zero reads the
 * same way, because "up 0%" is not a thing worth drawing an arrow for.
 */
export function scoreMovement(delta: number | null): ScoreMovement {
  if (delta === null) return { trend: "none", deltaPercent: 0 }

  const rounded = roundAwayFromZero(delta)
  if (rounded === 0) return { trend: "none", deltaPercent: 0 }

  return { trend: rounded > 0 ? "up" : "down", deltaPercent: Math.abs(rounded) }
}
