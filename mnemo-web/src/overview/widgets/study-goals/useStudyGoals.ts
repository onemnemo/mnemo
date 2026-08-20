import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"

import type { WidgetInstanceDto } from "@/api/types"

import { statDailyKey, useStatDaily } from "../../api"
import { settingString } from "../../config/encode"
import { useDayStartHour } from "../../data/useDayStartHour"
import { readInt, studyDayWindow } from "../../stats"
import type { WidgetManifest } from "../manifest"
import { buildStudyGoals, WEEK_DAYS, type StudyGoal } from "./goals"

const NS = "flashcards"
const DAILY = "daily.summary"

export interface StudyGoalsData {
  state: "loading" | "error" | "ready"
  goals: StudyGoal[]
  retry: () => void
}

/**
 * Practice against the daily or weekly targets.
 *
 * One day-range read where the desktop issues a separate record read per day in the window. Same
 * rows, same sums: the range is inclusive at both ends and days nobody studied were never written,
 * so summing what came back is summing the same records the loop would have found.
 */
export function useStudyGoals(instance: WidgetInstanceDto, manifest: WidgetManifest): StudyGoalsData {
  const weekly = settingString(manifest, instance.settings, "goal_type") === "weekly"
  const minutesFirst = settingString(manifest, instance.settings, "metric") === "minutes"

  // Derived on render rather than pinned at mount, so a board left open across the rollover hour
  // moves to the new window instead of reporting yesterday's for as long as the page stays up.
  const { from, to } = studyDayWindow(weekly ? WEEK_DAYS : 1, new Date(), useDayStartHour())
  const daily = useStatDaily(NS, DAILY, from, to)

  const client = useQueryClient()
  const retry = useCallback(
    () => void client.invalidateQueries({ queryKey: statDailyKey(NS, DAILY, from, to) }),
    [client, from, to],
  )

  const totals = { cards: 0, sessions: 0, minutes: 0 }
  for (const record of daily.data ?? []) {
    totals.cards += readInt(record.fields, "cards_reviewed")
    totals.sessions += readInt(record.fields, "sessions_completed")
    totals.minutes += readInt(record.fields, "minutes_studied")
  }

  return {
    // No empty state: a window nobody studied is three bars at zero, which is the whole point of a
    // goal widget. Only a read that failed is allowed to look like anything else.
    state: daily.isError ? "error" : daily.isPending ? "loading" : "ready",
    goals: buildStudyGoals(totals, { weekly, minutesFirst }),
    retry,
  }
}
