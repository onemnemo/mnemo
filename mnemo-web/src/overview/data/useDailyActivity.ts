/**
 * Study effort day by day, off the analytics store's flashcard daily summaries.
 *
 * Three widgets need the same rows over different windows (the streak counts back from today, the
 * heatmap draws a year, the goals widget sums one day), so the read lives here rather than three
 * times over. The store's rows are sparse, because nothing writes a summary for a day nobody
 * studied, and every one of those widgets wants a dense series: a heatmap with holes in it is not
 * a heatmap, and a streak walked over a sparse array counts gaps as studied days.
 */

import { useCallback, useMemo } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { StatRecordDto } from "@/api/types"

import { statDailyKey, useStatDaily } from "../api"
import { dayKeyBefore, readInt, studyDayKey, studyDayWindow } from "../stats"
import { useDayStartHour } from "./useDayStartHour"

const NS = "flashcards"
const DAILY = "daily.summary"

/**
 * The window the heatmap and the streak both read.
 *
 * Fifty-two weeks is not a round number picked for tidiness, it is what the heatmap's shape asks
 * for: seven rows of squares in a tile whose content area is roughly eight to one works out at
 * about fifty columns. Sharing it with the streak is deliberate. Both widgets then hit one query
 * key, so a board carrying the pair costs a single request.
 */
export const HISTORY_DAYS = 364

/** One study day of effort. `reviews` is cards graded; `minutes` is time spent. */
export interface ActivityDay {
  /** The study day key, `yyyy-MM-dd`. */
  day: string
  reviews: number
  minutes: number
  sessions: number
}

export interface DailyActivityData {
  state: "loading" | "error" | "ready"
  /** Exactly `days` entries, oldest first, zero-filled. The last entry is always today. */
  days: ActivityDay[]
  retry: () => void
}

const EMPTY_DAY = (day: string): ActivityDay => ({ day, reviews: 0, minutes: 0, sessions: 0 })

/**
 * Fills the window from the sparse rows the store returned.
 *
 * Split out and pure so the fill can be tested without a fetch: this is the part with an
 * off-by-one in it, and the endpoint's range is inclusive at both ends.
 */
export function fillActivityWindow(
  records: readonly Pick<StatRecordDto, "key" | "fields">[],
  days: number,
  now: Date,
  dayStartHour: number,
): ActivityDay[] {
  const byDay = new Map<string, ActivityDay>()
  for (const record of records) {
    byDay.set(record.key, {
      day: record.key,
      reviews: readInt(record.fields, "cards_reviewed"),
      minutes: readInt(record.fields, "minutes_studied"),
      sessions: readInt(record.fields, "sessions_completed"),
    })
  }

  const span = Math.max(1, Math.trunc(days))
  const today = studyDayKey(now, dayStartHour)
  const filled: ActivityDay[] = []
  for (let offset = span - 1; offset >= 0; offset--) {
    const key = dayKeyBefore(today, offset)
    filled.push(byDay.get(key) ?? EMPTY_DAY(key))
  }
  return filled
}

/**
 * The last `days` study days of effort, oldest first and always exactly that many entries.
 *
 * The window is derived on render rather than pinned at mount, so a board left open across the
 * rollover hour moves to the new window instead of reporting yesterday's until the page is
 * reloaded.
 */
export function useDailyActivity(days: number): DailyActivityData {
  const dayStartHour = useDayStartHour()
  const { from, to } = studyDayWindow(days, new Date(), dayStartHour)
  const daily = useStatDaily(NS, DAILY, from, to)

  const client = useQueryClient()
  const retry = useCallback(
    () => void client.invalidateQueries({ queryKey: statDailyKey(NS, DAILY, from, to) }),
    [client, from, to],
  )

  const records = daily.data
  const filled = useMemo(
    () => (records === undefined ? [] : fillActivityWindow(records, days, new Date(), dayStartHour)),
    [records, days, dayStartHour],
  )

  return {
    // No empty state: a window nobody studied is a row of zeroes, which every one of these widgets
    // draws honestly. Only a read that actually failed looks like anything else.
    state: daily.isError ? "error" : daily.isPending ? "loading" : "ready",
    days: filled,
    retry,
  }
}
