// @vitest-environment jsdom

/**
 * Checks that recovery clears the remembered route and replaces the current history entry.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { readLastRoute, resetToOverview } from "./router"

beforeEach(() => {
  localStorage.clear()
  window.location.hash = "#/notes/abc"
})

afterEach(() => {
  localStorage.clear()
  window.location.hash = ""
})

describe("resetToOverview", () => {
  it("clears the remembered route and points the hash at the overview", () => {
    localStorage.setItem("mnemo.last-route", "#/notes/abc")

    resetToOverview()

    expect(readLastRoute()).toBeNull()
    expect(window.location.hash).toBe("#/overview")
  })

  it("replaces the crashed entry instead of leaving it one step back", () => {
    const entries = window.history.length

    resetToOverview()

    expect(window.location.hash).toBe("#/overview")
    // Replacing history prevents Back from reopening the crashed route.
    expect(window.history.length).toBe(entries)
  })

  it("still lands on the overview when nothing was remembered", () => {
    resetToOverview()

    expect(readLastRoute()).toBeNull()
    expect(window.location.hash).toBe("#/overview")
  })
})
