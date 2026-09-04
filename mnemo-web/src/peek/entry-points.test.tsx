// @vitest-environment jsdom

/**
 * The three ways into the peek from the notes tree, checked against the real row: the
 * right-click entry, Alt and Enter on a focused row, and Alt and click. All three have to
 * open the row's own note and none of them may navigate, which is the whole difference
 * from clicking the row.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NoteRowModel } from "@/notes/tree/tree-model"
import type { TreeDrag } from "@/notes/tree/useNoteTreeDrag"
import { NoteRow } from "@/notes/tree/NoteTreeRow"

import { usePeekStore } from "./store"

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  openTab: vi.fn(),
  openTransfer: vi.fn(),
  undo: vi.fn(),
  mutate: vi.fn(async () => ({ id: "n9" })),
}))

vi.mock("@/notes/api", () => ({
  useSaveNoteFolder: () => ({ mutateAsync: mocks.mutate }),
  useDeleteNoteFolder: () => ({ mutateAsync: mocks.mutate }),
  useCreateNote: () => ({ mutateAsync: mocks.mutate }),
  useUpdateNoteMetadata: () => ({ mutateAsync: mocks.mutate }),
  useDeleteNote: () => ({ mutateAsync: mocks.mutate }),
  useDuplicateNote: () => ({ mutateAsync: mocks.mutate }),
}))
vi.mock("@/app/router", () => ({ navigate: mocks.navigate }))
vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("@/trash/undo", () => ({ useUndoDelete: () => mocks.undo }))
vi.mock("@/notes/workspace/tabs", () => ({
  useNoteTabs: (select: (state: { open: unknown }) => unknown) => select({ open: mocks.openTab }),
}))
vi.mock("@/notes/transfer/store", () => ({
  useNoteTransfer: (select: (state: { open: unknown }) => unknown) => select({ open: mocks.openTransfer }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const drag = {
  sourceKey: null,
  handle: null,
  target: null,
  ghostRef: { current: null },
  placeGhost: () => {},
  press: () => {},
  suppressClick: () => false,
} as unknown as TreeDrag

const row: NoteRowModel = {
  kind: "note",
  id: "n1",
  depth: 0,
  note: {
    id: "n1",
    title: "Cranial nerves",
    folderId: null,
    parentNoteId: null,
    order: 0,
    isFavorite: false,
  },
} as unknown as NoteRowModel

let container: HTMLElement
let root: Root

const initial = usePeekStore.getState()

function mount(node: ReactNode): void {
  act(() => root.render(node))
}

function rowElement(): HTMLElement {
  const element = container.querySelector<HTMLElement>("[role='treeitem']")
  expect(element).not.toBeNull()
  return element!
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  usePeekStore.setState({ ...initial, item: null, nonce: 0 })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("opening a note in the side peek from the tree", () => {
  it("offers the entry right after Open in new tab", () => {
    mount(<NoteRow row={row} selected={false} drag={drag} />)
    act(() => {
      rowElement().focus()
      rowElement().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    })

    const labels = [...document.querySelectorAll("[role='menuitem']")].map((item) => item.textContent)
    expect(labels).toContain("PeekOpenInSidePeek")
    expect(labels.indexOf("PeekOpenInSidePeek")).toBe(labels.indexOf("OpenInNewTab") + 1)
  })

  it("opens the row's own note from the menu, without navigating", () => {
    mount(<NoteRow row={row} selected={false} drag={drag} />)
    act(() => {
      rowElement().focus()
      rowElement().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
    })

    const item = [...document.querySelectorAll("[role='menuitem']")].find(
      (element) => element.textContent === "PeekOpenInSidePeek",
    )
    act(() => (item as HTMLElement).click())

    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n1" })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it("opens it on Alt and Enter, and navigates on Enter alone", () => {
    mount(<NoteRow row={row} selected={false} drag={drag} />)

    act(() => {
      rowElement().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", altKey: true, bubbles: true, cancelable: true }),
      )
    })
    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n1" })
    expect(mocks.navigate).not.toHaveBeenCalled()

    usePeekStore.getState().closePeek()
    act(() => {
      rowElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
    })
    expect(mocks.navigate).toHaveBeenCalledWith("notes", "n1")
    expect(usePeekStore.getState().item).toBeNull()
  })

  it("opens it on Alt and click, and navigates on a plain click", () => {
    mount(<NoteRow row={row} selected={false} drag={drag} />)

    act(() => {
      rowElement().dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true, cancelable: true }))
    })
    expect(usePeekStore.getState().item).toEqual({ kind: "note", id: "n1" })
    expect(mocks.navigate).not.toHaveBeenCalled()

    usePeekStore.getState().closePeek()
    act(() => {
      rowElement().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    expect(mocks.navigate).toHaveBeenCalledWith("notes", "n1")
  })
})
