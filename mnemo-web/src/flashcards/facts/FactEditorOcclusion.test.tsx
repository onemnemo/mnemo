// @vitest-environment jsdom

/**
 * Choosing Image occlusion in the card type select swaps the editor for a large modal
 * layout. This mounts the real editor with the data layer mocked and drives that switch, the empty
 * state, the image upload and the save confirmation, which only speaks up when cards would go.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/api/client"
import type { FactDto } from "@/api/types"
import type { ConfirmOptions } from "@/stores/dialog"
import { toast } from "@/stores/toast"

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
    label,
  }: {
    value: string
    choices: { value: string; label: string }[]
    onChange: (next: string) => void
    label: string
  }) => (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
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

describe("layout switch", () => {
  it("swaps the dialog for the occlusion layout and back", async () => {
    openAdd()
    await settle()
    expect(editor()).toBeNull()
    expect(classicOverlay()).not.toBeNull()
    expect(document.querySelectorAll("textarea")).toHaveLength(2)

    choose("occlusion")
    await settle()
    expect(editor()).not.toBeNull()
    expect(classicOverlay()).not.toBeNull()
    expect(editor()!.getAttribute("data-state")).toBe("open")
    // The same header carries over: the deck and the type select are still there.
    expect(typeSelect().value).toBe("occlusion")
    expect(document.querySelector('select[aria-label="Deck"]')).not.toBeNull()

    choose("basic")
    await settle()
    expect(editor()).toBeNull()
    expect(classicOverlay()).not.toBeNull()
    expect(document.querySelectorAll("textarea")).toHaveLength(2)
  })

  it("starts in the occlusion layout for a stored occlusion fact", async () => {
    openEdit(storedOcclusion(["Nucleus", "Ribosome"]))
    await settle()

    expect(editor()).not.toBeNull()
    expect(rows().map((row) => row.textContent?.replace(/\s+/g, ""))).toEqual(["1Nucleus", "2Ribosome"])
  })
})

describe("empty occlusion form", () => {
  it("shows the drop zone, reads Makes no cards yet and cannot save", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()

    expect(document.querySelector('[data-testid="occlusion-drop-zone"]')).not.toBeNull()
    expect(document.body.textContent).toContain("Makes no cards yet")
    expect(buttonNamed("Add card")?.disabled).toBe(true)
  })

  it("asks before replacing a picture that has masks, then clears them", async () => {
    openEdit(storedOcclusion(["Nucleus"]))
    await settle()
    const urls = () => [...document.querySelectorAll("img")].map((img) => img.getAttribute("src"))
    expect(urls()).toEqual(["blob:asset1"])
    mocks.confirm.mockResolvedValueOnce(true)

    // The header menu holds Replace image; its picker is the one hidden file input.
    pickFile(new File(["x"], "second.png", { type: "image/png" }))
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm.mock.calls[0][0].title).toBe("Replace the picture?")
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(urls()).toEqual(["blob:new1"])
    expect(document.querySelectorAll("[data-card-row]")).toHaveLength(0)
  })

  it("keeps the picture and its masks when the replace is cancelled", async () => {
    openEdit(storedOcclusion(["Nucleus"]))
    await settle()

    pickFile(new File(["x"], "second.png", { type: "image/png" }))
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.upload).not.toHaveBeenCalled()
    expect([...document.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["blob:asset1"])
    expect(document.querySelectorAll("[data-card-row]")).toHaveLength(1)
  })

  it("says so when the upload is rejected, and ignores a second pick while one is in flight", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()

    mocks.upload.mockRejectedValueOnce(new Error("too big"))
    pickFile(new File(["x"], "huge.png", { type: "image/png" }))
    await settle()
    expect(toast.warning).toHaveBeenCalledWith("Could not add the image", expect.anything())
    expect(document.querySelector('[data-testid="occlusion-drop-zone"]')).not.toBeNull()

    let finish: (value: unknown) => void = () => {}
    mocks.upload.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    pickFile(new File(["x"], "a.png", { type: "image/png" }))
    pickFile(new File(["x"], "b.png", { type: "image/png" }))
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    await act(async () => finish({ assetId: "a1", attachmentId: "a", displayName: "a.png", sizeBytes: 1 }))
    await settle()
    expect(document.querySelector('[data-testid="occlusion-drop-zone"]')).toBeNull()
  })

  it("says why a vector image is refused instead of dropping it silently", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()

    mocks.upload.mockRejectedValueOnce(new ApiError("Only PNG, JPEG, GIF and WebP images can be attached.", 400, "unsupported_image"))
    pickFile(new File(["<svg/>"], "cell.svg", { type: "image/svg+xml" }))
    await settle()

    expect(toast.warning).toHaveBeenCalledWith("Could not add the image", { description: expect.any(String) })
    expect(document.querySelector('[data-testid="occlusion-drop-zone"]')).not.toBeNull()
  })

  it("says so when a file that is not a picture is picked", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()

    pickFile(new File(["x"], "notes.txt", { type: "text/plain" }))
    await settle()
    expect(toast.warning).toHaveBeenCalledWith("That file is not an image.")
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it("accepts the first image of a new fact and offers the masks tools", async () => {
    openAdd()
    await settle()
    choose("occlusion")
    await settle()

    pickFile(new File(["x"], "first.png", { type: "image/png" }))
    await settle()

    expect(document.querySelector('[data-testid="occlusion-drop-zone"]')).toBeNull()
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull()
    // An image alone makes no cards, so saving still waits for a mask.
    expect(buttonNamed("Add card")?.disabled).toBe(true)
  })
})

describe("saving an edit that removes cards", () => {
  function removeFirstCard(): void {
    act(() => rows()[0].click())
    press("Delete")
  }

  it("asks, naming the mask, with Cancel focused and the trash wording", async () => {
    openEdit(storedOcclusion(["Nucleus", "Ribosome", "Golgi"]))
    await settle()
    removeFirstCard()
    expect(document.body.textContent).toContain("Makes 2 cards")
    expect(document.querySelector('[data-testid="chip-removes"]')?.textContent).toBe(", removes 1")

    act(() => buttonNamed("Save")!.click())
    await settle()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    const options = mocks.confirm.mock.calls[0][0]
    expect(options.title).toBe("Move cards to the trash?")
    expect(options.message).toBe(
      "Saving moves the card for Nucleus to the trash, with its review history. The other 2 keep theirs.",
    )
    expect(options.initialFocus).toBe("cancel")
    expect(options.confirmLabel).toBe("Save anyway")
    expect(options.message).not.toMatch(/delet|undone/i)
    // Cancel was chosen, so nothing was written and the editor stays.
    expect(mocks.saveFact).not.toHaveBeenCalled()
    expect(useCardEditor.getState().target).not.toBeNull()
  })

  it("saves once the removal is confirmed", async () => {
    mocks.confirm.mockResolvedValue(true)
    openEdit(storedOcclusion(["Nucleus", "Ribosome"]))
    await settle()
    removeFirstCard()
    act(() => buttonNamed("Save")!.click())
    await settle()

    expect(mocks.saveFact).toHaveBeenCalledTimes(1)
  })

  it("names three masks then counts the rest, unlabelled ones included", async () => {
    openEdit(storedOcclusion(["A", "B", "C", "", "E", "F"]))
    await settle()
    act(() => rows()[0].click())
    for (const row of rows().slice(1, 5)) act(() => row.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true })))
    press("Delete")
    act(() => buttonNamed("Save")!.click())
    await settle()

    expect(mocks.confirm.mock.calls[0][0].message).toBe(
      "Saving moves the cards for A, B, C, and 2 more to the trash, with their review history. The other card keeps its review history.",
    )
  })

  it("does not ask when the edit only adds, relabels or reorders", async () => {
    openEdit(storedOcclusion(["Nucleus", "Ribosome"]))
    await settle()
    act(() => rows()[0].click())
    press("d", { ctrlKey: true })
    press("ArrowDown", { altKey: true, shiftKey: true })
    expect(document.querySelector('[data-testid="chip-removes"]')).toBeNull()

    act(() => buttonNamed("Save")!.click())
    await settle()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.saveFact).toHaveBeenCalledTimes(1)
  })
})

describe("classic editor", () => {
  it("keeps its modal dialog", async () => {
    openAdd()
    await settle()

    expect(classicOverlay()).not.toBeNull()
    expect(editor()).toBeNull()
    expect(document.querySelector('[role="dialog"]')?.className).toContain("w-[724px]")
    expect(buttonNamed("Add card")?.disabled).toBe(true)
  })
})
