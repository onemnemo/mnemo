/**
 * The header's time-of-day greeting, ported from OverviewViewModel.GreetingText.
 *
 * Two rules that are easy to approximate wrongly. The hour buckets are on *local* time, unlike
 * every statistics window in this module, which are all UTC. And a missing display name selects a
 * different translation key rather than interpolating an empty one: "Good evening," with nothing
 * after the comma reads as a bug in English and is ungrammatical in several of the shipped
 * languages, so each greeting ships as a pair.
 */

import type { TranslateFn } from "@/i18n/types"

export type GreetingKey = "GreetingMorning" | "GreetingAfternoon" | "GreetingEvening"

/**
 * The greeting for an hour of the local day. Morning is 05:00-11:59 and afternoon 12:00-17:59;
 * evening takes everything else, which is one span wrapping midnight rather than two rules.
 */
export function greetingKeyForHour(hour: number): GreetingKey {
  if (hour >= 5 && hour < 12) return "GreetingMorning"
  if (hour >= 12 && hour < 18) return "GreetingAfternoon"
  return "GreetingEvening"
}

/**
 * The rendered greeting.
 *
 * `userName` is the User.DisplayName setting. A blank or whitespace-only one is treated as absent,
 * matching the desktop, so a name of spaces does not produce a greeting addressed to nobody.
 */
export function greetingText(now: Date, userName: string, t: TranslateFn): string {
  const key = greetingKeyForHour(now.getHours())
  const name = userName.trim()
  return name === "" ? t("Overview", `${key}Short`) : t("Overview", key, { 0: name })
}
