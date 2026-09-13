// @vitest-environment jsdom

/**
 * Mounts the lazy overlay over a stored preset. The gate tests pin its loading boundary, while
 * the discard tests drive each dismiss gesture through the real dialog and store.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { ConfirmOptions } from "@/stores/dialog"

import { ReviewSettingsOverlay } from "./ReviewSettingsOverlay"
import { useReviewSettings } from "./store"

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async (_options: ConfirmOptions) => false),
  refresh: vi.fn(),
}))

vi.mock("./api", () => ({
  usePresetsQuery: () => ({
    data: [
      {
        id: "preset-standard",
        name: "Standard",
        newPerDay: 20,
        maxReviewsPerDay: 200,
        algorithm: "fsrs",
        desiredRetention: 0.9,
        learningSteps: [1, 10],
        shuffleOrder: false,
        buryRelated: true,
        autoReveal: "off",
        nextDayStartsAtHour: 4,
        leechThreshold: 8,
        leechAction: "tag",
        deckCount: 1,
        isStandard: true,
        weights: null,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    isError: false,
  }),
  useDeckPresetQuery: () => ({ data: undefined, isError: false }),
  useRefreshAfterPresetWrite: () => mocks.refresh,
  assignDeckPreset: vi.fn(),
  applyPresetWeights: vi.fn(),
  createPreset: vi.fn(),
  deletePreset: vi.fn(),
  optimizePreset: vi.fn(),
  updatePreset: vi.fn(),
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/dialog", () => ({
  dialog: { confirm: mocks.confirm },
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Transforming the dialog's chunk for the first time can outrun the default test timeout on a
// busy machine running the whole suite at once, so that cost is paid here, once, on its own
// generous budget, rather than inside whichever test happens to run first.
beforeAll(async () => {
  await import("./ReviewSettings")
}, 30000)

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(false)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useReviewSettings.setState({ target: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

async function settle(): Promise<void> {
  // The dialog is a lazy import behind the gate's own Suspense boundary, so the first flush
  // after opening has to wait on that chunk rather than assume a synchronous render tree.
  await act(async () => {
    await import("./ReviewSettings")
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function open(): void {
  act(() => useReviewSettings.getState().open(null, null))
  mount(<ReviewSettingsOverlay />)
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
}

function editDailyLimit(): void {
  const increase = document.querySelector<HTMLButtonElement>('button[aria-label="ReviewSettingsNewPerDayTitle +"]')
  expect(increase, "the daily limit control is not on screen").not.toBeNull()
  act(() => increase!.click())
}

function headerCloseButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')
  expect(button, "the header close button is not on screen").not.toBeNull()
  return button!
}

function cancelButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === "Cancel",
  )
  expect(button, "the footer Cancel button is not on screen").not.toBeUndefined()
  return button!
}

function clickBackdrop(): void {
  const overlay = document.querySelector('[role="dialog"]')?.previousElementSibling
  expect(overlay, "the dialog backdrop is not on screen").not.toBeNull()
  act(() => {
    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 })
    Object.defineProperty(pointerDown, "pointerType", { value: "mouse" })
    overlay!.dispatchEvent(pointerDown)
    overlay!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }))
  })
}

describe("ReviewSettingsOverlay gate", () => {
  it("renders nothing until the store holds a target", () => {
    mount(<ReviewSettingsOverlay />)

    expect(container.innerHTML).toBe("")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("shows the loading shell at a bounded height, not a fixed one", () => {
    act(() => useReviewSettings.getState().open(null, null))
    mount(<ReviewSettingsOverlay />)

    const shell = [...document.querySelectorAll("div")].find((el) => el.className.includes("86vh"))
    expect(shell, "the loading shell is not on screen").not.toBeUndefined()
    expect(shell!.className.split(/\s+/)).toContain("max-h-[86vh]")
  })

  it("mounts the dialog's lazily-loaded content once a target is set", async () => {
    act(() => useReviewSettings.getState().open(null, null))
    mount(<ReviewSettingsOverlay />)
    await settle()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain("ReviewSettingsTitle")
  })
})

describe("ReviewSettingsOverlay discard guard", () => {
  it("closes immediately on Escape when nothing changed", async () => {
    open()
    await settle()

    pressEscape()
    await settle()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(useReviewSettings.getState().target).toBeNull()
  })

  it.each([
    ["Escape", () => pressEscape()],
    ["the backdrop", () => clickBackdrop()],
    ["the header close button", () => act(() => headerCloseButton().click())],
    ["Cancel", () => act(() => cancelButton().click())],
  ])("keeps unsaved edits when %s dismisses and discard is refused", async (_name, dismiss) => {
    open()
    await settle()
    editDailyLimit()

    dismiss()
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({
      title: "ReviewSettingsDiscardTitle",
      message: "ReviewSettingsDiscardMessage",
      confirmLabel: "ReviewSettingsDiscardConfirm",
      destructive: true,
    })
    expect(useReviewSettings.getState().target).not.toBeNull()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="ReviewSettingsNewPerDayTitle"]')?.value).toBe(
      "21",
    )
  })

  it("closes once discarding the edit is confirmed", async () => {
    mocks.confirm.mockResolvedValue(true)
    open()
    await settle()
    editDailyLimit()

    act(() => cancelButton().click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(useReviewSettings.getState().target).toBeNull()
  })
})
