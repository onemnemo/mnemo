import type { TranslateFn } from "@/i18n/types"

import type { TrashEntryDto } from "./types"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How much longer an entry can be recovered ("6 days left").
 *
 * Read from the entry rather than from a retention constant here: the host owns how long
 * something is kept, and a number written into the web app would go stale the day that setting
 * moves. Anything already past its date reads as going shortly rather than as a negative count,
 * because the sweep runs on its own schedule and the row can outlive its own deadline by minutes.
 *
 * Days round up, hours round down. A row deleted a second ago has a few milliseconds under the
 * full retention left, and reading "29 days left" beside a toast that promised 30 makes the app
 * look like it is already counting one down. Hours are the ordinary countdown, where saying more
 * time is left than there is would be the lie instead.
 */
export function formatExpiresIn(expiresAt: string, now: number, t: TranslateFn): string {
  const value = new Date(expiresAt).getTime()
  if (Number.isNaN(value)) return ""

  const left = value - now
  if (left < HOUR) return t("Trash", "ExpiresSoon")
  if (left < DAY) return count(t, Math.floor(left / HOUR), "ExpiresHour", "ExpiresHours")
  return count(t, Math.ceil(left / DAY), "ExpiresDay", "ExpiresDays")
}

/**
 * How long this entry gets, in whole days, for the sentence an undo toast puts under its title.
 *
 * Rounded rather than floored: the span is written by the server as a date arithmetic on the
 * instant of the delete, so a 30 day retention comes back a few milliseconds short of 30 days.
 */
export function retentionDays(entry: TrashEntryDto): number {
  const from = new Date(entry.deletedAt).getTime()
  const until = new Date(entry.expiresAt).getTime()
  if (Number.isNaN(from) || Number.isNaN(until)) return 0
  return Math.max(1, Math.round((until - from) / DAY))
}

function count(t: TranslateFn, value: number, singular: string, plural: string): string {
  return t("Trash", value === 1 ? singular : plural, { 0: value })
}
