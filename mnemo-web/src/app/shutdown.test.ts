// @vitest-environment jsdom

/**
 * The handshake that keeps the window open. What matters here is not that
 * participants run, it is that the host is told *after* they finish, exactly
 * once, and even when one of them fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  completeShutdown,
  onShutdown,
  onShutdownGuard,
  resetShutdownForTests,
  runShutdown,
  runShutdownGuards,
} from "./shutdown"

/** The endpoint each POST went to, in order. */
function paths(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => call[0] as string)
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })))
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** A participant that only finishes when the test says so. */
function deferred(): { participant: () => Promise<void>; started: () => boolean; finish: () => void } {
  let started = false
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    participant: async () => {
      started = true
      await gate
    },
    started: () => started,
    finish: () => {
      release()
    },
  }
}

beforeEach(() => {
  resetShutdownForTests()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("runShutdown", () => {
  it("waits for every participant", async () => {
    const done: string[] = []
    onShutdown(async () => {
      done.push("a")
    })
    onShutdown(async () => {
      done.push("b")
    })

    await runShutdown()
    expect(done.toSorted()).toEqual(["a", "b"])
  })

  it("starts them all before waiting for any", async () => {
    // The grace period is shared. Run one after another and it is spent
    // queueing rather than saving.
    const slow = deferred()
    const fast = deferred()
    onShutdown(slow.participant)
    onShutdown(fast.participant)

    const running = runShutdown()
    await Promise.resolve()
    expect(fast.started()).toBe(true)

    slow.finish()
    fast.finish()
    await running
  })

  it("still waits for the others when one fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    let survived = false
    onShutdown(() => Promise.reject(new Error("disk full")))
    onShutdown(async () => {
      survived = true
    })

    await expect(runShutdown()).resolves.toBeUndefined()
    expect(survived).toBe(true)
  })

  it("ignores a participant that has unregistered", async () => {
    const participant = vi.fn(() => Promise.resolve())
    onShutdown(participant)()

    await runShutdown()
    expect(participant).not.toHaveBeenCalled()
  })
})

describe("runShutdownGuards", () => {
  it("stops at the first objection", async () => {
    const later = vi.fn(() => Promise.resolve(true))
    onShutdownGuard(() => Promise.resolve(false))
    onShutdownGuard(later)

    await expect(runShutdownGuards()).resolves.toBe(false)
    // Otherwise a veto still leaves the rest of the prompts to dismiss.
    expect(later).not.toHaveBeenCalled()
  })

  it("treats a broken guard as no objection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    onShutdownGuard(() => Promise.reject(new Error("boom")))

    // Failing closed here would be a window that cannot be closed.
    await expect(runShutdownGuards()).resolves.toBe(true)
  })

  it("allows the exit when nothing is registered", async () => {
    await expect(runShutdownGuards()).resolves.toBe(true)
  })
})

describe("completeShutdown", () => {
  it("reports ready only after the participants have finished", async () => {
    const fetchMock = stubFetch()
    const saving = deferred()
    onShutdown(saving.participant)

    const handshake = completeShutdown()
    await Promise.resolve()
    // Reporting ready here would be a lie the host acts on immediately.
    expect(paths(fetchMock)).not.toContain("/api/app/shutdown-ready")

    saving.finish()
    await handshake
    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-ready"])
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("POST")
  })

  it("holds the clock for a save, not only for a question", async () => {
    // The host's grace period is measured from before the SPA has serialized
    // anything, so a note slow to write is the one whose write gets cut short.
    const fetchMock = stubFetch()
    onShutdown(() => Promise.resolve())

    await completeShutdown()

    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-ready"])
  })

  it("stops waiting for a participant that never finishes", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const fetchMock = stubFetch()
    onShutdown(() => new Promise<void>(() => undefined))

    const handshake = completeShutdown()
    await vi.advanceTimersByTimeAsync(10_000)
    await handshake

    // Holding stops the host's clock, so without a ceiling of its own a hung
    // save is a window that never closes.
    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-ready"])
  })

  it("runs once however many times the host asks", async () => {
    const fetchMock = stubFetch()
    const participant = vi.fn(() => Promise.resolve())
    onShutdown(participant)

    await Promise.all([completeShutdown(), completeShutdown()])
    expect(participant).toHaveBeenCalledOnce()
    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-ready"])
  })

  it("reports ready even when saving failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const fetchMock = stubFetch()
    onShutdown(() => Promise.reject(new Error("nope")))

    await completeShutdown()
    // Whatever went wrong, holding the window open for the full grace period
    // does not fix it and looks like a hang.
    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-ready"])
  })

  it("holds the clock before asking, then saves and reports ready", async () => {
    const fetchMock = stubFetch()
    const participant = vi.fn(() => Promise.resolve())
    onShutdown(participant)
    onShutdownGuard(() => Promise.resolve(true))

    await completeShutdown()

    // Hold first or the host's grace expires while the prompt is still up.
    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-ready"])
    expect(participant).toHaveBeenCalledOnce()
  })

  it("cancels without saving when a guard objects", async () => {
    const fetchMock = stubFetch()
    const participant = vi.fn(() => Promise.resolve())
    onShutdown(participant)
    onShutdownGuard(() => Promise.resolve(false))

    await completeShutdown()

    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-hold", "/api/app/shutdown-cancel"])
    // A cancelled exit is not a moment to flush: the app carries on as it was.
    expect(participant).not.toHaveBeenCalled()
  })

  it("asks again on the close after a cancelled one", async () => {
    const fetchMock = stubFetch()
    const guard = vi.fn(() => Promise.resolve(false))
    onShutdownGuard(guard)

    await completeShutdown()
    await completeShutdown()

    // Memoizing the cancel would report ready instantly against a re-armed gate,
    // closing the window with no prompt and no save.
    expect(guard).toHaveBeenCalledTimes(2)
    expect(paths(fetchMock).filter((p) => p.endsWith("shutdown-cancel"))).toHaveLength(2)
  })

  it("does not hold the clock when nothing can object", async () => {
    const fetchMock = stubFetch()

    await completeShutdown()

    expect(paths(fetchMock)).toEqual(["/api/app/shutdown-ready"])
  })

  it("resolves even when the host cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("connection refused"))),
    )

    await expect(completeShutdown()).resolves.toBeUndefined()
  })
})
