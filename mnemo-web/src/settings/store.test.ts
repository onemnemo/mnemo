// @vitest-environment jsdom

/**
 * A setting can gate a nav item's visibility server-side (AI.EnableAssistant is
 * the shipped case), and the nav endpoint recomputes that live on every call. So a
 * successful write has to pull a fresh nav model, or the sidebar shows stale
 * visibility until the app restarts.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

import { useNavStore } from "@/nav/store"

import { useSettingsStore } from "./store"

function respondWith(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  useSettingsStore.setState({ values: {}, secrets: {}, loaded: false, failed: false })
  useNavStore.setState({ categories: [] })
})

describe("setValue", () => {
  it("refetches the nav model after a successful write", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("/nav")) {
        return Promise.resolve(
          respondWith(200, [
            { key: "app", namespace: "Sidebar", order: 0, footer: false, items: [] },
          ]),
        )
      }
      // A 204 is a null-body status: the Response constructor throws if it is
      // given one anyway, which would otherwise make this look like a failed PUT.
      return Promise.resolve(new Response(null, { status: 204 }))
    })
    vi.stubGlobal("fetch", fetchMock)

    await useSettingsStore.getState().setValue("AI.EnableAssistant", true)
    // The PUT resolves before the nav refetch's promise chain finishes.
    await vi.waitFor(() => expect(useNavStore.getState().categories).toHaveLength(1))

    expect(useNavStore.getState().categories[0]?.key).toBe("app")
  })

  it("does not touch the nav model when the write itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(respondWith(500, { error: "boom" }))),
    )

    await useSettingsStore.getState().setValue("AI.EnableAssistant", true)

    expect(useNavStore.getState().categories).toEqual([])
  })
})
