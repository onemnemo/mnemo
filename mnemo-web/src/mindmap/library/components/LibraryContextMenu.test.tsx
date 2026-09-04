// @vitest-environment jsdom

/**
 * Right-click is the one gesture the library's verbs cannot be reached by in a headless
 * check, so it is checked here: a real contextmenu event on a map card and on a folder
 * card, against the same list each card's overflow button renders.
 *
 * The webview's own menu is suppressed app-wide by installContextMenuGuard, which is
 * deliberately not installed here: this pins the components, not the guard.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FolderCardModel, MapCardModel } from "../shelf"
import type { LibraryActions } from "../useLibraryActions"
import { FolderCard } from "./FolderCard"
import { MapCard } from "./MapCard"

vi.mock("@/i18n/useT", () => ({ useT: () => (_ns: string, key: string) => key }))
vi.mock("@/i18n/store", () => ({
  useI18nStore: (select: (state: { language: string }) => unknown) => select({ language: "en" }),
}))
vi.mock("@/lib/relative-date", () => ({ formatSmart: () => "today" }))
vi.mock("../../page/MindmapThumbnail", () => ({ MindmapThumbnail: () => null }))
vi.mock("../../transfer/store", () => ({
  useMindmapTransfer: (select: (state: { open: unknown }) => unknown) => select({ open: vi.fn() }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const map = {
  id: "m1",
  title: "Cranial nerves",
  nodeCount: 12,
  modifiedAt: "2026-01-01T00:00:00Z",
  layout: "free",
  document: {},
} as unknown as MapCardModel

const folder = {
  id: "f1",
  folder: { id: "f1", name: "Anatomy" },
  mapCount: 2,
  modifiedAt: "2026-01-01T00:00:00Z",
  preview: null,
} as unknown as FolderCardModel

let container: HTMLElement
let root: Root

beforeEach(() => {
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

function rightClick(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))
  })
}

function actions(): LibraryActions {
  return {
    renameMap: vi.fn(),
    duplicateMap: vi.fn(),
    deleteMap: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    fileMap: vi.fn(),
  } as unknown as LibraryActions
}

/** Every menu row currently on screen, by its label. */
function rowLabels(): string[] {
  return [...document.querySelectorAll("[role='menuitem']")].map((el) => el.textContent ?? "")
}

function choose(label: string): void {
  const row = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")].find(
    (el) => el.textContent === label,
  )
  expect(row, `no menu row ${label}`).toBeDefined()
  act(() => {
    row!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }))
    row!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0 }))
    row!.click()
  })
}

describe("a map card", () => {
  it("opens the map's verbs on a right click and runs the one chosen", () => {
    const on = actions()
    mount(
      <MapCard map={map} templates={[]} defaultTemplateId="" due={0} actions={on} onOpen={() => {}} />,
    )
    expect(rowLabels()).toEqual([])

    rightClick(container.querySelector("button")!)
    expect(rowLabels()).toEqual(["Rename", "Duplicate", "Export", "Delete"])

    choose("Rename")
    expect(on.renameMap).toHaveBeenCalledWith("m1", "Cranial nerves")
  })

  it("keeps the delete row destructive and wired to the map", () => {
    const on = actions()
    mount(
      <MapCard map={map} templates={[]} defaultTemplateId="" due={0} actions={on} onOpen={() => {}} />,
    )

    rightClick(container.querySelector("button")!)
    choose("Delete")
    expect(on.deleteMap).toHaveBeenCalledWith("m1")
  })
})

describe("a folder card", () => {
  it("offers rename and delete on a right click", () => {
    const on = actions()
    mount(
      <FolderCard folder={folder} templates={[]} defaultTemplateId="" actions={on} onOpen={() => {}} />,
    )

    rightClick(container.querySelector("button")!)
    expect(rowLabels()).toEqual(["Rename", "Delete"])

    choose("Delete")
    // Not the open folder, so the delete has nowhere to walk out of.
    expect(on.deleteFolder).toHaveBeenCalledWith(folder.folder, false)
  })
})
