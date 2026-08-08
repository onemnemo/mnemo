// @vitest-environment jsdom

/**
 * The four states this widget can be in, and the one visual rule it carries.
 *
 * The desktop has neither a loading nor an error state here: it paints zeroes for the length of the
 * first fetch, and resets to zeroes when the read fails. Both of those look exactly like a day the
 * user has not studied, which is the case that has to stay distinguishable from them.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StatRecordDto, WidgetInstanceDto } from "@/api/types"

import { flashcardStatsManifest } from "./manifest"
import { FlashcardStatsWidget } from "./FlashcardStatsWidget"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

function instance(columns: number, rows: number): WidgetInstanceDto {
  return {
    instanceId: "11111111-1111-1111-1111-111111111111",
    widgetId: "mnemo.flashcard-stats",
    size: { columns, rows },
    column: 0,
    row: 0,
    order: 0,
    settings: {},
  }
}

function record(fields: Record<string, number>): StatRecordDto {
  return {
    ns: "flashcards",
    kind: "totals",
    key: "all",
    updatedAt: "2026-08-08T09:00:00+00:00",
    fields: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, { type: "integer" as const, value: String(value) }]),
    ),
  }
}

/** Answers by kind, so the two reads this widget issues can differ or fail independently. */
function serve(answers: Record<string, StatRecordDto | null | "fail">): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const kind = new URL(String(input), "http://host").searchParams.get("kind") ?? ""
      const answer = answers[kind]
      if (answer === "fail") {
        return Promise.resolve(
          new Response(JSON.stringify({ error: "stat_read_failed", message: "Locked." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify(answer ?? null), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
    }),
  )
}

function withClient(node: ReactNode): ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>
}

async function render(size = instance(2, 1)): Promise<void> {
  await act(async () => {
    root.render(withClient(<FlashcardStatsWidget instance={size} manifest={flashcardStatsManifest} />))
  })
}

/** Drains the queue: fetch resolves, then the query notifies, then the widget rerenders. */
async function settle(turns = 6): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

const values = () => [...container.querySelectorAll("p")].map((p) => p.textContent)
const skeletons = () => container.querySelectorAll("[data-slot=skeleton]").length
const dividers = () => [...container.querySelectorAll("div")].filter((el) => el.className.includes("bg-divider-subtle"))

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe("FlashcardStatsWidget", () => {
  it("renders a skeleton while the reads are in flight, not a grid of zeroes", async () => {
    serve({ totals: record({ current_streak_days: 4 }), "daily.summary": null })
    await render()

    // No settle: this is the first paint, which is the frame the desktop spends showing zeroes.
    expect(skeletons()).toBeGreaterThan(0)
    expect(values()).not.toContain("0")
  })

  it("shows the day's counters and the streak once both reads land", async () => {
    serve({
      totals: record({ current_streak_days: 12 }),
      "daily.summary": record({ cards_reviewed: 42, minutes_studied: 18, sessions_completed: 3 }),
    })
    await render()
    await settle()

    // Keys rather than copy: no bundle is loaded, and useT answers a miss with the key. Which key
    // reaches which cell is the part worth pinning, including the two that come from the page's
    // namespace rather than this widget's.
    expect(values()).toEqual([
      "Subtitle",
      "42",
      "PracticedToday",
      "18",
      "MinutesToday",
      "3",
      "SessionsToday",
      "12",
      "Streak",
    ])
  })

  it("accents an earned metric and leaves a zero plain", async () => {
    serve({
      totals: record({ current_streak_days: 0 }),
      "daily.summary": record({ cards_reviewed: 42, minutes_studied: 0, sessions_completed: 0 }),
    })
    await render()
    await settle()

    const cells = [...container.querySelectorAll("p")].filter((p) => p.className.includes("text-heading-4"))
    expect(cells.map((p) => p.textContent)).toEqual(["42", "0", "0", "0"])
    // Zero is a real value, and rendering it in the brand color would make an untouched day look
    // like an achievement.
    expect(cells[0].className).toContain("text-brand")
    for (const zero of cells.slice(1)) expect(zero.className).toContain("text-text-primary")
  })

  it("reads a record that was never written as zeroes rather than as a failure", async () => {
    // Nothing writes a daily summary for a day nobody studied, so null is the ordinary first-run
    // answer and has to stay distinct from a read that failed.
    serve({ totals: null, "daily.summary": null })
    await render()
    await settle()

    expect(container.textContent).not.toContain("WidgetLoadFailed")
    expect([...container.querySelectorAll("p")].filter((p) => p.textContent === "0")).toHaveLength(4)
  })

  it("shows an error with a way back when either read fails", async () => {
    serve({ totals: record({ current_streak_days: 12 }), "daily.summary": "fail" })
    await render()
    await settle()

    expect(container.textContent).toContain("WidgetLoadFailed")
    expect(container.querySelector("button")?.textContent).toBe("Retry")
    // The streak did arrive, but showing it beside three zeroes that only mean "this did not load"
    // is the ambiguity the state exists to remove.
    expect(container.textContent).not.toContain("12")
  })

  it("turns the hairlines on their side in the one-column tile", async () => {
    serve({ totals: null, "daily.summary": null })

    await render(instance(2, 1))
    await settle()
    expect(dividers()).toHaveLength(3)
    expect(dividers().every((el) => el.className.includes("w-px"))).toBe(true)

    await render(instance(1, 2))
    await settle()
    expect(dividers()).toHaveLength(3)
    expect(dividers().every((el) => el.className.includes("h-px"))).toBe(true)
  })
})
