// @vitest-environment jsdom

/**
 * Covers the one thing about the fetch wrapper that is not obvious: a non-2xx
 * status can be an answer rather than a failure, and the answer is in the body.
 * The rest of the file is a thin wrapper over `fetch` and reads as one.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError, apiFetch, apiFetchExpecting } from "./client"

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

/** The request the last stubbed fetch received. */
function lastRequest(): { url: string; init: RequestInit } {
  const mock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
  const [url, init] = mock.mock.calls[mock.mock.calls.length - 1]
  return { url, init }
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.__MNEMO_TOKEN__
})

describe("apiFetchExpecting", () => {
  it("hands back the body of a status the caller expects", async () => {
    // The case this exists for: a stale commit answers 409 with the version
    // actually stored, and that version is the entire content of the answer.
    respondWith(409, { outcome: "Stale", ver: 12 })
    const result = await apiFetchExpecting<{ outcome: string; ver: number }>("/notes/n/content", [409])
    expect(result).toEqual({ status: 409, data: { outcome: "Stale", ver: 12 } })
  })

  it("still throws for a status the caller did not name", async () => {
    respondWith(500, { error: "boom" })
    await expect(apiFetchExpecting("/notes/n/content", [409])).rejects.toBeInstanceOf(ApiError)
  })

  it("hands back an ordinary success unchanged", async () => {
    respondWith(200, { outcome: "Applied", ver: 8 })
    const result = await apiFetchExpecting<{ ver: number }>("/notes/n/content", [409])
    expect(result).toEqual({ status: 200, data: { outcome: "Applied", ver: 8 } })
  })

  it("sends the bearer token like every other call", async () => {
    window.__MNEMO_TOKEN__ = "tok"
    respondWith(200, {})
    await apiFetchExpecting("/notes", [409])
    expect(new Headers(lastRequest().init.headers).get("Authorization")).toBe("Bearer tok")
  })
})

describe("apiFetch", () => {
  it("carries the error code out of the body", async () => {
    respondWith(404, { error: "unknown_note", message: "No note 'n'." })
    await expect(apiFetch("/notes/n")).rejects.toMatchObject({
      status: 404,
      code: "unknown_note",
      message: "No note 'n'.",
    })
  })

  it("sends the bearer token", async () => {
    window.__MNEMO_TOKEN__ = "tok"
    respondWith(200, {})
    await apiFetch("/notes")
    expect(new Headers(lastRequest().init.headers).get("Authorization")).toBe("Bearer tok")
  })
})
