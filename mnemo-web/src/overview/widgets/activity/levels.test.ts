import { describe, expect, it } from "vitest"

import { LEVELS, levelFor, toWeeks } from "./levels"

const day = (key: string, reviews = 0) => ({ day: key, reviews, minutes: 0, sessions: 0 })

describe("levelFor", () => {
  it("puts an unstudied day on the empty rung", () => {
    expect(levelFor(0, 100)).toBe(0)
  })

  it("puts any studied day above the empty rung, however quiet", () => {
    // One review out of a hundred must not paint the same square as no reviews at all: the whole
    // point of the ramp is telling a light day from a missed one.
    expect(levelFor(1, 100)).toBe(1)
  })

  it("spreads the studied days across the four filled rungs", () => {
    expect(levelFor(100, 100)).toBe(LEVELS.length - 1)
    expect(levelFor(60, 100)).toBe(3)
    expect(levelFor(30, 100)).toBe(2)
    expect(levelFor(10, 100)).toBe(1)
  })

  it("treats an empty window as all-quiet rather than dividing by its peak", () => {
    expect(levelFor(5, 0)).toBe(0)
  })
})

describe("toWeeks", () => {
  it("pads the first column so a row always means one weekday", () => {
    // 2026-08-06 is a Thursday, so four leading blanks put it on the fifth row.
    const weeks = toWeeks([day("2026-08-06"), day("2026-08-07")])

    expect(weeks[0].slice(0, 4)).toEqual([null, null, null, null])
    expect(weeks[0][4]?.day).toBe("2026-08-06")
  })

  it("starts a new column every seven days", () => {
    const days = Array.from({ length: 21 }, (_, i) => day(`2026-08-${String(2 + i).padStart(2, "0")}`))

    // 2026-08-02 is a Sunday, so there is no pad and the weeks divide evenly.
    expect(toWeeks(days)).toHaveLength(3)
  })

  it("returns nothing for an empty window rather than one empty column", () => {
    expect(toWeeks([])).toEqual([])
  })
})
