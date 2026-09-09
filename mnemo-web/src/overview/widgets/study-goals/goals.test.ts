import { describe, expect, it } from "vitest"

import { buildStudyGoals } from "./goals"

const NOTHING = { cards: 0, sessions: 0, minutes: 0 }
const TARGETS = { cards: 50, sessions: 3, minutes: 30 }
const DAILY = { weekly: false, minutesFirst: false, targets: TARGETS }

describe("buildStudyGoals", () => {
  it("uses the given targets for a daily window", () => {
    const goals = buildStudyGoals(NOTHING, DAILY)

    expect(goals.map((goal) => [goal.titleKey, goal.target])).toEqual([
      ["CardsReviewed", 50],
      ["SessionsCompleted", 3],
      ["MinutesStudied", 30],
    ])
  })

  it("multiplies every target by the week for a weekly window", () => {
    const goals = buildStudyGoals(NOTHING, { ...DAILY, weekly: true })

    expect(goals.map((goal) => goal.target)).toEqual([350, 21, 210])
  })

  it("leads with the configured metric", () => {
    const goals = buildStudyGoals(NOTHING, { ...DAILY, minutesFirst: true })

    expect(goals.map((goal) => goal.titleKey)).toEqual(["MinutesStudied", "CardsReviewed", "SessionsCompleted"])
  })

  it("fills the bar in proportion to the target", () => {
    const goals = buildStudyGoals({ cards: 25, sessions: 3, minutes: 0 }, DAILY)

    expect(goals.map((goal) => goal.percent)).toEqual([50, 100, 0])
  })

  it("caps the bar at the target but reports what the user actually did", () => {
    // The desktop caps both, so a 400-card week reads "350/350" and beating the target looks
    // identical to meeting it. Only the geometry needs the cap.
    const goals = buildStudyGoals({ cards: 400, sessions: 0, minutes: 0 }, { ...DAILY, weekly: true })

    expect(goals[0]).toMatchObject({ completed: 400, target: 350, percent: 100 })
  })

  it("follows a target the person set, weekly scale included", () => {
    const targets = { cards: 300, sessions: 1, minutes: 90 }
    const daily = buildStudyGoals({ cards: 150, sessions: 0, minutes: 0 }, { ...DAILY, targets })
    const weekly = buildStudyGoals(NOTHING, { ...DAILY, weekly: true, targets })

    expect(daily.map((goal) => goal.target)).toEqual([300, 1, 90])
    expect(daily[0].percent).toBe(50)
    expect(weekly.map((goal) => goal.target)).toEqual([2100, 7, 630])
  })

  it("never divides by a target below one, whatever the settings bag holds", () => {
    const targets = { cards: 0, sessions: -4, minutes: Number.NaN }
    const goals = buildStudyGoals({ cards: 2, sessions: 0, minutes: 0 }, { ...DAILY, targets })

    expect(goals.map((goal) => goal.target)).toEqual([1, 1, 1])
    expect(goals[0].percent).toBe(100)
  })

  it("rounds a fractional target to the whole number the bar is drawn against", () => {
    const goals = buildStudyGoals(NOTHING, { ...DAILY, targets: { cards: 49.6, sessions: 2.2, minutes: 30 } })

    expect(goals.map((goal) => goal.target)).toEqual([50, 2, 30])
  })
})
