/**
 * The two value formats the usage rows use.
 *
 * Both are the desktop's, wording included: the strings come out of the same translation
 * namespace, so the only thing that could make the two apps disagree about the same number is the
 * arithmetic, and that lives here where it can be tested.
 */

import type { TranslateFn } from "@/i18n/types"

const NS = "UsageSummary"

const MINUTE = 60
const HOUR = 3600

/** A count with the locale's own grouping, so 12345 reads as a number rather than as a serial. */
export function formatCount(value: number, locale: string): string {
  return value.toLocaleString(locale)
}

/**
 * A duration, at the coarsest unit that still says something: seconds under a minute, whole
 * minutes under an hour, then hours with the leftover minutes only when there are any.
 *
 * Zero is the bare "0" rather than "0s", which is what the desktop renders and reads better in a
 * column of times: a row nobody has touched should not look like it was touched for no time.
 */
export function formatDuration(seconds: number, t: TranslateFn): string {
  if (seconds <= 0) return "0"
  if (seconds < MINUTE) return t(NS, "DurationSeconds", { 0: seconds })
  if (seconds < HOUR) return t(NS, "DurationMinutes", { 0: Math.floor(seconds / MINUTE) })

  const hours = Math.floor(seconds / HOUR)
  const minutes = Math.floor((seconds % HOUR) / MINUTE)

  return minutes > 0
    ? t(NS, "DurationHoursMinutes", { 0: hours, 1: minutes })
    : t(NS, "DurationHours", { 0: hours })
}
