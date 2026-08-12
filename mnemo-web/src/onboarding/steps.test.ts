import { describe, expect, it } from "vitest"

import {
  canJumpTo,
  isQuestion,
  nextStep,
  ORDER,
  previousStep,
  QUESTIONS,
  questionIndex,
  type OnboardingStep,
} from "./steps"

describe("onboarding step order", () => {
  it("runs from the welcome screen to the closing one", () => {
    expect(ORDER).toEqual(["welcome", "you", "look", "lang", "done"])
  })

  it("walks the whole flow forwards and back again", () => {
    const forwards: OnboardingStep[] = ["welcome"]
    for (;;) {
      const next = nextStep(forwards[forwards.length - 1]!)
      if (next === null) break
      forwards.push(next)
    }
    expect(forwards).toEqual([...ORDER])

    const backwards: OnboardingStep[] = ["done"]
    for (;;) {
      const back = previousStep(backwards[backwards.length - 1]!)
      if (back === null) break
      backwards.push(back)
    }
    expect(backwards).toEqual([...ORDER].reverse())
  })

  it("ends the flow rather than wrapping around", () => {
    expect(nextStep("done")).toBeNull()
    expect(previousStep("welcome")).toBeNull()
  })

  it("counts only the steps that ask something as questions", () => {
    expect(QUESTIONS).toEqual(["you", "look", "lang"])
    expect(ORDER.filter(isQuestion)).toEqual([...QUESTIONS])
    expect(isQuestion("welcome")).toBe(false)
    expect(isQuestion("done")).toBe(false)
  })

  it("gives the bookends no progress dot", () => {
    expect(questionIndex("welcome")).toBe(-1)
    expect(questionIndex("done")).toBe(-1)
    expect(questionIndex("you")).toBe(0)
    expect(questionIndex("lang")).toBe(2)
  })
})

describe("progress dot navigation", () => {
  it("goes backwards", () => {
    expect(canJumpTo("you", "lang")).toBe(true)
    expect(canJumpTo("look", "lang")).toBe(true)
  })

  it("never goes forwards, which would skip a question without saying so", () => {
    expect(canJumpTo("lang", "you")).toBe(false)
    expect(canJumpTo("look", "you")).toBe(false)
  })

  it("does nothing on the step already showing", () => {
    for (const question of QUESTIONS) expect(canJumpTo(question, question)).toBe(false)
  })

  it("is inert on the bookends, which have no dots to press", () => {
    expect(canJumpTo("you", "welcome")).toBe(false)
    expect(canJumpTo("you", "done")).toBe(false)
    expect(canJumpTo("done", "lang")).toBe(false)
  })
})
