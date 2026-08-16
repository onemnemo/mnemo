/** Test's own self-check grade, deliberately unrelated to the FSRS review grades. */
export type TestGrade = "missed" | "close" | "gotIt"

/** How many of each grade the reader has given so far. */
export interface TestTally {
  gotIt: number
  close: number
  missed: number
}

export const EMPTY_TALLY: TestTally = { gotIt: 0, close: 0, missed: 0 }

export function tested(tally: TestTally): number {
  return tally.gotIt + tally.close + tally.missed
}

/** Applies one grade to the tally, or takes it back again with a delta of -1. */
export function applyTally(tally: TestTally, grade: TestGrade, delta: number): TestTally {
  return { ...tally, [grade]: Math.max(0, tally[grade] + delta) }
}

/**
 * The live score. A Close counts half. The server derives the score it stores from the same
 * formula, so this is only what the screen shows while the test is still running.
 */
export function scorePct(tally: TestTally): number {
  const total = tested(tally)
  if (total <= 0) return 0
  return ((tally.gotIt + tally.close * 0.5) / total) * 100
}

/** Percentages round away from zero, matching how the stored score is formatted. */
export function roundPercent(pct: number): number {
  return Math.sign(pct) * Math.round(Math.abs(pct))
}

/**
 * Picks the "better / worse / same / first time" line. The delta is rounded before it is judged,
 * so a change too small to show as a whole percent reads as the same score rather than as a
 * better one with a +0 in it.
 */
export function deltaMessage(delta: number | null): { key: string; amount: number } {
  if (delta === null) return { key: "TestDeltaFirst", amount: 0 }
  const rounded = roundPercent(delta)
  if (rounded > 0) return { key: "TestDeltaBetter", amount: rounded }
  if (rounded < 0) return { key: "TestDeltaWorse", amount: Math.abs(rounded) }
  return { key: "TestDeltaSame", amount: 0 }
}
