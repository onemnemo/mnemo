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

import { useSession } from "./store"

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
    card: null,
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
