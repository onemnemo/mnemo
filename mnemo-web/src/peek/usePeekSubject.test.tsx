// @vitest-environment jsdom

/**
 * The subject reads a note's title off the shared library list. Reading it must not cost
 * the list: a peek opened from outside the notes workspace reuses what the tree has kept
 * warm rather than fetching the corpus for one title.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NoteSummaryDto } from "@/api/types"

import { usePeekStore, type PeekItem } from "./store"
import { usePeekSubject } from "./usePeekSubject"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOTE_LIST_KEY = ["notes", "list"]

function summary(id: string, title: string): NoteSummaryDto {
  return { id, title } as NoteSummaryDto
}

let container: HTMLElement
let root: Root
let fetchSpy: ReturnType<typeof vi.fn>

function Probe({ item }: { item: PeekItem }) {
  const subject = usePeekSubject(item)
  return <div data-testid="probe" data-title={subject.title} />
}

async function render(client: QueryClient, item: PeekItem): Promise<void> {
  await act(async () => {
    root.render(
      <StrictMode>
        <QueryClientProvider client={client}>
          <Probe item={item} />
        </QueryClientProvider>
      </StrictMode>,
    )
  })
}

function title(): string | null {
  return container.querySelector('[data-testid="probe"]')?.getAttribute("data-title") ?? null
}

beforeEach(() => {
  fetchSpy = vi.fn(() => new Promise(() => undefined))
  vi.stubGlobal("fetch", fetchSpy)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("usePeekSubject and the library list", () => {
  it("reads a warm list without fetching it again", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(NOTE_LIST_KEY, [summary("n1", "Mitochondria")])

    await render(client, { kind: "note", id: "n1" })

    expect(title()).toBe("Mitochondria")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("asks once when nothing is cached", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    await render(client, { kind: "note", id: "n1" })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/notes")
  })

  it("asks the list once about a note it does not hold before calling it gone", async () => {
    // The cached list predates the note; the one refetch finds it, and the peek stays.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(NOTE_LIST_KEY, [summary("n1", "Mitochondria")])
    const closePeek = vi.fn()
    usePeekStore.setState({ closePeek })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([summary("n1", "Mitochondria"), summary("n2", "Ribosome")]), {
        headers: { "Content-Type": "application/json" },
      })),
    )

    await render(client, { kind: "note", id: "n2" })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(title()).toBe("Ribosome")
    expect(closePeek).not.toHaveBeenCalled()
  })

  it("closes on a note the refreshed list still does not hold", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(NOTE_LIST_KEY, [summary("n1", "Mitochondria")])
    const closePeek = vi.fn()
    usePeekStore.setState({ closePeek })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([summary("n1", "Mitochondria")]), {
        headers: { "Content-Type": "application/json" },
      })),
    )

    await render(client, { kind: "note", id: "gone" })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(closePeek).toHaveBeenCalledTimes(1)
  })

  it("closes at once on a list refreshed since it opened, which is what the trash produces", async () => {
    // The trash invalidates the list itself; its answer without the note is the answer, so no
    // second corpus fetch is asked for.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(NOTE_LIST_KEY, [summary("n1", "Mitochondria")])
    const closePeek = vi.fn()
    usePeekStore.setState({ closePeek })
    fetchSpy.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } })),
    )

    await render(client, { kind: "note", id: "n1" })
    expect(fetchSpy).not.toHaveBeenCalled()

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["notes"] })
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(closePeek).toHaveBeenCalledTimes(1)
  })

  it("follows a rename the list receives", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(NOTE_LIST_KEY, [summary("n1", "Mitochondria")])
    await render(client, { kind: "note", id: "n1" })

    await act(async () => {
      client.setQueryData(NOTE_LIST_KEY, [summary("n1", "The mitochondrion")])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(title()).toBe("The mitochondrion")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
