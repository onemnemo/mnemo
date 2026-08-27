// @vitest-environment jsdom

/**
 * Checks that window shutdown records effort for an unfinished test.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CardDto, TestQueueDto } from "@/api/types"
import { resetShutdownForTests, runShutdown } from "@/app/shutdown"

import { TestPage } from "./TestPage"
import { useTest } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const STARTED_AT = "2026-01-01T09:00:00Z"

const mocks = vi.hoisted(() => ({
  fetchTestQueue: vi.fn(),
  recordActivity: vi.fn(() => Promise.resolve()),
  recordAttempt: vi.fn(),
}))

vi.mock("./api", () => ({
  fetchTestQueue: mocks.fetchTestQueue,
  fetchTestRetakeQueue: vi.fn(),
  recordActivity: mocks.recordActivity,
  recordAttempt: mocks.recordAttempt,
}))

vi.mock("../session/api", () => ({ fetchCard: vi.fn() }))
vi.mock("../session/components/KeyHints", () => ({ Kbd: () => null }))
vi.mock("../deck/api", () => ({ useFlagCards: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
vi.mock("./components/ScorePanel", () => ({ ScorePanel: () => null }))
vi.mock("./components/TestCard", () => ({ TestCard: () => null }))
vi.mock("./components/TestGradeRow", () => ({ TestGradeRow: () => null }))
vi.mock("./components/TestTopbar", () => ({ TestTopbar: () => null }))

function card(id: string): CardDto {
  return {
    id,
    deckId: "d1",
    type: "classic",
    front: id,
    back: id,
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
  }
}

function queue(): TestQueueDto {
  return { deckId: "d1", deckName: "Deck", startedAt: STARTED_AT, cards: [card("c1"), card("c2")] }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetchTestQueue.mockResolvedValue(queue())
  mocks.recordActivity.mockResolvedValue(undefined)
  resetShutdownForTests()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  resetShutdownForTests()
})

describe("a test in progress while the window is closing", () => {
  it("records the effort even though the screen never goes away", async () => {
    await act(async () => {
      root.render(<TestPage deckId="d1" />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    // Leave the test unfinished to exercise abandonment recording.
    act(() => {
      useTest.getState().reveal()
      useTest.getState().grade("gotIt")
    })

    await act(async () => {
      await runShutdown()
    })

    expect(mocks.recordActivity).toHaveBeenCalledOnce()
    expect(mocks.recordActivity).toHaveBeenCalledWith("d1", { startedAt: STARTED_AT, cardsTested: 1 })
  })

  it("writes nothing when no card was graded", async () => {
    await act(async () => {
      root.render(<TestPage deckId="d1" />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await runShutdown()
    })

    // An unanswered test must not add study activity.
    expect(mocks.recordActivity).not.toHaveBeenCalled()
  })
})
