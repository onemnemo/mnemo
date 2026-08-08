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
 * The day key of a day-keyed statistics record: a UTC calendar day, never a local one.
 *
 * The desktop writes and reads these in UTC, so a user studying late in the evening sees today's
 * counters reset at UTC midnight rather than at their own. Deriving the key from the local date
 * instead would read the wrong row for part of every day in most of the world.
 */
export function utcDayKey(instant: Date): string {
  return instant.toISOString().slice(0, 10)
}
