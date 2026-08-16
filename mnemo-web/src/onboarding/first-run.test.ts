import { describe, expect, it } from "vitest"

import { ONBOARDING_COMPLETED_KEY, needsOnboarding } from "./first-run"

const loaded = { loaded: true, failed: false }

describe("the first-run decision", () => {
  it("runs setup on a fresh install", () => {
    expect(needsOnboarding({ ...loaded, values: {} })).toBe(true)
  })

  it("never runs it again once it has been completed", () => {
    expect(needsOnboarding({ ...loaded, values: { [ONBOARDING_COMPLETED_KEY]: true } })).toBe(false)
  })

  it("runs it while the flag is explicitly false, which is what a reset writes", () => {
    expect(needsOnboarding({ ...loaded, values: { [ONBOARDING_COMPLETED_KEY]: false } })).toBe(true)
  })

  it("waits for the snapshot rather than flashing setup over a loading app", () => {
    expect(needsOnboarding({ loaded: false, failed: false, values: {} })).toBe(false)
  })

  it("stays out of the way when the snapshot could not be read", () => {
    // The values are empty because the read failed, not because nothing is stored, so
    // treating that as a fresh install would walk an existing user through setup again.
    expect(needsOnboarding({ loaded: true, failed: true, values: {} })).toBe(false)
  })

  it("does not accept a truthy value as completion", () => {
    // The key is registered as a boolean. A string there means something wrote a shape
    // nothing agreed on, and guessing at it is how setup silently stops appearing.
    expect(needsOnboarding({ ...loaded, values: { [ONBOARDING_COMPLETED_KEY]: "true" } })).toBe(true)
  })
})
