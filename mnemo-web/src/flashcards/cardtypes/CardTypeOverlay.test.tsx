// @vitest-environment jsdom

/**
 * Mounts the real manager over a stubbed API. What is worth pinning here is the wiring the pure
 * draft tests cannot see: that the stored types reach the pane, that Save is offered only once
 * something has been edited, and that what it sends is the edited type rather than the stored one.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { ConfirmOptions } from "@/stores/dialog"

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
  previewCardTypeSave: vi.fn(async (_typeId: string, _body: unknown) => ({
    removedCardCount: 4,
    affectedFactCount: 3,
  })),
  refresh: vi.fn(),
  confirm: vi.fn(async (_options: ConfirmOptions) => false),
  warn: vi.fn(),
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
  layouts: [
    { id: "recognition", name: "Recognition", front: "{{Word}}", back: "{{Meaning}}", requires: null },
    { id: "recall", name: "Recall", front: "{{Meaning}}", back: "{{Word}}", requires: null },
  ],
  generator: null,
  generateFrom: null,
  createdAt: "2026-01-01T00:00:00+00:00",
  updatedAt: "2026-01-01T00:00:00+00:00",
}

const grammar = {
  ...vocabulary,
  id: "grammar",
  name: "Grammar",
  fields: [
    { id: "rule", name: "Rule", hint: null },
    { id: "sample", name: "Sample", hint: null },
  ],
  sortFieldId: "rule",
  layouts: [
    { id: "state", name: "State", front: "{{Rule}}", back: "{{Sample}}", requires: null },
    { id: "spot", name: "Spot", front: "{{Sample}}", back: "{{Rule}}", requires: null },
  ],
}

const idioms = {
  ...vocabulary,
  id: "idioms",
  name: "Idioms",
  // The row's Delete is offered only for a type the app does not ship and nothing live is using.
  isBuiltIn: false,
  fields: [
    { id: "phrase", name: "Phrase", hint: null },
    { id: "sense", name: "Sense", hint: null },
  ],
  sortFieldId: "phrase",
  layouts: [
    { id: "read", name: "Read", front: "{{Phrase}}", back: "{{Sense}}", requires: null },
    { id: "say", name: "Say", front: "{{Sense}}", back: "{{Phrase}}", requires: null },
  ],
}

// The manager initially selects the first type. Idioms has no material.
vi.mock("../facts/api", () => ({
  useCardTypesQuery: () => ({
    data: [
      { type: vocabulary, factCount: 3 },
      { type: grammar, factCount: 5 },
      { type: idioms, factCount: 0 },
    ],
    isError: false,
  }),
  useRefreshAfterFactWrite: () => mocks.refresh,
  saveCardType: mocks.saveCardType,
  deleteCardType: mocks.deleteCardType,
  previewCardTypeSave: mocks.previewCardTypeSave,
}))

// Include parameters in translated output so assertions can inspect names and counts.
vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string, params?: Record<string, string | number>) =>
    params
      ? `${key}(${Object.entries(params)
          .map(([name, value]) => `${name}=${value}`)
          .join(", ")})`
      : key,
}))

vi.mock("@/stores/dialog", () => ({
  dialog: { confirm: mocks.confirm },
}))

vi.mock("@/stores/toast", () => ({
  toast: { warning: mocks.warn, info: vi.fn(), success: vi.fn() },
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Radix measures and scrolls its dropdown and captures the pointer, none of which the pinned
// jsdom implements. Scoped to this file.
Element.prototype.scrollIntoView = () => {}
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  // Clear mock implementations so consent cannot leak between tests.
  mocks.confirm.mockResolvedValue(false)
  mocks.deleteCardType.mockResolvedValue(undefined)
  mocks.previewCardTypeSave.mockResolvedValue({ removedCardCount: 4, affectedFactCount: 3 })
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
    expect(inputsLabelled("CardTypesCardNamePlaceholder").map((el) => el.value)).toEqual([
      "Recognition",
      "Recall",
    ])
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
    // A rename takes no card off the type, so there is nothing to consent to.
    expect(mocks.confirm).not.toHaveBeenCalled()
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

function removeCardButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="CardTypesRemoveCard"]')]
}

/** Points one card's condition at a field, through the dropdown the row actually renders. */
function requireField(cardIndex: number, fieldName: string): void {
  const trigger = [...document.querySelectorAll<HTMLElement>('[aria-label="CardTypesRequiresLabel"]')][cardIndex]
  expect(trigger, "no condition dropdown on that card").not.toBeUndefined()
  act(() => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })

  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (el) => el.textContent === fieldName,
  )
  expect(option, `no ${fieldName} choice in the dropdown`).not.toBeUndefined()
  act(() => {
    option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
}

function selectRow(index: number): void {
  const row = [...document.querySelectorAll('div[role="option"]')][index]
  act(() => {
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
}

/**
 * Layout removal must be confirmed for every affected type before any write begins.
 */
describe("CardTypeOverlay card removal guard", () => {
  it("asks before a save that removes a card from a stored type", async () => {
    open()
    await settle()

    act(() => removeCardButtons()[1].click())
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    // Stored layout names, and the count of cards the server says the save would take rather than
    // how much material happens to use the type.
    expect(mocks.previewCardTypeSave).toHaveBeenCalledTimes(1)
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({
      title: "CardTypesRemoveCardsTitle",
      message: "CardTypesRemoveCardsMessage(0=Recall, 1=Vocabulary, 2=4)",
      confirmLabel: "CardTypesRemoveCardsConfirm",
      destructive: true,
    })
    expect(mocks.saveCardType).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it("sends the surviving cards once the removal is confirmed", async () => {
    mocks.confirm.mockResolvedValue(true)
    open()
    await settle()

    act(() => removeCardButtons()[1].click())
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.saveCardType).toHaveBeenCalledTimes(1)
    const sent = mocks.saveCardType.mock.calls[0][0] as { layouts: { id: string }[] }
    expect(sent.layouts.map((layout) => layout.id)).toEqual(["recognition"])
  })

  it("writes nothing when a later type's removal is refused", async () => {
    open()
    await settle()

    typeInto(inputsLabelled("CardTypesFieldNamePlaceholder")[1], "Definition")
    await settle()

    selectRow(1)
    await settle()
    expect(inputsLabelled("CardTypesCardNamePlaceholder").map((el) => el.value)).toEqual(["State", "Spot"])

    act(() => removeCardButtons()[1].click())
    await settle()

    act(() => saveButton()?.click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.saveCardType).not.toHaveBeenCalled()
  })

  it("saves a removal from a type nothing is using without asking", async () => {
    open()
    await settle()

    selectRow(2)
    await settle()
    expect(inputsLabelled("CardTypesCardNamePlaceholder").map((el) => el.value)).toEqual(["Read", "Say"])

    act(() => removeCardButtons()[1].click())
    await settle()

    act(() => saveButton()?.click())
    await settle()

    // The sweep only reaches live material.
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.previewCardTypeSave).not.toHaveBeenCalled()
    expect(mocks.saveCardType).toHaveBeenCalledTimes(1)
  })

  it("saves without asking when the server says the edit takes no card", async () => {
    mocks.previewCardTypeSave.mockResolvedValue({ removedCardCount: 0, affectedFactCount: 0 })
    open()
    await settle()

    act(() => removeCardButtons()[1].click())
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.saveCardType).toHaveBeenCalledTimes(1)
  })

  it("writes nothing when the count cannot be read", async () => {
    mocks.previewCardTypeSave.mockRejectedValue(new Error("the collection is locked"))
    open()
    await settle()

    act(() => removeCardButtons()[1].click())
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.saveCardType).not.toHaveBeenCalled()
    expect(mocks.warn).toHaveBeenCalledWith("CardTypesSaveErrorTitle", {
      description: "the collection is locked",
    })
  })
})

/**
 * A card whose condition moves onto a field costs exactly what removing it does, for every piece
 * of material leaving that field empty, and it keeps its layout id so no diff of the draft sees it.
 */
describe("CardTypeOverlay required field guard", () => {
  it("asks before a save that starts requiring a field", async () => {
    open()
    await settle()

    requireField(1, "Word")
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm.mock.calls[0][0]).toMatchObject({
      title: "CardTypesRequiresChangeTitle",
      message: "CardTypesRequiresChangeMessage(0=Recall, 1=Vocabulary, 2=4)",
      confirmLabel: "CardTypesRequiresChangeConfirm",
      destructive: true,
    })
    expect(mocks.saveCardType).not.toHaveBeenCalled()
  })

  it("sends the condition once it is confirmed", async () => {
    mocks.confirm.mockResolvedValue(true)
    open()
    await settle()

    requireField(1, "Word")
    await settle()
    act(() => saveButton()?.click())
    await settle()

    expect(mocks.saveCardType).toHaveBeenCalledTimes(1)
    const sent = mocks.saveCardType.mock.calls[0][0] as { layouts: { id: string; requires: string | null }[] }
    expect(sent.layouts.find((layout) => layout.id === "recall")?.requires).toBe("word")
  })
})

function rightClick(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
  })
}

function clickMenuItem(label: string): void {
  const item = [...document.querySelectorAll("[role='menuitem']")].find((el) => el.textContent === label)
  expect(item, `no ${label} row in the menu`).not.toBeUndefined()
  act(() => (item as HTMLElement).click())
}

/**
 * Live and trashed usage share one error code, which the client translates.
 */
describe("CardTypeOverlay delete refusal", () => {
  it("says the refusal in the reader's language when the server names the code for it", async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.deleteCardType.mockRejectedValue(
      new ApiError("This card type still holds 2 pieces of material in the trash.", 409, "card_type_in_use"),
    )
    open()
    await settle()

    rightClick([...document.querySelectorAll('div[role="option"]')][2])
    clickMenuItem("Delete")
    await settle()

    expect(mocks.warn).toHaveBeenCalledWith("CardTypesDeleteBlockedTitle", {
      description: "CardTypesDeleteBlockedMessage",
    })
    expect([...document.querySelectorAll('div[role="option"]')]).toHaveLength(3)
  })

  it("shows what the server said when the failure is not one it has wording for", async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.deleteCardType.mockRejectedValue(new Error("the collection is locked"))
    open()
    await settle()

    rightClick([...document.querySelectorAll('div[role="option"]')][2])
    clickMenuItem("Delete")
    await settle()

    expect(mocks.warn).toHaveBeenCalledWith("CardTypesDeleteBlockedTitle", {
      description: "the collection is locked",
    })
  })
})
