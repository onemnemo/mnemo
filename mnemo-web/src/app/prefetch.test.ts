// @vitest-environment jsdom

/**
 * Which routes a launch warms, and when it warms nothing.
 *
 * The warm-up is invisible when it works and invisible when it does not, so the only thing
 * standing between "we prefetch the resumed route" and "we prefetch nothing, silently" is
 * this file. The scheduler is injected rather than waited on: what matters is which routes
 * get asked for, not how long the browser sat idle first.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { startRoutePrefetch } from "./prefetch"

// Stubbed rather than spied on: the real one starts dynamic imports, and a suite that
// pulls ten page modules into jsdom is measuring something other than the warm-up.
// DEFAULT_ROUTE comes along because the router reads it from the same module.
const warmRoute = vi.hoisted(() => vi.fn())
vi.mock("@/app/routes", () => ({ warmRoute, DEFAULT_ROUTE: "overview" }))

/** Runs the warm-up on demand, standing in for the browser's idle period. */
function manualSchedule() {
  let pending: (() => void) | undefined
  const schedule = (run: () => void) => {
    pending = run
    return () => {
      pending = undefined
    }
  }
  return {
    schedule,
    /** Fires the scheduled warm-up, as an idle period would. */
    idle(): void {
      pending?.()
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  warmRoute.mockClear()
})

afterEach(() => {
  localStorage.clear()
})

describe("startRoutePrefetch", () => {
  it("warms the route the window would resume on", () => {
    localStorage.setItem("mnemo.last-route", "#/flashcard-deck/d1")
    const timer = manualSchedule()

    startRoutePrefetch(timer.schedule)
    timer.idle()

    expect(warmRoute).toHaveBeenCalledWith("#/flashcard-deck/d1")
  })

  it("warms notes as well when a note is waiting to be reopened", () => {
    localStorage.setItem("mnemo.last-route", "#/overview")
    localStorage.setItem("mnemo.notes.last-note", "n1")
    const timer = manualSchedule()

    startRoutePrefetch(timer.schedule)
    timer.idle()

    expect(warmRoute).toHaveBeenCalledWith("#/overview")
    expect(warmRoute).toHaveBeenCalledWith("#/notes")
  })

  it("leaves notes alone when no note is remembered", () => {
    localStorage.setItem("mnemo.last-route", "#/overview")
    const timer = manualSchedule()

    startRoutePrefetch(timer.schedule)
    timer.idle()

    expect(warmRoute).toHaveBeenCalledTimes(1)
    expect(warmRoute).toHaveBeenCalledWith("#/overview")
  })

  it("warms nothing on a profile that has never been anywhere", () => {
    const timer = manualSchedule()

    startRoutePrefetch(timer.schedule)
    timer.idle()

    expect(warmRoute).not.toHaveBeenCalled()
  })

  it("does nothing until the scheduler says so", () => {
    localStorage.setItem("mnemo.last-route", "#/settings")
    const timer = manualSchedule()

    startRoutePrefetch(timer.schedule)

    // The point of the whole thing: it competes with nothing during the paint.
    expect(warmRoute).not.toHaveBeenCalled()
  })

  it("can be called off before it runs", () => {
    localStorage.setItem("mnemo.last-route", "#/settings")
    const timer = manualSchedule()

    startRoutePrefetch(timer.schedule)()
    timer.idle()

    expect(warmRoute).not.toHaveBeenCalled()
  })

  it("is inert by default, so a mounted shell in a test fetches nothing", () => {
    // The default scheduler is chosen at import time from the mode, and tests run in one
    // where warming ten chunks nothing awaits is only a source of stray rejections.
    localStorage.setItem("mnemo.last-route", "#/settings")

    startRoutePrefetch()

    expect(warmRoute).not.toHaveBeenCalled()
  })
})
