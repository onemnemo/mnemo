import { describe, expect, it } from "vitest"

import { summarizeStreak } from "./streak"

/** Oldest first, as the activity window is. `1` means the day was studied. */
const days = (pattern: number[]) =>
  pattern.map((reviews, index) => ({ day: `d${index}`, reviews, minutes: 0, sessions: 0 }))

describe("summarizeStreak", () => {
  it("counts the run ending today", () => {
    expect(summarizeStreak(days([0, 1, 1, 1])).current).toBe(3)
  })

  it("keeps a streak alive on a day that has not been studied yet", () => {
    // 08:00 with nothing done: the three days behind today are still three days in a row, and
    // reporting 0 here is what makes the counter useless every morning.
    expect(summarizeStreak(days([1, 1, 1, 0])).current).toBe(3)
  })

  it("ends the streak once a whole day has gone by unstudied", () => {
    expect(summarizeStreak(days([1, 1, 1, 0, 0])).current).toBe(0)
  })

  it("reports the longest run anywhere in the window, not just the current one", () => {
    expect(summarizeStreak(days([1, 1, 1, 1, 0, 1, 1])).best).toBe(4)
  })

  it("reports whether today itself has been studied", () => {
    expect(summarizeStreak(days([1, 0])).studiedToday).toBe(false)
    expect(summarizeStreak(days([0, 1])).studiedToday).toBe(true)
  })

  it("handles a window with nothing in it", () => {
    expect(summarizeStreak([])).toEqual({ current: 0, best: 0, studiedToday: false })
    expect(summarizeStreak(days([0, 0, 0]))).toEqual({ current: 0, best: 0, studiedToday: false })
  })

  it("counts a window that is studied end to end", () => {
    expect(summarizeStreak(days([1, 1, 1, 1]))).toEqual({ current: 4, best: 4, studiedToday: true })
  })
})
