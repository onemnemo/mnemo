// @vitest-environment jsdom

/**
 * The one thing worth pinning about the folder button: which failures it is allowed
 * to call "missing". A host that has never heard of the route answers 404 too, and
 * telling that user their log folder does not exist yet sends them looking for the
 * wrong problem.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { openHostFolder } from "./folders"

function respondWith(status: number, body?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        body === undefined
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
      ),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("openHostFolder", () => {
  it("reports nothing when the host opened the folder", async () => {
    respondWith(204)
    await expect(openHostFolder("logs")).resolves.toBeNull()
  })

  it("sends the target name and never a path", async () => {
    respondWith(204)
    await openHostFolder("data")

    const mock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } }
    const [url, init] = mock.mock.calls[0]
    expect(url).toBe("/api/app/open-folder")
    expect(init.body).toBe(JSON.stringify({ target: "data" }))
  })

  it("reports a missing folder only for the host's own code", async () => {
    respondWith(404, { error: "missing_directory", message: "That folder does not exist yet." })
    await expect(openHostFolder("logs")).resolves.toBe("missing")
  })

  it("treats an unknown route as a failure, not a missing folder", async () => {
    // Word for word what a host built before this route existed answers, from the
    // SPA fallback that catches any /api path no endpoint claimed.
    respondWith(404, { error: "not_found", message: "Unknown API route." })
    await expect(openHostFolder("logs")).resolves.toBe("failed")
  })

  it("reports a shell that refused as a failure", async () => {
    respondWith(502, { error: "open_failed", message: "Could not open the folder." })
    await expect(openHostFolder("data")).resolves.toBe("failed")
  })
})
