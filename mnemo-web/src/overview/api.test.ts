// @vitest-environment jsdom

/**
 * The client half of the three-outcome load contract.
 *
 * The server spends an enum, a hand-written literal-`null` body and a byte-level test keeping
 * "this profile never saved a board" apart from "the board could not be read". This is the last
 * hop, and the only one where folding the two back together would go unnoticed: both arrive at
 * the caller as an absent board, and only one of them may lead to a write.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { OverviewLayoutDto } from "@/api/types"

import { loadOverviewLayout, toOverviewBoard } from "./api"

const BOARD: OverviewLayoutDto = {
  schemaVersion: 3,
  profileId: "default",
  widgets: [
    {
      instanceId: "11111111-1111-1111-1111-111111111111",
      widgetId: "mnemo.recent-notes",
      size: { columns: 2, rows: 1 },
      column: 0,
      row: 0,
      order: 0,
      settings: { range: "week" },
    },
  ],
}

/** Answers the next fetch with a raw body, so the literal `null` reaches the parser as sent. */
function respondWith(status: number, body: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(new Response(body, { status, headers: { "Content-Type": "application/json" } })),
    ),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("loadOverviewLayout", () => {
  it("reads the never-saved answer as null", async () => {
    // A 200 carrying the four bytes `null`, which is what OverviewEndpoints writes by hand
    // precisely so this parses instead of throwing.
    respondWith(200, "null")
    await expect(loadOverviewLayout()).resolves.toBeNull()
  })

  it("reads a stored board as a board", async () => {
    respondWith(200, JSON.stringify(BOARD))
    await expect(loadOverviewLayout()).resolves.toEqual(BOARD)
  })

  it("throws the endpoint's code on an unreadable board rather than reporting no board", async () => {
    respondWith(500, JSON.stringify({ error: "overview_layout_unreadable", message: "Corrupt payload." }))

    const load = loadOverviewLayout()

    await expect(load).rejects.toBeInstanceOf(ApiError)
    await expect(load).rejects.toMatchObject({ status: 500, code: "overview_layout_unreadable" })
  })
})

describe("toOverviewBoard", () => {
  const failed = new ApiError("Corrupt payload.", 500, "overview_layout_unreadable")

  it("reports a stored board", () => {
    expect(toOverviewBoard({ status: "success", data: BOARD })).toEqual({ kind: "loaded", layout: BOARD })
  })

  it("reports a profile that never saved as empty, the one state that may be seeded over", () => {
    expect(toOverviewBoard({ status: "success", data: null })).toEqual({ kind: "empty" })
  })

  it("keeps a failed read out of the empty state", () => {
    // The collapse this file exists for: an error and a fresh profile both leave the caller
    // without a board, and seeding on the error path overwrites a board that is still on disk.
    const board = toOverviewBoard({ status: "error", error: failed })

    expect(board).toEqual({ kind: "error", error: failed })
    expect(board.kind).not.toBe("empty")
  })

  it("keeps a request still in flight out of the empty state", () => {
    const board = toOverviewBoard({ status: "pending" })

    expect(board).toEqual({ kind: "loading" })
    expect(board.kind).not.toBe("empty")
  })

  it("treats a deliberately cleared board as loaded, not as never saved", () => {
    const cleared: OverviewLayoutDto = { ...BOARD, widgets: [] }

    expect(toOverviewBoard({ status: "success", data: cleared })).toEqual({ kind: "loaded", layout: cleared })
  })
})
