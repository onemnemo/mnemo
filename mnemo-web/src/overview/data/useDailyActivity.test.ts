import { describe, expect, it } from "vitest"

import type { StatRecordDto } from "@/api/types"

import { fillActivityWindow } from "./useDailyActivity"

const record = (key: string, reviews: number, minutes = 0, sessions = 0) =>
  ({
    key,
    fields: {
      cards_reviewed: { type: "integer", value: String(reviews) },
      minutes_studied: { type: "integer", value: String(minutes) },
      sessions_completed: { type: "integer", value: String(sessions) },
    },
  }) as unknown as StatRecordDto

// Built from local parts, not parsed from a UTC string: a study day is a local day, so the
// expectations have to mean the same thing whatever zone the suite runs in.
const NOW = new Date(2026, 7, 10, 9, 30)
const HOUR = 4

describe("fillActivityWindow", () => {
  it("returns one entry per day, oldest first, ending today", () => {
    const days = fillActivityWindow([], 5, NOW, HOUR)

    expect(days.map((day) => day.day)).toEqual(["2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"])
  })

  it("zero-fills the days the store has no row for", () => {
    const days = fillActivityWindow([record("2026-08-09", 41, 7, 2)], 3, NOW, HOUR)

    expect(days.map((day) => day.reviews)).toEqual([0, 41, 0])
    expect(days[1]).toEqual({ day: "2026-08-09", reviews: 41, minutes: 7, sessions: 2 })
  })

  it("ignores rows outside the window rather than shifting them into it", () => {
    const days = fillActivityWindow([record("2026-07-01", 99)], 3, NOW, HOUR)

    expect(days.every((day) => day.reviews === 0)).toBe(true)
  })

  it("counts today as the first day of the window, not an extra one", () => {
    // A window of N covers today plus the previous N-1 days. Asking for `today - N` instead pulls
    // one extra day and inflates every windowed total by a day's worth of activity.
    expect(fillActivityWindow([], 1, NOW, HOUR).map((day) => day.day)).toEqual(["2026-08-10"])
  })

  it("ends the window on the study day, so the small hours still read the evening's row", () => {
    const beforeRollover = new Date(2026, 7, 10, 2, 30)

    expect(fillActivityWindow([], 1, beforeRollover, HOUR).map((day) => day.day)).toEqual(["2026-08-09"])
  })

  it("floors a nonsensical window at one day rather than returning nothing", () => {
    expect(fillActivityWindow([], 0, NOW, HOUR)).toHaveLength(1)
  })

  it("reads a field stored as the wrong type as zero", () => {
    const wrongType = {
      key: "2026-08-10",
      fields: { cards_reviewed: { type: "decimal", value: "12.5" } },
    } as unknown as StatRecordDto

    expect(fillActivityWindow([wrongType], 1, NOW, HOUR)[0].reviews).toBe(0)
  })
})
