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
 * The day key of a day-keyed statistics record: a UTC calendar day, never a local one.
 *
 * The desktop writes and reads these in UTC, so a user studying late in the evening sees today's
 * counters reset at UTC midnight rather than at their own. Deriving the key from the local date
 * instead would read the wrong row for part of every day in most of the world.
 */
export function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}

/**
 * The inclusive day-key range a widget's "last N days" window covers.
 *
 * N counts today plus the previous N-1 days, which is what the desktop's loops produce: they read
 * offsets 0 through N-1 back from today. Asking for `today - N` instead pulls one extra day and
 * inflates every windowed total by a day's worth of activity, silently and permanently.
 */
export function utcDayWindow(days: number, now: Date): { from: string; to: string } {
  // A stored setting can hold anything, and a window of zero days would ask the endpoint for a
  // range that ends before it starts. The desktop floors it at one for the same reason.
  const span = Math.max(1, Math.trunc(days))

  const start = new Date(now)
  start.setUTCDate(start.getUTCDate() - (span - 1))

  return { from: utcDayKey(start), to: utcDayKey(now) }
}
