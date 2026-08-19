// @vitest-environment jsdom

/**
 * The editor used to drop typed content on the floor the moment a reader hit Escape, clicked the
 * backdrop, or hit Close, with no warning. This mounts the real overlay and drives the paths Radix
 * funnels every dismiss through (onOpenChange, which Escape and the header close button both
 * resolve to) plus the footer's own Close button, and checks the guard only speaks up once there is
 * something to lose.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useCardEditor } from "../editor/store"
import { FactEditorOverlay } from "./FactEditorOverlay"

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => false),
  saveFact: vi.fn(async () => ({})),
  refresh: vi.fn(),
}))

const basicType = {
  id: "basic",
  name: "Basic",
  isBuiltIn: true,
  fields: [
    { id: "front", name: "Front", hint: null },
    { id: "back", name: "Back", hint: null },
  ],
  sortFieldId: "front",
  layouts: [{ id: "recognition", name: "Recognition", front: "{{Front}}", back: "{{Back}}", requires: null }],
  generator: null,
  generateFrom: null,
  createdAt: "2026-01-01T00:00:00+00:00",
  updatedAt: "2026-01-01T00:00:00+00:00",
}

vi.mock("../api", () => ({
  useDecksQuery: () => ({ data: [{ id: "d1", name: "Deck 1", folderId: null }] }),
  useFoldersQuery: () => ({ data: [] }),
}))

vi.mock("./api", () => ({
  useCardTypesQuery: () => ({ data: [{ type: basicType, factCount: 0 }] }),
  useFactForCardQuery: () => ({ data: undefined, isError: false }),
  useRefreshAfterFactWrite: () => mocks.refresh,
  saveFact: mocks.saveFact,
}))

vi.mock("../editor/assets", () => ({
  uploadCardAsset: vi.fn(),
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

// Radix measures its popper content (the deck select) with a ResizeObserver.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(false)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useCardEditor.setState({ target: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

/**
 * Two steps for the same reason FolderRow's tests need them: the confirm promise resolves on a
 * microtask, and the close it gates runs after that, so a single flush is not enough.
 */
async function settle(): Promise<void> {
  await act(async () => {})
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function openAddEditor(): void {
  act(() => useCardEditor.getState().openAdd("d1"))
  mount(<FactEditorOverlay />)
}

function firstField(): HTMLTextAreaElement {
  const field = document.querySelector<HTMLTextAreaElement>("textarea[aria-label]")
  expect(field, "the first field is not on screen").not.toBeNull()
  return field!
}

function typeInto(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
}

function closeButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find((el) => el.textContent === "CloseCard")
  expect(button, "the footer Close button is not on screen").not.toBeUndefined()
  return button as HTMLButtonElement
}

describe("FactEditorOverlay discard guard", () => {
  it("closes immediately on Escape when nothing has been typed", async () => {
    openAddEditor()
    await settle()

    pressEscape()
    await settle()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(useCardEditor.getState().target).toBeNull()
  })

  it("asks for confirmation on Escape once a field has unsaved text", async () => {
    openAddEditor()
    await settle()

    typeInto(firstField(), "What is the capital of France?")
    pressEscape()
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    // The mocked confirm resolves false (cancel), so the material is not dropped.
    expect(useCardEditor.getState().target).not.toBeNull()
  })

  it("closes once the discard is confirmed", async () => {
    mocks.confirm.mockResolvedValue(true)
    openAddEditor()
    await settle()

    typeInto(firstField(), "What is the capital of France?")
    pressEscape()
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(useCardEditor.getState().target).toBeNull()
  })

  it("routes the footer Close button through the same guard as Escape", async () => {
    openAddEditor()
    await settle()

    typeInto(firstField(), "What is the capital of France?")
    act(() => {
      closeButton().click()
    })
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(useCardEditor.getState().target).not.toBeNull()
  })
})

function fields(): HTMLTextAreaElement[] {
  return [...document.querySelectorAll("textarea")]
}

function saveButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((el) => el.textContent?.startsWith("AddCard"))
}

describe("FactEditorOverlay save rule", () => {
  it("renders the fields of the chosen card type", async () => {
    openAddEditor()
    await settle()

    expect(fields().map((el) => el.getAttribute("aria-label"))).toEqual(["Front", "Back"])
  })

  it("will not save an empty form", async () => {
    openAddEditor()
    await settle()

    expect(saveButton()?.disabled).toBe(true)
  })

  it("will not save a card that would be blank on one side", async () => {
    openAddEditor()
    await settle()

    typeInto(firstField(), "What is the capital of France?")
    await settle()

    expect(saveButton()?.disabled).toBe(true)
  })

  it("enables the save once both sides of a card have something", async () => {
    openAddEditor()
    await settle()

    typeInto(fields()[0], "What is the capital of France?")
    typeInto(fields()[1], "Paris")
    await settle()

    expect(saveButton()?.disabled).toBe(false)
  })
})
