// @vitest-environment jsdom

/**
 * Runs the real grade request against a stubbed fetch. The store's tests replace this module
 * wholesale, so nothing else executes the branch that folds the server's stale-card 409 into
 * session state rather than throwing it.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { StudySessionDto } from "@/api/types"

import { gradeCard } from "./api"

function session(overrides: Partial<StudySessionDto> = {}): StudySessionDto {
  return {
    sessionId: "s1",
    deckId: "d1",
    deckName: "Deck",
    mode: "review",
    scope: "due",
    writesSchedule: true,
    autoReveal: "off",
    startedEmpty: false,
    isFinished: false,
    canUndo: true,
    graded: 1,
    current: null,
    progress: { new: 0, learning: 1, due: 0, completed: 0, total: 1 },
    intervals: null,
    ...overrides,
  }
}

function respondWith(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ),
  )
}

function lastRequest(): { url: string; init: RequestInit } {
  const mock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1]
  return { url, init }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.__MNEMO_TOKEN__
})

describe("gradeCard", () => {
  it("posts the card id and grade to the session's grade route", async () => {
    respondWith(200, session())

    await gradeCard("s1", { cardId: "card-a", grade: "good" })

    const { url, init } = lastRequest()
    expect(url).toBe("/api/study/sessions/s1/grade")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({ cardId: "card-a", grade: "good" })
  })

  it("hands back the live state a stale-card 409 carries instead of throwing", async () => {
    const live = session({ graded: 2, current: null })
    respondWith(409, live)

    await expect(gradeCard("s1", { cardId: "card-a", grade: "good" })).resolves.toEqual(live)
  })

  it("still throws for any other failure", async () => {
    respondWith(404, { error: "unknown_session", message: "No study session 's1'." })

    await expect(gradeCard("s1", { cardId: "card-a", grade: "good" })).rejects.toBeInstanceOf(ApiError)
  })

  it("sends the bearer token when the host issued one", async () => {
    window.__MNEMO_TOKEN__ = "tok"
    respondWith(200, session())

    await gradeCard("s1", { cardId: "card-a", grade: "good" })

    expect(new Headers(lastRequest().init.headers).get("Authorization")).toBe("Bearer tok")
  })
})
