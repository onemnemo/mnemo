import { describe, expect, it } from "vitest"

import type { OptimizeWeightsDto } from "@/api/types"

import { readOutcome, relativeGain, sameWeights } from "./optimizer"

function result(patch: Partial<OptimizeWeightsDto> = {}): OptimizeWeightsDto {
  return {
    status: "fitted",
    currentWeights: [0.2, 1.3, 2.3],
    weights: [0.3, 1.4, 2.5],
    reviewsAvailable: 4200,
    reviewsUsed: 3900,
    reviewsScored: 3100,
    minimumReviews: 400,
    lossBefore: 0.5,
    lossAfter: 0.4,
    ...patch,
  }
}

describe("relativeGain", () => {
  it("reads the share of the score the fit removes", () => {
    expect(relativeGain(0.5, 0.4)).toBeCloseTo(0.2)
  })

  it("finds no gain in scores that could not be measured", () => {
    expect(relativeGain(null, null)).toBe(0)
    expect(relativeGain(Number.NaN, 0.4)).toBe(0)
    expect(relativeGain(0, 0)).toBe(0)
  })

  it("carries a fit that made the score worse through as a negative, which clears no bar", () => {
    expect(relativeGain(0.4, 0.5)).toBeLessThan(0)
  })
})

describe("sameWeights", () => {
  it("matches vectors slot for slot", () => {
    expect(sameWeights([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(sameWeights([1, 2, 3], [1, 2, 4])).toBe(false)
  })

  it("does not call a shorter vector equal to the start of a longer one", () => {
    expect(sameWeights([1, 2], [1, 2, 3])).toBe(false)
  })
})

describe("readOutcome", () => {
  it("asks for more history when the fit had too little", () => {
    const outcome = readOutcome(
      result({ status: "not-enough-reviews", reviewsScored: 120, lossBefore: null, lossAfter: null }),
    )

    expect(outcome).toEqual({ kind: "not-enough-reviews", scored: 120, minimum: 400 })
  })

  it("offers a fit that predicts this collection measurably better", () => {
    expect(readOutcome(result())).toEqual({ kind: "improved", gainPercent: 20 })
  })

  it("rounds the gain to a tenth, because the digit after it is noise", () => {
    expect(readOutcome(result({ lossBefore: 0.5, lossAfter: 0.46789 }))).toEqual({
      kind: "improved",
      gainPercent: 6.4,
    })
  })

  it("declines to offer a fit that only moved the score a hair", () => {
    expect(readOutcome(result({ lossBefore: 0.5, lossAfter: 0.4999 }))).toEqual({ kind: "already-tuned" })
  })

  // Every due date on every deck bound to the preset moves when a vector is applied, so a result
  // identical to what is running has to read as nothing to do.
  it("declines to offer the vector the preset already runs", () => {
    expect(readOutcome(result({ weights: [0.2, 1.3, 2.3] }))).toEqual({ kind: "already-tuned" })
  })

  it("declines to offer a fit whose scores never arrived", () => {
    expect(readOutcome(result({ lossBefore: null, lossAfter: null }))).toEqual({ kind: "already-tuned" })
  })
})
