// @vitest-environment jsdom

/**
 * The dispatcher is a switch, and most of its cases are one store call each.
 * The one worth a test is `shutdown`: nothing in the UI shows whether it was
 * handled, and if it is not, the window closes without saving.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { onShutdown, resetShutdownForTests } from "@/app/shutdown"

import { dispatchAppEvent } from "./dispatch"
import { EventType } from "./types"

beforeEach(() => {
  resetShutdownForTests()
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("a shutdown event", () => {
  it("runs the shutdown participants", async () => {
    const saved = vi.fn(() => Promise.resolve())
    onShutdown(saved)

    dispatchAppEvent({ type: EventType.Shutdown, data: { graceMs: 3000 } })
    await vi.waitFor(() => {
      expect(saved).toHaveBeenCalledOnce()
    })
  })

  it("reports ready to the host", async () => {
    dispatchAppEvent({ type: EventType.Shutdown, data: { graceMs: 3000 } })
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith("/api/app/shutdown-ready", expect.anything())
    })
  })
})

describe("an unknown event", () => {
  it("is ignored rather than thrown on", () => {
    expect(() => {
      dispatchAppEvent({ type: "not-a-real-event", data: null })
    }).not.toThrow()
  })
})
