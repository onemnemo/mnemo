// @vitest-environment jsdom

/**
 * The M key on the study screen: it uncovers the other masks of a hide all occlusion card, covers
 * them again, and does nothing on any other card.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { CardDto, StudySessionDto } from "@/api/types"

import { useCardEditor } from "../editor/store"
import { loadImages } from "../occlusion/image-test-helpers"
import { SessionPage } from "./SessionPage"
import { useSession } from "./store"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  startSession: vi.fn(),
  dropCard: vi.fn(),
  endSession: vi.fn(() => Promise.resolve()),
  gradeCard: vi.fn(),
  undoGrade: vi.fn(),
  fetchCard: vi.fn(),
  modalOpen: { value: false },
}))

vi.mock("./api", () => ({
  startSession: mocks.startSession,
  dropCard: mocks.dropCard,
  endSession: mocks.endSession,
  gradeCard: mocks.gradeCard,
  undoGrade: mocks.undoGrade,
  fetchCard: mocks.fetchCard,
}))

// One function for the life of the test: the page re-runs effects when `t` changes identity.
vi.mock("@/i18n/useT", () => {
  const t = (_ns: string, key: string) => key
  return { useT: () => t }
})
vi.mock("@/settings/store", () => ({ useSettingValue: (_key: string, fallback: string) => fallback }))
vi.mock("@/components/icon/AppIcon", () => ({ AppIcon: ({ name }: { name: string }) => <span data-icon={name} /> }))
vi.mock("../editor/assets", () => ({
  useCardAssetUrl: () => "blob:image",
  useCardAsset: () => ({ url: "blob:image", failed: false }),
}))
vi.mock("../deck/api", () => ({ useFlagCards: () => ({ mutateAsync: vi.fn() }) }))
vi.mock("@/app/router", () => ({ navigate: vi.fn() }))
vi.mock("@/lib/modal", () => ({ isModalOpen: () => mocks.modalOpen.value }))
vi.mock("./components/EndPanel", () => ({ EndPanel: () => null }))
vi.mock("./components/GradeRow", () => ({ GradeRow: () => null }))
vi.mock("./components/SessionTopbar", () => ({ SessionTopbar: () => null }))
vi.mock("@/keybinds/local", () => ({
  useLocalActions: () => (event: KeyboardEvent) =>
    event.key === "m" ? { actionId: "flashcards-session.show-masks" } : null,
}))

function occlusionCard(id: string, mode: "hideAll" | "hideOne"): CardDto {
  const mask = (maskId: string, order: number) => ({
    id: maskId,
    shape: "rect" as const,
    x: 0.1,
    y: 0.1 * (order + 1),
    w: 0.2,
    h: 0.05,
    points: null,
    label: null,
    group: null,
    order,
  })
  return {
    id,
    deckId: "d1",
    type: "occlusion",
    front: "Label it",
    back: "One",
    tags: [],
    state: "active",
    isFlagged: false,
    attachments: [],
    createdAt: "",
    updatedAt: "",
    occlusion: { mode, masks: [mask("a", 0), mask("b", 1), mask("c", 2)], askedIds: ["a"], back: "", imageAssetId: "img" },
  }
}

function session(current: CardDto): StudySessionDto {
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
    canUndo: false,
    graded: 0,
    current,
    progress: { new: 1, learning: 0, due: 0, completed: 0, total: 3 },
    intervals: null,
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.modalOpen.value = false
  host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useCardEditor.setState({ target: null })
  useSession.setState({ status: "idle", session: null, revealed: false, overlays: {}, busy: false })
})

async function open(current: CardDto): Promise<void> {
  mocks.startSession.mockResolvedValue(session(current))
  await act(async () => {
    root.render(<SessionPage deckId="d1" mode="review" scope="due" />)
  })
  await act(async () => {
    await Promise.resolve()
  })
  loadImages(host)
}

const pressM = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }))
  })
const states = () =>
  Object.fromEntries([...host.querySelectorAll("[data-mask]")].map((el) => [el.getAttribute("data-mask"), el.getAttribute("data-state")]))
const hint = () => host.textContent ?? ""

describe("the M key in a study session", () => {
  it("uncovers the other masks and covers them again", async () => {
    await open(occlusionCard("c1", "hideAll"))
    expect(states()).toEqual({ a: "asked", b: "covered", c: "covered" })

    pressM()
    expect(states()).toEqual({ a: "asked", b: "shown", c: "shown" })

    pressM()
    expect(states()).toEqual({ a: "asked", b: "covered", c: "covered" })
  })

  it("keeps working after the answer is revealed", async () => {
    await open(occlusionCard("c1", "hideAll"))
    act(() => useSession.getState().reveal())

    pressM()
    expect(states()).toEqual({ a: "answer", b: "shown", c: "shown" })
  })

  it("advertises the key before the reveal on hide all only", async () => {
    await open(occlusionCard("c1", "hideAll"))
    expect(hint()).toContain("StudyHintShowMasks")

    act(() => root.unmount())
    root = createRoot(host)
    await open(occlusionCard("c2", "hideOne"))
    expect(hint()).not.toContain("StudyHintShowMasks")
  })

  it("does nothing on a hide one card", async () => {
    await open(occlusionCard("c1", "hideOne"))

    pressM()
    expect(states()).toEqual({ a: "asked" })
  })

  it("pins an occlusion card to the top of its column", async () => {
    await open(occlusionCard("c1", "hideAll"))

    const column = host.querySelector("[data-card-column]")
    expect(column?.className).toContain("justify-start")
  })

  it("covers the masks again when the same card comes straight back after Again", async () => {
    await open(occlusionCard("c1", "hideAll"))
    pressM()
    expect(states().b).toBe("shown")

    const again = session(occlusionCard("c1", "hideAll"))
    again.graded = 1
    mocks.gradeCard.mockResolvedValue(again)
    act(() => useSession.getState().reveal())
    await act(async () => {
      await useSession.getState().grade("again")
    })
    loadImages(host)

    expect(states()).toEqual({ a: "asked", b: "covered", c: "covered" })
  })

  it("covers the masks again after an undo", async () => {
    await open(occlusionCard("c1", "hideAll"))
    pressM()
    const undone = session(occlusionCard("c1", "hideAll"))
    undone.graded = 1
    mocks.undoGrade.mockResolvedValue(undone)
    useSession.setState({ session: { ...useSession.getState().session!, canUndo: true } })
    await act(async () => {
      await useSession.getState().undo()
    })
    loadImages(host)

    expect(states().b).toBe("covered")
  })

  it("ignores M while typing in a field", async () => {
    await open(occlusionCard("c1", "hideAll"))
    const input = document.createElement("input")
    document.body.append(input)
    input.focus()

    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }))
    })
    input.remove()

    expect(states().b).toBe("covered")
  })

  it("ignores M while a dialog is open", async () => {
    await open(occlusionCard("c1", "hideAll"))
    mocks.modalOpen.value = true

    pressM()

    expect(states().b).toBe("covered")
  })
})

describe("editing the card on screen", () => {
  const edit = async () => {
    act(() => useCardEditor.getState().openEdit("d1", "c1"))
    await act(async () => {
      useCardEditor.getState().close()
      await Promise.resolve()
    })
  }

  it("refreshes the card when the edit leaves it in place", async () => {
    await open(occlusionCard("c1", "hideAll"))
    const fresh = occlusionCard("c1", "hideOne")
    mocks.fetchCard.mockResolvedValue(fresh)

    await edit()

    expect(mocks.startSession).toHaveBeenCalledTimes(1)
    expect(useSession.getState().overlays.c1).toBe(fresh)
  })

  it("shows the card fitted again after the editor returns", async () => {
    await open(occlusionCard("c1", "hideAll"))
    mocks.fetchCard.mockResolvedValue(occlusionCard("c1", "hideAll"))
    const label = (name: string) => host.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement | null
    act(() => label("StudyZoomIn")!.click())
    expect(label("StudyFit")).not.toBeNull()

    await edit()
    loadImages(host)

    expect(label("StudyFit")).toBeNull()
  })

  it("drops the card on screen from the session when the edit trashed it", async () => {
    await open(occlusionCard("c1", "hideAll"))
    mocks.fetchCard.mockRejectedValue(new ApiError("Not Found", 404))
    mocks.dropCard.mockResolvedValue(session(occlusionCard("c2", "hideAll")))

    await edit()
    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.dropCard).toHaveBeenCalledWith(expect.any(String), "c1")
    expect(mocks.startSession).toHaveBeenCalledTimes(1)
    expect(useSession.getState().session?.current?.id).toBe("c2")
  })

  it("starts the session over when the drop fails", async () => {
    await open(occlusionCard("c1", "hideAll"))
    mocks.fetchCard.mockRejectedValue(new ApiError("Not Found", 404))
    mocks.dropCard.mockRejectedValue(new ApiError("Server Error", 500))
    mocks.startSession.mockResolvedValue(session(occlusionCard("c2", "hideAll")))

    await edit()
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.startSession).toHaveBeenCalledTimes(2)
    expect(useSession.getState().session?.current?.id).toBe("c2")
  })

  it("keeps the session when the refresh fails for another reason", async () => {
    await open(occlusionCard("c1", "hideAll"))
    mocks.fetchCard.mockRejectedValue(new ApiError("Server Error", 500))

    await edit()

    expect(mocks.startSession).toHaveBeenCalledTimes(1)
  })
})
