// @vitest-environment jsdom

/**
 * Checks that window shutdown ends the study session and records its activity.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { StudySessionDto } from "@/api/types"
import { resetShutdownForTests, runShutdown } from "@/app/shutdown"

import { SessionPage } from "./SessionPage"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  startSession: vi.fn(() => Promise.resolve({} as StudySessionDto)),
  endSession: vi.fn(() => Promise.resolve()),
}))

vi.mock("./api", () => ({
  startSession: mocks.startSession,
  endSession: mocks.endSession,
  gradeCard: vi.fn(),
  undoGrade: vi.fn(),
  fetchCard: vi.fn(),
}))

vi.mock("../deck/api", () => ({ useFlagCards: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
vi.mock("./components/CardSurface", () => ({ CardSurface: () => null }))
vi.mock("./components/EndPanel", () => ({ EndPanel: () => null }))
vi.mock("./components/GradeRow", () => ({ GradeRow: () => null }))
vi.mock("./components/KeyHints", () => ({ PostRevealHint: () => null, PreRevealHint: () => null }))
vi.mock("./components/SessionTopbar", () => ({ SessionTopbar: () => null }))

function studySession(): StudySessionDto {
  return {
    sessionId: "s1",
    deckId: "d1",
    deckName: "Deck",
    mode: "cram",
    scope: "all",
    writesSchedule: false,
    autoReveal: "off",
    startedEmpty: false,
    isFinished: false,
    canUndo: false,
    graded: 2,
    current: null,
    progress: { new: 0, learning: 0, due: 0, completed: 2, total: 4 },
    intervals: null,
  }
}

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.startSession.mockResolvedValue(studySession())
  mocks.endSession.mockResolvedValue(undefined)
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

describe("a study session while the window is closing", () => {
  it("ends the session even though the screen never goes away", async () => {
    await act(async () => {
      root.render(<SessionPage deckId="d1" mode="cram" scope="all" />)
    })
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await runShutdown()
    })

    expect(mocks.endSession).toHaveBeenCalledWith("s1")
  })

  it("does nothing when nobody is studying", async () => {
    await act(async () => {
      await runShutdown()
    })

    expect(mocks.endSession).not.toHaveBeenCalled()
  })
})
