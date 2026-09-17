/**
 * A failed grade or undo used to fail silently: the card snapped back to unrevealed with no
 * message, even though the server commits before it answers, so the grade might have actually
 * landed. This checks the card stays revealed (not falsely presented as untouched) and that a
 * reader gets a retry, which is safe either way because gradeCard folds a stale-card 409 into
 * the session's real state instead of throwing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { CardDto, StudySessionDto } from "@/api/types"

const mocks = vi.hoisted(() => ({
  gradeCard: vi.fn(),
  undoGrade: vi.fn(),
  startSession: vi.fn(),
  endSession: vi.fn(),
  warning: vi.fn(),
}))

vi.mock("./api", () => ({
  gradeCard: mocks.gradeCard,
  undoGrade: mocks.undoGrade,
  startSession: mocks.startSession,
  endSession: mocks.endSession,
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: mocks.warning },
}))

import { shownCard, useSession } from "./store"

function card(id: string): CardDto {
  return {
    id,
    deckId: "d1",
    type: "classic",
    front: "Q",
    back: "A",
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: "",
    updatedAt: "",
  }
}

function session(over: Partial<StudySessionDto> = {}): StudySessionDto {
  return {
    sessionId: "s1",
    deckId: "d1",
    deckName: "Deck",
    mode: "review",
    scope: "due",
    writesSchedule: true,
    autoReveal: "off",
    startedEmpty: false,
    isFinished: false,
    canUndo: true,
    graded: 0,
    current: card("c1"),
    progress: { new: 0, learning: 0, due: 1, completed: 0, total: 1 },
    intervals: null,
    ...over,
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  useSession.setState({
    status: "ready",
    session: session(),
    revealed: true,
    overlays: {},
    busy: false,
  })
})

describe("useSession grade failure", () => {
  it("leaves the card revealed and offers a retry instead of silently un-revealing it", async () => {
    mocks.gradeCard.mockRejectedValue(new ApiError("boom", 500))

    await useSession.getState().grade("good")

    expect(useSession.getState().revealed).toBe(true)
    expect(useSession.getState().busy).toBe(false)
    expect(mocks.warning).toHaveBeenCalledTimes(1)
    const options = mocks.warning.mock.calls[0][1]
    expect(options.primary).toBeDefined()
  })

  it("retries the same grade for the same card through the toast's retry action", async () => {
    mocks.gradeCard.mockRejectedValueOnce(new ApiError("boom", 500))
    const next = session({ current: card("c2"), graded: 1 })
    mocks.gradeCard.mockResolvedValueOnce(next)

    await useSession.getState().grade("good")
    const options = mocks.warning.mock.calls[0][1]
    options.primary.onClick()
    await flush()

    expect(mocks.gradeCard).toHaveBeenCalledTimes(2)
    expect(mocks.gradeCard).toHaveBeenNthCalledWith(2, "s1", { cardId: "c1", grade: "good" })
    expect(useSession.getState().session).toEqual(next)
  })

  it("marks the session gone on a 404 instead of toasting", async () => {
    mocks.gradeCard.mockRejectedValue(new ApiError("not found", 404))

    await useSession.getState().grade("good")

    expect(useSession.getState().status).toBe("gone")
    expect(mocks.warning).not.toHaveBeenCalled()
  })
})

describe("useSession undo failure", () => {
  it("clears busy and offers a retry on a non-404 failure", async () => {
    mocks.undoGrade.mockRejectedValue(new ApiError("boom", 500))

    await useSession.getState().undo()

    expect(useSession.getState().busy).toBe(false)
    expect(useSession.getState().status).toBe("ready")
    expect(mocks.warning).toHaveBeenCalledTimes(1)
  })

  it("retries undo for the same session through the toast's retry action", async () => {
    mocks.undoGrade.mockRejectedValueOnce(new ApiError("boom", 500))
    const next = session({ canUndo: false })
    mocks.undoGrade.mockResolvedValueOnce(next)

    await useSession.getState().undo()
    const options = mocks.warning.mock.calls[0][1]
    options.primary.onClick()
    await flush()

    expect(mocks.undoGrade).toHaveBeenCalledTimes(2)
    expect(useSession.getState().session).toEqual(next)
  })
})

/**
 * The server hands back the snapshot it queued at start on every response, so a card edited or
 * flagged on the study screen has to keep showing the edit whenever it comes round again: on a
 * learning step after Again, or on an undo.
 */
describe("useSession overlays", () => {
  const edited = { ...card("c1"), front: "NEW", back: "NEW A" }
  const snapshot = session({ current: { ...card("c1"), front: "OLD" }, graded: 1 })

  it("shows the edited text when Again brings the same card straight back", async () => {
    useSession.getState().overlayCard(edited)
    mocks.gradeCard.mockResolvedValueOnce(snapshot)

    await useSession.getState().grade("again")

    expect(shownCard(useSession.getState())?.front).toBe("NEW")
    expect(useSession.getState().revealed).toBe(false)
  })

  it("shows the edited text when undo brings the card back from the next one", async () => {
    useSession.getState().overlayCard(edited)
    mocks.gradeCard.mockResolvedValueOnce(session({ current: card("c2"), graded: 1 }))
    mocks.undoGrade.mockResolvedValueOnce(snapshot)

    await useSession.getState().grade("good")
    expect(shownCard(useSession.getState())?.id).toBe("c2")
    await useSession.getState().undo()

    expect(shownCard(useSession.getState())?.front).toBe("NEW")
  })

  it("keeps a flag set on the study screen when the card comes round again", async () => {
    useSession.getState().setFlagged(true)
    mocks.gradeCard.mockResolvedValueOnce(snapshot)

    await useSession.getState().grade("again")

    expect(shownCard(useSession.getState())?.isFlagged).toBe(true)
  })

  it("shows the next card as the server sent it, not the previous card's edit", async () => {
    useSession.getState().overlayCard(edited)
    mocks.gradeCard.mockResolvedValueOnce(session({ current: card("c2"), graded: 1 }))

    await useSession.getState().grade("good")

    expect(shownCard(useSession.getState())).toEqual(card("c2"))
  })

  it("forgets every edit when the session ends", async () => {
    useSession.getState().overlayCard(edited)
    mocks.endSession.mockResolvedValueOnce(undefined)

    await useSession.getState().end()
    useSession.setState({ status: "ready", session: snapshot })

    expect(shownCard(useSession.getState())?.front).toBe("OLD")
  })
})
