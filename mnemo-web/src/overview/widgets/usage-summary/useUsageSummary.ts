import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { StatRecordDto, WidgetInstanceDto } from "@/api/types"

import { statDailyKey, statRecordKey, useStatDaily, useStatRecord } from "../../api"
import { settingInt, settingString } from "../../config/encode"
import { useDayStartHour } from "../../data/useDayStartHour"
import { readInt, studyDayWindow } from "../../stats"
import type { WidgetManifest } from "../manifest"

const APP = "app"
const NOTES = "notes"
const FLASHCARDS = "flashcards"
const TOTALS = "totals"
const DAILY = "daily.summary"

export interface UsageSummaryData {
  state: "loading" | "error" | "ready"
  /** Suffixed onto the four period-scoped labels; the two lifetime rows never carry it. */
  periodDays: number
  /** The headline counts cards when true and screen time when false. */
  reviewMetric: boolean
  cardsReviewed: number
  launches: number
  notesCreated: number
  practiceSeconds: number
  notesEditorSeconds: number
  flashcardsSeconds: number
  retry: () => void
}

function sum(records: StatRecordDto[] | undefined, field: string): number {
  let total = 0
  for (const record of records ?? []) total += readInt(record.fields, field)
  return total
}

/**
 * Two lifetime counters and three per-area timers over a configurable window.
 *
 * The windowed reads are day-range queries. The desktop asks for the 120 most recently written
 * daily records and filters them by parsed day key, which is exact only while nothing rewrites an
 * old day's record and while fewer than 120 newer ones exist. At a 90-day period that leaves 30
 * records of slack, and the failure is silent: the widget simply reports less time than the user
 * spent.
 */
export function useUsageSummary(instance: WidgetInstanceDto, manifest: WidgetManifest): UsageSummaryData {
  const periodDays = Math.max(1, settingInt(manifest, instance.settings, "period_days"))
  const reviewMetric = settingString(manifest, instance.settings, "metric") !== "time_spent"

  const { from, to } = studyDayWindow(periodDays, new Date(), useDayStartHour())

  const appTotals = useStatRecord(APP, TOTALS, "all")
  const notesTotals = useStatRecord(NOTES, TOTALS, "all")
  const appDaily = useStatDaily(APP, DAILY, from, to)
  // Only the card headline needs the flashcard window, and a disabled query never resolves, so it
  // is kept out of the loading rule below rather than being allowed to hold the widget pending.
  const flashcardDaily = useStatDaily(FLASHCARDS, DAILY, from, to, reviewMetric)

  const client = useQueryClient()
  const retry = useCallback(() => {
    void client.invalidateQueries({ queryKey: statRecordKey(APP, TOTALS, "all") })
    void client.invalidateQueries({ queryKey: statRecordKey(NOTES, TOTALS, "all") })
    void client.invalidateQueries({ queryKey: statDailyKey(APP, DAILY, from, to) })
    void client.invalidateQueries({ queryKey: statDailyKey(FLASHCARDS, DAILY, from, to) })
  }, [client, from, to])

  const failed = appTotals.isError || notesTotals.isError || appDaily.isError || (reviewMetric && flashcardDaily.isError)
  const pending =
    appTotals.isPending || notesTotals.isPending || appDaily.isPending || (reviewMetric && flashcardDaily.isPending)

  return {
    state: failed ? "error" : pending ? "loading" : "ready",
    periodDays,
    reviewMetric,
    cardsReviewed: sum(flashcardDaily.data, "cards_reviewed"),
    launches: readInt(appTotals.data?.fields, "app_launch_count"),
    notesCreated: readInt(notesTotals.data?.fields, "total_notes_created"),
    practiceSeconds: sum(appDaily.data, "practice_seconds"),
    notesEditorSeconds: sum(appDaily.data, "notes_editor_seconds"),
    flashcardsSeconds: sum(appDaily.data, "flashcards_module_seconds"),
    retry,
  }
}
