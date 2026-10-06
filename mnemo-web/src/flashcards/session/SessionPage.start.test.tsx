// @vitest-environment jsdom

/**
 * A study session that is started twice, as StrictMode does on mount, must leave the reader on
 * the session they are holding. The host supersedes a deck's live session on every start and can
 * handle two requests in either order, so a late first start used to delete the live session and
 * the first grade then came back 404 and sent the reader out to the deck.
 */

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { CardDto, StartStudySessionDto, StudySessionDto } from "@/api/types"
import { navigate } from "@/app/router"

import { SessionPage } from "./SessionPage"
import { useSession } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  startSession: vi.fn(),
  endSession: vi.fn(),
  gradeCard: vi.fn(),
  undoGrade: vi.fn(),
  fetchCard: vi.fn(),
}))

vi.mock("./api", () => ({
  startSession: mocks.startSession,
  endSession: mocks.endSession,
  gradeCard: mocks.gradeCard,
  undoGrade: mocks.undoGrade,
  fetchCard: mocks.fetchCard,
}))

vi.mock("@/i18n/useT", () => {
  const t = (_ns: string, key: string) => key
  return { useT: () => t }
})
vi.mock("@/settings/store", () => ({ useSettingValue: (_key: string, fallback: string) => fallback }))
vi.mock("@/components/icon/AppIcon", () => ({ AppIcon: ({ name }: { name: string }) => <span data-icon={name} /> }))
vi.mock("../deck/api", () => ({ useFlagCards: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
vi.mock("@/lib/modal", () => ({ isModalOpen: () => false }))
vi.mock("./components/EndPanel", () => ({ EndPanel: () => null }))
vi.mock("./components/SessionTopbar", () => ({ SessionTopbar: () => null }))
vi.mock("@/keybinds/local", () => ({
  useLocalActions: () => (event: KeyboardEvent) =>
    event.key === " " ? { actionId: "flashcards-session.reveal" } : null,
}))

function card(id: string): CardDto {
  return {
    id,
    deckId: "d1",
    type: "classic",
    front: `front ${id}`,
    back: "A",
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: "",
    updatedAt: "",
  }
}

function sessionOf(sessionId: string, current: CardDto | null, graded: number): StudySessionDto {
  return {
    sessionId,
    deckId: "d1",
    deckName: "Deck",
    mode: "review",
    scope: "due",
    writesSchedule: true,
    autoReveal: "off",
    startedEmpty: false,
    isFinished: current === null,
    canUndo: graded > 0,
    graded,
    current,
    progress: { new: 2, learning: 0, due: 0, completed: graded, total: 2 },
    intervals: { again: "1m", hard: "5m", good: "10m", easy: "4d" },
  }
}

interface Pending {
  body: StartStudySessionDto
  handle: () => void
}

/** A host that supersedes the deck's live session on each start, handling requests in the order the test chooses. */
function fakeHost() {
  const live = new Set<string>()
  const pending: Pending[] = []
  let issued = 0

  mocks.startSession.mockImplementation(
    (body: StartStudySessionDto) =>
      new Promise<StudySessionDto>((resolve) => {
        pending.push({
          body,
          handle: () => {
            live.clear()
            const id = `s${String(++issued)}`
            live.add(id)
            resolve(sessionOf(id, card("c1"), 0))
          },
        })
      }),
  )
  mocks.endSession.mockImplementation((id: string) => {
    live.delete(id)
    return Promise.resolve()
  })
  mocks.gradeCard.mockImplementation((id: string) =>
    live.has(id)
      ? Promise.resolve(sessionOf(id, card("c2"), 1))
      : Promise.reject(new ApiError("Not Found", 404)),
  )
  return { live, pending }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useSession.setState({ status: "idle", session: null, revealed: false, overlays: {}, busy: false })
})

const space = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }))
  })

describe("a study session mounted under StrictMode", () => {
  it("keeps the session it holds through reveal and grade whichever order the host handles starts in", async () => {
    const server = fakeHost()
    await act(async () => {
      root.render(
        <StrictMode>
          <SessionPage deckId="d1" mode="review" scope="due" />
        </StrictMode>,
      )
    })

    // The most recent request first, the way a busy host can reorder two that were sent together.
    await vi.waitFor(() => expect(server.pending.length).toBeGreaterThan(0))
    while (server.pending.length > 0) {
      const next = server.pending.pop()!
      await act(async () => {
        next.handle()
        await Promise.resolve()
      })
      await act(async () => {
        await Promise.resolve()
      })
    }

    expect(useSession.getState().status).toBe("ready")
    space()
    space()
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.gradeCard).toHaveBeenCalledTimes(1)
    expect(navigate).not.toHaveBeenCalled()
    expect(useSession.getState().status).toBe("ready")
    expect(useSession.getState().session?.current?.id).toBe("c2")
  })

  it("sends one start request, not one per mount", async () => {
    const server = fakeHost()
    await act(async () => {
      root.render(
        <StrictMode>
          <SessionPage deckId="d1" mode="review" scope="due" />
        </StrictMode>,
      )
    })
    await vi.waitFor(() => expect(server.pending).toHaveLength(1))

    expect(mocks.startSession).toHaveBeenCalledTimes(1)
  })
})
