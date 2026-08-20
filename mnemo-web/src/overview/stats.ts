/**
 * Reading statistics field values, the way the desktop widgets read them.
 *
 * Every widget that touches a stat record has its own private ReadInt in the Avalonia app, and all
 * of them are the same three lines: check the type tag, read on a match, otherwise zero. That rule
 * belongs in one place, because the part that matters is the guard, and a widget that skips it
 * turns a decimal-typed field into a crash rather than a zero.
 */

import type { StatValueDto } from "@/api/types"

/**
 * An integer field, or 0 when it is missing or stored as something other than an integer.
 *
 * A wrong type reading as zero is not this function inventing a policy; it is what the desktop
 * does, and both apps show the same number off the same row because of it.
 */
export function readInt(fields: Record<string, StatValueDto> | undefined, key: string): number {
  const value = fields?.[key]
  if (value?.type !== "integer") return 0

  // The wire carries integers as strings so a count past 2^53 survives the trip. Number() gives
  // that back its precision loss, which is the accepted cost of rendering it: nothing here counts
  // past a few million, and every alternative makes the value unformattable.
  const parsed = Number(value.value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * An instant field as epoch milliseconds, or undefined when it is missing or stored as another
 * type. Same guard-then-read rule as {@link readInt}, and the caller decides what absent means.
 *
 * The wire value always carries a UTC offset, because the store holds a DateTimeOffset and
 * round-trip formats one with its offset attached. An offsetless timestamp would parse as local
 * time here and silently shift the value by the reader's own zone.
 */
export function readDateTime(fields: Record<string, StatValueDto> | undefined, key: string): number | undefined {
  const value = fields?.[key]
  if (value?.type !== "dateTime") return undefined

  const parsed = Date.parse(value.value)
  return Number.isNaN(parsed) ? undefined : parsed
}

/**
 * The rollover hour to assume until the host has said what it is. It is the seeded default, so a
 * first paint that guesses reads the right row for almost every profile, and the wrong one only
 * for the few hours a changed setting moves.
 */
export const DEFAULT_DAY_START_HOUR = 4

/**
 * The day key of a day-keyed statistics record: a local day that ends at the rollover hour, not a
 * UTC one.
 *
 * The host writes these keys against the collection's own boundary, the same one the study screen
 * caps against, so a session that runs past midnight is one day rather than two. Deriving the key
 * from the UTC date instead reads the wrong row for part of every evening west of Greenwich.
 */
export function studyDayKey(instant: Date, dayStartHour: number): string {
  // Wall clock arithmetic, matching the host: step the local time of day back to the hour the day
  // began and read off the date that lands on. The subtraction happens on a UTC-anchored copy of
  // the local fields, so a daylight saving jump between here and there cannot move the answer.
  const shifted = Date.UTC(
    instant.getFullYear(),
    instant.getMonth(),
    instant.getDate(),
    instant.getHours() - clampDayStartHour(dayStartHour),
    instant.getMinutes(),
  )
  return new Date(shifted).toISOString().slice(0, 10)
}

/**
 * The inclusive day-key range a widget's "last N days" window covers.
 *
 * N counts today plus the previous N-1 days, which is what the desktop's loops produce: they read
 * offsets 0 through N-1 back from today. Asking for `today - N` instead pulls one extra day and
 * inflates every windowed total by a day's worth of activity, silently and permanently.
 */
export function studyDayWindow(days: number, now: Date, dayStartHour: number): { from: string; to: string } {
  // A stored setting can hold anything, and a window of zero days would ask the endpoint for a
  // range that ends before it starts. The desktop floors it at one for the same reason.
  const span = Math.max(1, Math.trunc(days))
  const to = studyDayKey(now, dayStartHour)

  return { from: dayKeyBefore(to, span - 1), to }
}

/** The key `daysBack` days earlier than one already computed. Pure date arithmetic, no zone in it. */
export function dayKeyBefore(dayKey: string, daysBack: number): string {
  const day = new Date(`${dayKey}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - daysBack)
  return day.toISOString().slice(0, 10)
}

/** The hour clamped to something a day can actually start at, matching the host's own clamp. */
function clampDayStartHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_DAY_START_HOUR
  return Math.min(23, Math.max(0, Math.trunc(hour)))
}
