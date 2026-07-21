// @vitest-environment jsdom

/**
 * The handshake that keeps the window open. What matters here is not that
 * participants run — it is that the host is told *after* they finish, exactly
 * once, and even when one of them fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { completeShutdown, onShutdown, resetShutdownForTests, runShutdown } from "./shutdown"

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

describe("completeShutdown", () => {
  it("reports ready only after the participants have finished", async () => {
    const fetchMock = stubFetch()
    const saving = deferred()
    onShutdown(saving.participant)

    const handshake = completeShutdown()
    await Promise.resolve()
    // Reporting ready here would be a lie the host acts on immediately.
    expect(fetchMock).not.toHaveBeenCalled()

    saving.finish()
    await handshake
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/app/shutdown-ready")
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST")
  })

  it("runs once however many times the host asks", async () => {
    const fetchMock = stubFetch()
    const participant = vi.fn(() => Promise.resolve())
    onShutdown(participant)

    await Promise.all([completeShutdown(), completeShutdown()])
    expect(participant).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("reports ready even when saving failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const fetchMock = stubFetch()
    onShutdown(() => Promise.reject(new Error("nope")))

    await completeShutdown()
    // Whatever went wrong, holding the window open for the full grace period
    // does not fix it and looks like a hang.
    expect(fetchMock).toHaveBeenCalledOnce()
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
