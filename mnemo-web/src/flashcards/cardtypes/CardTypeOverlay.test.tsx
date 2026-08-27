// @vitest-environment jsdom

/**
 * Mounts the real manager over a stubbed API. What is worth pinning here is the wiring the pure
 * draft tests cannot see: that the stored types reach the pane, that Save is offered only once
 * something has been edited, and that what it sends is the edited type rather than the stored one.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { CardTypeOverlay } from "./CardTypeOverlay"
import { useCardTypeManager } from "./store"

// Transforming the manager's chunk for the first time can outrun the default test timeout on a
// busy machine running the whole suite at once, so that cost is paid here, once, on its own
// generous budget, rather than inside whichever test happens to run first.
beforeAll(async () => {
  await import("./CardTypeManager")
}, 30000)

const mocks = vi.hoisted(() => ({
  saveCardType: vi.fn(async (_body: unknown) => ({ id: "vocab" })),
  deleteCardType: vi.fn(async (_typeId: string) => {}),
  refresh: vi.fn(),
}))

const vocabulary = {
  id: "vocab",
  name: "Vocabulary",
  isBuiltIn: false,
  fields: [
    { id: "word", name: "Word", hint: null },
    { id: "meaning", name: "Meaning", hint: null },
  ],
  sortFieldId: "word",
  layouts: [{ id: "recognition", name: "Recognition", front: "{{Word}}", back: "{{Meaning}}", requires: null }],
  generator: null,
  generateFrom: null,
  createdAt: "2026-01-01T00:00:00+00:00",
  updatedAt: "2026-01-01T00:00:00+00:00",
}

vi.mock("../facts/api", () => ({
  useCardTypesQuery: () => ({ data: [{ type: vocabulary, factCount: 3 }], isError: false }),
  useRefreshAfterFactWrite: () => mocks.refresh,
  saveCardType: mocks.saveCardType,
  deleteCardType: mocks.deleteCardType,
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

vi.mock("@/stores/dialog", () => ({
  dialog: { confirm: vi.fn(async () => false) },
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useCardTypeManager.setState({ open: false, initialTypeId: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

async function settle(): Promise<void> {
  // The manager is a lazy import behind the gate's own Suspense boundary, so the first flush
  // after opening has to wait on that chunk rather than assume a synchronous render tree.
  await act(async () => {
    await import("./CardTypeManager")
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function open(): void {
  act(() => useCardTypeManager.getState().show())
  mount(<CardTypeOverlay />)
}

function inputsLabelled(label: string): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)]
}

function saveButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((el) => el.textContent === "Save")
}

function typeInto(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("CardTypeOverlay gate", () => {
  it("renders nothing until the manager is opened", () => {
    mount(<CardTypeOverlay />)

    expect(container.innerHTML).toBe("")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("shows the loading shell at a bounded height, not a fixed one", () => {
    open()

    const shell = [...document.querySelectorAll("div")].find((el) => el.className.includes("86vh"))
    expect(shell, "the loading shell is not on screen").not.toBeUndefined()
    expect(shell!.className.split(/\s+/)).toContain("max-h-[86vh]")
  })
})

describe("CardTypeOverlay", () => {
  it("shows the stored type's fields and cards", async () => {
    open()
    await settle()

    expect(inputsLabelled("CardTypesFieldNamePlaceholder").map((el) => el.value)).toEqual(["Word", "Meaning"])
    expect(inputsLabelled("CardTypesCardNamePlaceholder").map((el) => el.value)).toEqual(["Recognition"])
  })

  it("offers Save only once something has been edited", async () => {
    open()
    await settle()

    expect(saveButton()?.disabled).toBe(true)

    typeInto(inputsLabelled("CardTypesNameLabel")[0], "Words")
    await settle()

    expect(saveButton()?.disabled).toBe(false)
  })

  it("sends the edited type rather than the one it was opened with", async () => {
    open()
    await settle()

    typeInto(inputsLabelled("CardTypesFieldNamePlaceholder")[1], "Definition")
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.saveCardType).toHaveBeenCalledTimes(1)
    const sent = mocks.saveCardType.mock.calls[0][0] as { id: string; fields: { id: string; name: string }[] }
    expect(sent.id).toBe("vocab")
    // The field keeps its id through a rename, which is what lets the server carry the rename into
    // the templates naming it and leave every piece of material where it is.
    expect(sent.fields[1]).toMatchObject({ id: "meaning", name: "Definition" })
  })

  it("adds a field to the type it is showing", async () => {
    open()
    await settle()

    const add = [...document.querySelectorAll("button")].find((el) => el.textContent === "CardTypesAddField")
    act(() => add?.click())
    await settle()

    expect(inputsLabelled("CardTypesFieldNamePlaceholder")).toHaveLength(3)
    expect(saveButton()?.disabled).toBe(false)
  })
})
