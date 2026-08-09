import type { ToastType } from "@/stores/toast"

/**
 * Each kind gets a mark you can recognise before you read the row, tinted with
 * colours the app already uses for those meanings, so this introduces no new
 * vocabulary and just reuses it one level up.
 *
 * The inverted mark (`solid` on `solid-fg`) is deliberately unused here. It is
 * reserved for Soma, whose hue is the same 40 degrees as the brand and as the
 * due state: an accent-washed Soma row and a due row would be indistinguishable
 * in dark mode, so Soma speaks in the app's own ink instead, and nothing else in
 * the list is allowed to look like it.
 */
export const NOTIFICATION_MARK: Record<ToastType, { icon: string; fg: string; bg: string }> = {
  info: { icon: "info", fg: "text-ink-2", bg: "bg-frame-active" },
  // Blue rather than green: the palette has no green, and adding one for a
  // single mark would cost more than it says.
  success: { icon: "circle-check", fg: "text-state-new", bg: "bg-state-new-wash" },
  warning: { icon: "triangle-alert", fg: "text-state-learn", bg: "bg-state-learn-wash" },
  action: { icon: "circle-alert", fg: "text-danger", bg: "bg-danger-wash" },
  task: { icon: "layers", fg: "text-state-due", bg: "bg-state-due-wash" },
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type Bucket = "today" | "yesterday" | "earlier"

/**
 * Three buckets, because "2 days ago" and "3 weeks ago" both mean "not now",
 * and a fourth heading would only ever hold one row.
 */
export function bucketOf(createdAt: number, now: number): Bucket {
  const age = now - createdAt
  if (age < DAY) return "today"
  if (age < 2 * DAY) return "yesterday"
  return "earlier"
}

/** Short relative age: "now", "5m", "3h", "2d". Unitless past a day, on purpose. */
export function agoLabel(createdAt: number, now: number, justNow: string): string {
  const age = Math.max(0, now - createdAt)
  if (age < MINUTE) return justNow
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`
  if (age < DAY) return `${Math.round(age / HOUR)}h`
  return `${Math.round(age / DAY)}d`
}
