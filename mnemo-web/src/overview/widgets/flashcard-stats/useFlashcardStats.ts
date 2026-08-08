import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { statRecordKey, useStatRecord } from "../../api"
import { readInt, utcDayKey } from "../../stats"

const NS = "flashcards"
const TOTALS = "totals"
const DAILY = "daily.summary"

export interface FlashcardStatsData {
  state: "loading" | "error" | "ready"
  cardsToday: number
  minutesToday: number
  sessionsToday: number
  streak: number
  retry: () => void
}

/**
 * Today's practice counters and the current streak.
 *
 * Two separate records, not one: the three "today" numbers come from the day's summary, while the
 * streak is a lifetime counter that happens to be rendered beside them. Reading them as one row
 * would mean inventing a record that does not exist.
 */
export function useFlashcardStats(): FlashcardStatsData {
  // The day key is derived on render rather than pinned at mount, so a board left open across UTC
  // midnight moves to the new day's record instead of showing yesterday's counters indefinitely.
  const today = utcDayKey(new Date())

  const totals = useStatRecord(NS, TOTALS, "all")
  const daily = useStatRecord(NS, DAILY, today)

  const client = useQueryClient()
  const retry = useCallback(() => {
    void client.invalidateQueries({ queryKey: statRecordKey(NS, TOTALS, "all") })
    void client.invalidateQueries({ queryKey: statRecordKey(NS, DAILY, today) })
  }, [client, today])

  // Either read failing makes the whole widget an error. Rendering the half that arrived would put
  // a real streak next to three zeroes that only mean "this did not load", which is exactly the
  // ambiguity the error state exists to remove.
  const state = totals.isError || daily.isError ? "error" : totals.isPending || daily.isPending ? "loading" : "ready"

  return {
    state,
    // A record that has never been written is not a failure; it is a day nobody studied, and the
    // desktop renders the same zeroes for it.
    cardsToday: readInt(daily.data?.fields, "cards_reviewed"),
    minutesToday: readInt(daily.data?.fields, "minutes_studied"),
    sessionsToday: readInt(daily.data?.fields, "sessions_completed"),
    streak: readInt(totals.data?.fields, "current_streak_days"),
    retry,
  }
}
