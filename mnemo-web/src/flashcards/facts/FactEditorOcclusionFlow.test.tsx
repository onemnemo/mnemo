// @vitest-environment jsdom

/**
 * What the card editor does around the occlusion layout: what survives a trip to another type, what
 * shows while an edit loads, the discard warning and the confirm for grouped masks. The mocked data
 * layer is the same as in the main occlusion editor test.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import type { FactDto } from "@/api/types"
import { isModalOpen } from "@/lib/modal"
import type { ConfirmOptions } from "@/stores/dialog"

import { useCardEditor } from "../editor/store"
import { loadImages } from "../occlusion/image-test-helpers"
import { occlusionType, clearViewport, press, seedKeybinds, setViewport, useEnglish } from "../occlusion/editor/chrome/chrome-harness"
import { FactEditorOverlay } from "./FactEditorOverlay"
import { serializeOcclusion } from "./occlusion"

beforeAll(async () => {
  await import("./FactEditor")
}, 30000)

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(async (_options: ConfirmOptions) => false),
  saveFact: vi.fn(async (_fact: unknown) => ({})),
  upload: vi.fn(),
  refresh: vi.fn(),
  fact: undefined as FactDto | undefined,
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
  useCardTypesQuery: () => ({ data: [{ type: basicType, factCount: 0 }, { type: occlusionType, factCount: 1 }] }),
  useFactForCardQuery: () => ({ data: mocks.fact, isError: false }),
  useRefreshAfterFactWrite: () => mocks.refresh,
  saveFact: mocks.saveFact,
}))

vi.mock("../editor/assets", () => ({
  uploadCardAsset: mocks.upload,
  useCardAssetUrl: (id: string | null | undefined) => (id ? `blob:${id}` : null),
  useCardAsset: (id: string | null | undefined) => ({ url: (id ? `blob:${id}` : null), failed: false }),
}))

vi.mock("@/stores/dialog", () => ({
  dialog: { confirm: mocks.confirm },
  useDialogStore: { subscribe: () => () => {} },
}))
vi.mock("@/stores/toast", () => ({ toast: { warning: vi.fn(), info: vi.fn(), success: vi.fn() } }))

// A native select stands in for the Radix one, which jsdom cannot open.
vi.mock("@/settings/components/controls/SelectControl", () => ({
  SelectControl: ({
    value,
    choices,
    onChange,
    disabled,
    label,
  }: {
    value: string
    choices: { value: string; label: string }[]
    onChange: (next: string) => void
    disabled?: boolean
    label: string
  }) => (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  ),
}))

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(false)
  mocks.upload.mockResolvedValue({ assetId: "new1", attachmentId: "n1", displayName: "new.png", sizeBytes: 5 })
  mocks.fact = undefined
  useEnglish()
  seedKeybinds()
  setViewport(1280, 800)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  useCardEditor.setState({ target: null })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  clearViewport()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

async function settle(): Promise<void> {
  await act(async () => {
    await import("./FactEditor")
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  loadImages(document.body)
}

const typeSelect = () => document.querySelector<HTMLSelectElement>('select[aria-label="Card type"]')!
const editor = () => document.querySelector<HTMLElement>("[data-occlusion-editor]")
const classicOverlay = () => document.querySelector(".bg-black\\/50")
const rows = () => [...document.querySelectorAll<HTMLElement>("[data-card-row]")]
const buttonNamed = (name: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith(name))

function choose(typeId: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  act(() => {
    setter?.call(typeSelect(), typeId)
    typeSelect().dispatchEvent(new Event("change", { bubbles: true }))
  })
}

function openAdd(): void {
  act(() => useCardEditor.getState().openAdd("d1"))
  mount(<FactEditorOverlay />)
}

const masks = (labels: string[]) =>
  serializeOcclusion({
    mode: "hideAll",
    masks: labels.map((label, index) => ({
      id: `m${index}`,
      shape: "rect",
      x: 0.02 + index * 0.15,
      y: 0.1,
      w: 0.1,
      h: 0.2,
      order: index,
      ...(label ? { label } : {}),
    })),
  })

function storedOcclusion(labels: string[]): FactDto {
  return {
    id: "f1",
    deckId: "d1",
    typeId: "occlusion",
    values: { front: "Label the cell", masks: masks(labels) },
    media: [
      {
        fieldId: "image",
        attachments: [{ id: "att1", assetId: "asset1", side: "front", displayName: "cell.png", sizeBytes: 9, caption: null }],
      },
    ],
    tags: [],
    isFlagged: false,
    createdAt: "2026-01-01T00:00:00+00:00",
    updatedAt: "2026-01-01T00:00:00+00:00",
  } as unknown as FactDto
}

function openEdit(fact: FactDto): void {
  mocks.fact = fact
  act(() => useCardEditor.getState().openEdit("d1", "c1"))
  mount(<FactEditorOverlay />)
}

function pickFile(file: File): void {
  const input = document.querySelector<HTMLInputElement>('input[type="file"][aria-label="Choose image"]')!
  Object.defineProperty(input, "files", { configurable: true, value: [file] })
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
}

describe("retyping away from image occlusion", () => {
  it("keeps a picture added to a new fact across the same trip", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()
    pickFile(new File(["x"], "first.png", { type: "image/png" }))
    await settle()

    choose("basic")
    await settle()
    choose("occlusion")
    await settle()

    expect([...document.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["blob:new1"])
  })

  it("locks the type of a saved occlusion fact and says why", async () => {
    openEdit(storedOcclusion(["Nucleus"]))
    await settle()

    expect(typeSelect().disabled).toBe(true)
    expect(typeSelect().closest("[data-tooltip]")?.getAttribute("data-tooltip")).toContain("keeps its type")
  })

  it("leaves the type free on a new fact", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()

    expect(typeSelect().disabled).toBe(false)
    expect(typeSelect().closest("[data-tooltip]")).toBeNull()
  })

  it("leaves the type free on a saved fact of another type", async () => {
    openEdit({ ...storedOcclusion([]), typeId: "basic" } as FactDto)
    await settle()

    expect(typeSelect().disabled).toBe(false)
  })
})

describe("opening an edit", () => {
  it("shows nothing until the material has arrived, then goes straight to the occlusion layout", async () => {
    openEdit(undefined as unknown as FactDto)
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(classicOverlay()).toBeNull()

    mocks.fact = storedOcclusion(["Nucleus"])
    mount(<FactEditorOverlay />)
    await settle()
    expect(editor()).not.toBeNull()
    expect(classicOverlay()).not.toBeNull()
  })
})

describe("the editor as a modal", () => {
  it("sits in a dialog with the shared overlay, so window shortcuts stand down", async () => {
    openEdit(storedOcclusion(["Nucleus"]))
    await settle()

    expect(editor()?.getAttribute("role")).toBe("dialog")
    expect(classicOverlay()).not.toBeNull()
    expect(isModalOpen()).toBe(true)
    expect(editor()?.className).toContain("w-[calc(100vw-3rem)]")
    expect(editor()?.className).toContain("h-[calc(100vh-3rem)]")

    act(() => useCardEditor.getState().close())
    await settle()
    expect(isModalOpen()).toBe(false)
  })
})

describe("closing", () => {
  it("warns when only the masks changed", async () => {
    openEdit(storedOcclusion(["Nucleus", "Ribosome"]))
    await settle()
    act(() => rows()[0].click())
    press("Delete")
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))
    })
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm.mock.calls[0][0].title).toBe("Discard this card?")
  })
})

describe("the Delete key", () => {
  it("means the focused footer button, not the selected masks", async () => {
    openEdit(storedOcclusion(["Nucleus", "Ribosome"]))
    await settle()
    act(() => rows()[0].click())

    const close = buttonNamed("Close")
    expect(close).toBeDefined()
    press("Delete", {}, close!)
    expect(rows()).toHaveLength(2)

    press("Delete")
    expect(rows()).toHaveLength(1)
  })
})

describe("saving", () => {
  it("holds the editor still until the save answers, so nothing is edited behind it", async () => {
    let finish: () => void = () => {}
    mocks.saveFact.mockImplementationOnce(() => new Promise((resolve) => (finish = () => resolve({}))))
    openEdit(storedOcclusion(["Nucleus", "Ribosome"]))
    await settle()
    act(() => rows()[0].click())

    act(() => buttonNamed("Save")!.click())
    await settle()
    expect(editor()?.querySelectorAll("[inert]").length).toBeGreaterThan(0)
    press("Delete")
    expect(rows()).toHaveLength(2)
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))
    })
    await settle()
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(editor()).not.toBeNull()

    await act(async () => finish())
    await settle()
    expect(mocks.saveFact).toHaveBeenCalledTimes(1)
  })
})

describe("grouping and ungrouping", () => {
  it("asks about the cards a new group replaces", async () => {
    openEdit(storedOcclusion(["A", "B", "C"]))
    await settle()
    act(() => rows()[0].click())
    act(() => rows()[1].dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })))
    press("g", { ctrlKey: true })
    expect(document.querySelector('[data-testid="chip-removes"]')).not.toBeNull()
    act(() => buttonNamed("Save")!.click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm.mock.calls[0][0].initialFocus).toBe("cancel")
  })
})
