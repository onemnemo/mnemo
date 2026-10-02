import { describe, expect, it } from "vitest"

import { sparkRuns } from "./spark"

describe("sparkRuns", () => {
  it("draws one line through an unbroken trend", () => {
    expect(sparkRuns([0, 50, 100])).toEqual(["0,100 50,50 100,0"])
  })

  it("leaves a gap for a day without data rather than dropping to the floor", () => {
    expect(sparkRuns([50, 100, null, 50, 100])).toEqual(["0,100 25,0", "75,100 100,0"])
  })

  it("draws a lone point between gaps as a dot", () => {
    expect(sparkRuns([0, null, 100, null, 0])).toEqual(["0,100 0,100", "50,0 50,0", "100,100 100,100"])
  })

  it("draws nothing with fewer than two real values", () => {
    expect(sparkRuns([null, 40, null])).toEqual([])
  })
})
