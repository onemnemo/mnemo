import type { TranslateFn } from "@/i18n/types"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Relative wording for a timestamp ("3 days ago"), following the desktop's
 * DateDisplayService thresholds so both apps break at the same boundaries.
 *
 * It diverges on one point the desktop gets wrong: a count of one takes a singular
 * key, so a card studied yesterday reads "1 day ago" rather than "1 days ago".
 *
 * A future timestamp clamps to "just now" rather than counting backwards - clock
 * skew between writes should not produce "in 2 minutes" on a last-studied label.
 */
export function formatRelative(timestamp: string | Date, now: number, t: TranslateFn): string {
  const value = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime()
  const diff = Math.max(0, now - value)

  if (diff < MINUTE) return t("Common", "JustNow")
  if (diff < HOUR) return countAgo(t, Math.floor(diff / MINUTE), "MinuteAgo", "MinutesAgo")
  if (diff < DAY) return countAgo(t, Math.floor(diff / HOUR), "HourAgo", "HoursAgo")

  const days = Math.floor(diff / DAY)
  if (days < 7) return countAgo(t, days, "DayAgo", "DaysAgo")
  if (days < 30) return countAgo(t, Math.floor(days / 7), "WeekAgo", "WeeksAgo")
  if (days < 365) return countAgo(t, Math.floor(days / 30), "MonthAgo", "MonthsAgo")
  return countAgo(t, Math.floor(days / 365), "YearAgo", "YearsAgo")
}

/** One takes the singular key, everything else the plural; both carry the count. */
function countAgo(t: TranslateFn, count: number, singular: string, plural: string): string {
  return t("Common", count === 1 ? singular : plural, { 0: count })
}

const WEEK = 7 * DAY

/**
 * Relative wording under a week, and a plain short date beyond it.
 *
 * Mirrors DateDisplayService.FormatSmart, which is a different function from FormatRelative and is
 * what both list widgets call. FormatRelative on its own keeps counting into weeks, months and
 * years, so using it here would render "3 weeks ago" on a row the desktop writes as 12/07/2026.
 *
 * `toLocaleDateString` with no options is the closest web equivalent of .NET's "d" short-date
 * pattern. It is not glyph-identical in every culture, which is accepted rather than chased.
 *
 * Note the asymmetry, which is the desktop's: the cutoff is measured against the instant, while
 * the date it falls back to is rendered in local time. A timestamp can therefore cross into
 * absolute wording while the date shown still reads as the previous day.
 */
export function formatSmart(timestamp: string | Date, now: number, t: TranslateFn, locale: string): string {
  const value = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime()
  if (Number.isNaN(value)) return ""
  return now - value < WEEK ? formatRelative(timestamp, now, t) : new Date(value).toLocaleDateString(locale)
}

/**
 * A date written the way the language writes dates, minus the year ("Thursday, July 3").
 *
 * Not the same algorithm as the desktop's DateDisplayService.FormatDayHeading, which takes the
 * culture's long-date pattern and deletes the year specifier along with whatever separators became
 * redundant. Intl has no equivalent of reading that pattern back, so this asks for the three fields
 * that survive instead and lets Intl order and punctuate them. The results agree for Latin-script
 * locales; they can differ in how a locale that writes an era or a trailing particle handles losing
 * the year, which is accepted rather than chased.
 *
 * An invalid date renders empty rather than "Invalid Date": this is decorative header text and a
 * blank line is a better failure than a visible one.
 */
export function formatDayHeading(date: Date, locale: string): string {
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(date)
}
