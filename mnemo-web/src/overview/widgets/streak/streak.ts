import type { ActivityDay } from "../../data/useDailyActivity"

export interface StreakSummary {
  /** Days studied in a row, ending today or yesterday. */
  current: number
  /** The longest run anywhere in the window. */
  best: number
  /** True once today itself has a review on it. */
  studiedToday: boolean
}

/**
 * The current and best runs in a window of days, oldest first.
 *
 * A streak that has not been extended *today* is still alive here, and ends only once a whole day
 * goes by unstudied. The alternative, breaking the moment today reads zero, means every streak in
 * the app reads 0 from midnight until the user opens a deck, which is precisely when they are
 * being asked whether it is worth keeping.
 */
export function summarizeStreak(days: readonly ActivityDay[]): StreakSummary {
  let best = 0
  let run = 0
  for (const day of days) {
    run = day.reviews > 0 ? run + 1 : 0
    if (run > best) best = run
  }

  const studiedToday = (days.at(-1)?.reviews ?? 0) > 0
  // Today is skipped rather than counted as a break when it is still empty; the run then describes
  // the days behind it, which are the days that have actually finished.
  let index = studiedToday ? days.length - 1 : days.length - 2
  let current = 0
  for (; index >= 0; index--) {
    if (days[index].reviews === 0) break
    current++
  }

  return { current, best, studiedToday }
}
