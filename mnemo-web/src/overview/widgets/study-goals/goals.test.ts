import { describe, expect, it } from "vitest"

import { buildStudyGoals } from "./goals"

const NOTHING = { cards: 0, sessions: 0, minutes: 0 }
const DAILY = { weekly: false, minutesFirst: false }

describe("buildStudyGoals", () => {
  it("uses the daily targets for a daily window", () => {
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
})
