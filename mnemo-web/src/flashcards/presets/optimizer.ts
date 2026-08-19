import type { OptimizeWeightsDto } from "@/api/types"

/**
 * The smallest share of the prediction score a fit has to remove before it is offered.
 *
 * Applying a vector moves every future due date on every deck bound to the preset, so a result
 * that is a thousandth better than what is already running is not worth that: it is the search
 * settling, not a better model of this collection.
 */
export const MIN_MEANINGFUL_GAIN = 0.001

/**
 * What a finished fit amounts to, in the terms the row talks about. The scores themselves stay
 * out of it: "0.4712 became 0.4610" tells a reader nothing they can act on.
 */
export type OptimizerOutcome =
  | { kind: "not-enough-reviews"; scored: number; minimum: number }
  | { kind: "already-tuned" }
  | { kind: "improved"; gainPercent: number }

/** How much of the current score the fitted vector removes, as a fraction of it. */
export function relativeGain(before: number | null, after: number | null): number {
  if (before === null || after === null) return 0
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return 0
  return (before - after) / before
}

/** Whether two vectors would schedule identically. Lengths differ across FSRS revisions. */
export function sameWeights(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

export function readOutcome(result: OptimizeWeightsDto): OptimizerOutcome {
  if (result.status !== "fitted") {
    return { kind: "not-enough-reviews", scored: result.reviewsScored, minimum: result.minimumReviews }
  }

  const gain = relativeGain(result.lossBefore, result.lossAfter)
  if (gain < MIN_MEANINGFUL_GAIN || sameWeights(result.currentWeights, result.weights)) {
    return { kind: "already-tuned" }
  }

  // One decimal, because the second one moves between runs as new reviews come in and reading it
  // as a precise figure would be reading noise.
  return { kind: "improved", gainPercent: Math.round(gain * 1000) / 10 }
}
