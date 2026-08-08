import type { TranslateFn } from "@/i18n/types"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Relative wording for a timestamp ("3 days ago"), mirroring the desktop's
 * DateDisplayService: the same thresholds and the same Common-namespace keys, so
 * both apps read identically in every language.
 *
 * A future timestamp clamps to "just now" rather than counting backwards - clock
 * skew between writes should not produce "in 2 minutes" on a last-studied label.
 */
export function formatRelative(timestamp: string | Date, now: number, t: TranslateFn): string {
  const value = typeof timestamp === "string" ? new Date(timestamp).getTime() : timestamp.getTime()
  const diff = Math.max(0, now - value)

  if (diff < MINUTE) return t("Common", "JustNow")
  if (diff < HOUR) return t("Common", "MinutesAgo", { 0: Math.floor(diff / MINUTE) })
  if (diff < DAY) return t("Common", "HoursAgo", { 0: Math.floor(diff / HOUR) })

  const days = Math.floor(diff / DAY)
  if (days < 7) return t("Common", "DaysAgo", { 0: days })
  if (days < 30) return t("Common", "WeeksAgo", { 0: Math.floor(days / 7) })
  if (days < 365) return t("Common", "MonthsAgo", { 0: Math.floor(days / 30) })
  return t("Common", "YearsAgo", { 0: Math.floor(days / 365) })
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
