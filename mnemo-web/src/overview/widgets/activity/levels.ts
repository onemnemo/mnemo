import type { ActivityDay } from "../../data/useDailyActivity"

/**
 * The ink ramp, quietest first. Deliberately monochrome: every heatmap in every study app is
 * green, and green here would be a fourth colour language on a board that already speaks new,
 * learning and due. The ramp carries intensity perfectly well.
 */
export const LEVELS = ["bg-canvas-sunken", "bg-ink-3/25", "bg-ink-3/45", "bg-ink-3/70", "bg-ink-2"] as const

/** Which rung of {@link LEVELS} a day sits on, given the busiest day in the window. */
export function levelFor(reviews: number, peak: number): number {
  if (reviews <= 0 || peak <= 0) return 0
  // 3.999 rather than 4 so only a day equal to the peak reaches the top rung.
  return Math.min(4, 1 + Math.floor((reviews / peak) * 3.999))
}

/** The weekday of a UTC day key, 0 for Sunday. Read in UTC, since the keys are UTC days. */
function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay()
}

/**
 * The window as Sunday-first columns, oldest on the left, with a null pad on the first column.
 *
 * The pad is what makes the rows mean anything: without it every column starts on whatever weekday
 * the window happens to begin on, and row three stops being "Tuesdays".
 */
export function toWeeks(days: readonly ActivityDay[]): (ActivityDay | null)[][] {
  if (days.length === 0) return []

  const padded: (ActivityDay | null)[] = [...new Array<null>(weekdayOf(days[0].day)).fill(null), ...days]
  const weeks: (ActivityDay | null)[][] = []
  for (let index = 0; index < padded.length; index += 7) weeks.push(padded.slice(index, index + 7))
  return weeks
}
