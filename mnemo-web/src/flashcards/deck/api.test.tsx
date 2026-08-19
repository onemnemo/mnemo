// @vitest-environment jsdom

/**
 * A move can land cards in a deck this hook was never scoped to, so unlike every other
 * card mutation here it has to invalidate every open deck's cache rather than just the
 * one it was constructed for. Drives the real hook through a QueryClient and checks the
 * query keys that end up invalidated, rather than the request that goes out.
 */

import { act } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { deckKey, libraryKey } from "../api"
import { useMoveCards } from "./api"

let client: QueryClient
let hook: ReturnType<typeof useMoveCards> | null = null
let container: HTMLDivElement
let root: Root

function Harness() {
  hook = useMoveCards("deck-a")
  return null
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }))
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    )
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe("useMoveCards", () => {
  it("invalidates every open deck's cache, not just the deck it was constructed for", async () => {
    // Neither deck below is "deck-a", the id the hook itself was scoped to.
    client.setQueryData([...deckKey("deck-b"), "cards"], { items: [] })
    client.setQueryData([...deckKey("deck-c"), "cards"], { items: [] })

    await act(async () => {
      await hook!.mutateAsync({ cardIds: ["card-1"], targetDeckId: "deck-b" })
    })

    expect(client.getQueryState([...deckKey("deck-b"), "cards"])?.isInvalidated).toBe(true)
    expect(client.getQueryState([...deckKey("deck-c"), "cards"])?.isInvalidated).toBe(true)
  })

  it("also invalidates the library, since a move changes both decks' counts", async () => {
    client.setQueryData(libraryKey, {})

    await act(async () => {
      await hook!.mutateAsync({ cardIds: ["card-1"], targetDeckId: "deck-b" })
    })

    expect(client.getQueryState(libraryKey)?.isInvalidated).toBe(true)
  })

  it("leaves an unrelated cache entry outside the deck prefix alone", async () => {
    client.setQueryData(["flashcards", "something-else"], { untouched: true })

    await act(async () => {
      await hook!.mutateAsync({ cardIds: ["card-1"], targetDeckId: "deck-b" })
    })

    expect(client.getQueryState(["flashcards", "something-else"])?.isInvalidated).toBeFalsy()
  })
})
