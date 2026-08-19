// @vitest-environment jsdom

/**
 * Renaming is the one folder verb that puts a caret on screen, and both menus
 * close over the top of it, so it is checked against the real row rather than a
 * stand-in: mount FolderRow, drive rename the way a user does, and look for the
 * field afterwards.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { LibraryDrag } from "../dnd/useLibraryDrag"
import type { FolderRowModel } from "../tree"
import { FolderRow } from "./FolderRow"

const mocks = vi.hoisted(() => ({
  saveFolder: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
  undo: vi.fn(),
}))

vi.mock("../../api", () => ({
  useSaveFolder: () => ({ mutateAsync: mocks.saveFolder }),
  useDeleteFolder: () => ({ mutateAsync: mocks.deleteFolder }),
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

// Deleting raises the undo toast, which reaches for the query cache this row is mounted without.
vi.mock("@/trash/undo", () => ({
  useUndoDelete: () => mocks.undo,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The flyout positions itself with Popper, which measures its content.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

const drag: LibraryDrag = {
  sourceKey: null,
  handle: null,
  target: null,
  ghostRef: { current: null },
  placeGhost: () => {},
  press: () => {},
  suppressClick: () => false,
}

const row = (expanded: boolean): FolderRowModel => ({
  kind: "folder",
  id: "f1",
  depth: 0,
  folder: { id: "f1", name: "Anatomy", parentId: null, order: 0 } as FolderRowModel["folder"],
  counts: { new: 2, learning: 1, due: 4, deckCount: 3 },
  expanded,
})

let container: HTMLElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

function mountRow(expanded = true): void {
  mount(<FolderRow row={row(expanded)} onToggle={() => {}} drag={drag} />)
}

/**
 * A closing menu settles in two steps and the order is what the bug lives in: the row mounts its
 * editor on a microtask, then Radix restores focus from a timeout. Render the first before
 * running the second, or the timeout finds nothing to steal focus from and the check passes
 * against code a browser would break.
 */
async function settle(): Promise<void> {
  await act(async () => {})
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

function rowElement(): HTMLElement {
  const element = container.querySelector<HTMLElement>("[role='row']")
  expect(element).not.toBeNull()
  return element!
}

function nameInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>("input")
}

function openEditor(): HTMLInputElement {
  const input = nameInput()
  expect(input, "the name editor is not on screen").not.toBeNull()
  return input!
}

/** Every menu row currently on screen, by its label. */
function rowLabels(): string[] {
  return [...document.querySelectorAll("[role='menuitem']")].map((el) => el.textContent ?? "")
}

function openContextMenu(): void {
  act(() => {
    // The press that raises the menu focuses the row first, and that is the element Radix
    // hands focus back to on the way out, so the row has to hold it here too.
    rowElement().focus()
    rowElement().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
  })
}

function openOverflowMenu(): void {
  const button = container.querySelector("button")
  expect(button).not.toBeNull()
  act(() => {
    button!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
  })
}

function chooseMenuItem(label: string): void {
  const item = [...document.querySelectorAll("[role='menuitem']")].find((el) => el.textContent === label)
  expect(item, `no menu item labelled ${label}`).not.toBeUndefined()
  act(() => {
    ;(item as HTMLElement).click()
  })
}

/** React tracks the value it last wrote, so a bare assignment reads back as no change. */
function type(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function pressKey(target: EventTarget, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  })
}

describe("FolderRow rename", () => {
  it("leaves the editor on screen when rename comes from the right-click menu", async () => {
    mountRow()

    openContextMenu()
    chooseMenuItem("RenameFolder")
    await settle()

    expect(nameInput()).not.toBeNull()
    expect(nameInput()?.value).toBe("Anatomy")
  })

  it("leaves the editor on screen when rename comes from the overflow menu", async () => {
    mountRow()

    openOverflowMenu()
    chooseMenuItem("RenameFolder")
    await settle()

    expect(nameInput()).not.toBeNull()
    expect(nameInput()?.value).toBe("Anatomy")
  })

  it("still opens the editor on a double click", async () => {
    mountRow()

    act(() => {
      rowElement().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })
    await settle()

    expect(nameInput()).not.toBeNull()
  })

  it("saves the typed name on Enter", async () => {
    mountRow()

    openContextMenu()
    chooseMenuItem("RenameFolder")
    await settle()

    const input = openEditor()
    type(input, "Physiology")
    pressKey(input, "Enter")
    await settle()

    expect(mocks.saveFolder).toHaveBeenCalledWith({
      id: "f1",
      name: "Physiology",
      parentId: null,
      order: 0,
    })
    expect(nameInput()).toBeNull()
  })

  it("saves the typed name when focus goes elsewhere", async () => {
    mountRow()

    openContextMenu()
    chooseMenuItem("RenameFolder")
    await settle()

    const input = openEditor()
    type(input, "Physiology")

    const elsewhere = document.createElement("button")
    document.body.appendChild(elsewhere)
    act(() => elsewhere.focus())
    await settle()

    expect(mocks.saveFolder).toHaveBeenCalledTimes(1)
    expect(nameInput()).toBeNull()
    elsewhere.remove()
  })

  it("throws the typed name away on Escape", async () => {
    mountRow()

    openContextMenu()
    chooseMenuItem("RenameFolder")
    await settle()

    const input = openEditor()
    type(input, "Physiology")
    pressKey(input, "Escape")
    await settle()

    expect(mocks.saveFolder).not.toHaveBeenCalled()
    expect(nameInput()).toBeNull()
  })
})

describe("FolderRow menus", () => {
  it("offers the same verbs in the same order on both of the row's surfaces", async () => {
    mountRow(false)

    openContextMenu()
    const fromRightClick = rowLabels()
    pressKey(document, "Escape")
    await settle()
    expect(rowLabels()).toEqual([])

    openOverflowMenu()
    const fromOverflow = rowLabels()

    expect(fromRightClick).toEqual(["ExpandFolder", "RenameFolder", "DeleteFolder"])
    expect(fromOverflow).toEqual(fromRightClick)
  })

  // Rename is the only verb that keeps focus. Holding it for the whole menu would leave a
  // keyboard user on the body after Escape or a twirl, with the next Tab back at the top of
  // the page and the overflow button faded out again.
  it("hands the row back its focus when the right-click menu closes on anything else", async () => {
    mountRow()

    openContextMenu()
    chooseMenuItem("CollapseFolder")
    await settle()

    expect(document.activeElement).toBe(rowElement())
  })

  it("hands the overflow button back its focus when its menu is dismissed", async () => {
    mountRow()
    const button = container.querySelector("button")

    openOverflowMenu()
    pressKey(document, "Escape")
    await settle()

    expect(document.activeElement).toBe(button)
  })
})
