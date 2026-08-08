// @vitest-environment jsdom

/**
 * The three load outcomes, asserted where they finally become visible.
 *
 * `api.test.ts` proves the three are distinguishable on the wire and `store.test.ts` proves the
 * store refuses to write in the wrong one. This is the join: the page is the only place that can
 * get the wiring backwards while both of those stay green, and the failure it would produce, a
 * starter board written over a board that merely failed to read, is silent and permanent.
 */

import { act, StrictMode, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { OverviewLayoutDto } from "@/api/types"

import { useOverviewStore } from "../store"
import { OverviewRoute } from "./OverviewRoute"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface Call {
  method: string
  body: unknown
}

let calls: Call[]
let container: HTMLElement
let root: Root

/**
 * Answers every GET with the same body; records the PUTs so a save can be counted, not guessed.
 *
 * `persistWrites` makes it behave like the endpoint rather than like a fixture: a PUT becomes what
 * the next GET returns. Tests about what happens *after* a write need that, because a stub that
 * keeps answering "this profile has never saved a board" to a profile that just saved one is
 * describing a server that does not exist.
 */
function serve(status: number, body: string, persistWrites = false): void {
  let stored = body

  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      const parsed = typeof init?.body === "string" ? JSON.parse(init.body) : undefined
      calls.push({ method, body: parsed })

      if (method !== "GET") {
        if (persistWrites && typeof init?.body === "string") stored = init.body
        return Promise.resolve(new Response("", { status: 204 }))
      }
      return Promise.resolve(
        new Response(stored, { status, headers: { "Content-Type": "application/json" } }),
      )
    }),
  )
}

// No retries: a failed load has to reach the page on the first answer, or the test is measuring
// React Query's backoff instead of the page.
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

function withClient(node: ReactNode, client: QueryClient): ReactNode {
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

/**
 * Drains the task queue.
 *
 * A single flush is not enough: the fetch resolves, then the query notifies, then an effect mirrors
 * it into the store, and a seed adds a write and a refetch on top of that. Each hop is its own
 * turn, so this pumps until the page stops producing work.
 */
async function settle(turns = 8): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/**
 * Mounts and lets every queued promise settle, which is when the query has reached the store.
 *
 * `strict` is off only where StrictMode's replay would drown out what is being measured. It
 * deliberately re-runs mount effects against the render that produced them, so an effect that
 * reads a value the previous pass has since changed still sees the old one. That is a faithful
 * model of development, and a poor model of a real remount, which re-renders first.
 */
async function render(client: QueryClient = newClient(), strict = true): Promise<void> {
  const tree = withClient(<OverviewRoute />, client)
  await act(async () => {
    root.render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  })
  await settle()
}

const saves = () => calls.filter((call) => call.method === "PUT")

beforeEach(() => {
  calls = []
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  // jsdom has no ResizeObserver, and the board measures itself on mount. Never firing is the right
  // stand-in: the hook is specified to hold its bucket until something reports a usable width.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  // The store is a module singleton, so a test that left a board behind would seed the next one's
  // starting state.
  act(() => useOverviewStore.getState().leaveOverview())
  vi.unstubAllGlobals()
})

describe("OverviewRoute", () => {
  it("seeds the starter board and saves it exactly once when the profile never saved one", async () => {
    serve(200, "null")
    await render()

    expect(saves()).toHaveLength(1)
    const layout = saves()[0].body as OverviewLayoutDto
    expect(layout.widgets.map((widget) => widget.widgetId)).toEqual([
      "mnemo.flashcard-stats",
      "mnemo.recent-decks",
      "mnemo.recent-notes",
      "mnemo.study-goals",
      "mnemo.usage-summary",
    ])
    // The template's coordinates are literal placements, not -1, so the board is placed before the
    // engine ever runs and both apps agree on what first run produced.
    expect(layout.widgets.map((widget) => [widget.column, widget.row])).toEqual([
      [0, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [3, 1],
    ])
    expect(container.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0)
  })

  it("seeds once across a visit that leaves Overview and comes back", async () => {
    // Leaving and returning re-runs the mount against a cache that still remembers the load. If
    // what it remembers is the never-saved answer, the second visit seeds a second starter board
    // and writes it over the first, with different instance ids. The seeded board is published as
    // the write goes out precisely so the cache stops saying "never saved" the moment it stops
    // being true.
    serve(200, "null", true)
    const client = newClient()

    await render(client, false)
    expect(saves()).toHaveLength(1)

    // A real remount, not a re-render: root.render on a live root updates in place and never runs
    // a mount effect again, which is exactly the thing under test.
    act(() => root.unmount())
    act(() => useOverviewStore.getState().leaveOverview())
    root = createRoot(container)
    await render(client, false)

    expect(saves()).toHaveLength(1)
    expect(useOverviewStore.getState().draft).toHaveLength(5)
  })

  it("renders the error state, not the empty state, and saves nothing when the board cannot be read", async () => {
    serve(500, JSON.stringify({ error: "overview_layout_unreadable", message: "Corrupt payload." }))
    await render()

    expect(container.textContent).toContain("LayoutLoadFailed")
    // The desktop routes this through the empty state, whose action ends in a one-widget board
    // written over the one that failed to read. Both halves of that have to be absent.
    expect(container.textContent).not.toContain("DashboardEmpty")
    expect(container.textContent).not.toContain("AddFirstWidget")
    expect(saves()).toHaveLength(0)
    expect(useOverviewStore.getState().boardState).toBe("error")
  })

  it("does not save when a retry from the error state fails again", async () => {
    serve(500, JSON.stringify({ error: "overview_layout_unreadable", message: "Corrupt payload." }))
    await render()

    const button = container.querySelector("button")
    expect(button).not.toBeNull()
    await act(async () => {
      button?.click()
    })
    await settle()

    expect(useOverviewStore.getState().boardState).toBe("error")
    expect(saves()).toHaveLength(0)
  })

  it("renders an unknown widget id as a removable placeholder rather than dropping the tile", async () => {
    const stored: OverviewLayoutDto = {
      schemaVersion: 3,
      profileId: "default",
      widgets: [
        {
          instanceId: "11111111-1111-1111-1111-111111111111",
          widgetId: "acme.not-installed",
          size: { columns: 2, rows: 1 },
          column: 0,
          row: 0,
          order: 0,
          settings: {},
        },
      ],
    }
    serve(200, JSON.stringify(stored))
    await render()

    // The raw id, because there is no manifest to localize a name from and the id is the only
    // thing that names the missing extension.
    expect(container.textContent).toContain("acme.not-installed")
    expect(container.textContent).toContain("WidgetUnavailable")

    // Remove is the one control that renders outside edit mode; without it the tile could only be
    // deleted from a mode that has not been built yet.
    const remove = container.querySelector('button[aria-label="RemoveWidget"]')
    expect(remove).not.toBeNull()
    expect(saves()).toHaveLength(0)
  })

  it("renders a stored board without writing it back", async () => {
    const stored: OverviewLayoutDto = {
      schemaVersion: 3,
      profileId: "default",
      widgets: [
        {
          instanceId: "22222222-2222-2222-2222-222222222222",
          widgetId: "mnemo.study-goals",
          size: { columns: 1, rows: 2 },
          column: 2,
          row: 1,
          order: 0,
          settings: {},
        },
      ],
    }
    serve(200, JSON.stringify(stored))
    await render()

    expect(useOverviewStore.getState().boardState).toBe("ready")
    expect(useOverviewStore.getState().draft).toHaveLength(1)
    // A load is not a change. Reading a board and immediately writing it back would make every
    // visit a write, and would overwrite a board the user edited on the desktop meanwhile.
    expect(saves()).toHaveLength(0)
  })
})
