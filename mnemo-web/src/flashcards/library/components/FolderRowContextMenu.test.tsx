// @vitest-environment jsdom

/**
 * Right-click is the one gesture the folder row's verbs cannot be reached by in a
 * headless check, so it is checked here: a real contextmenu event on the row. That
 * the overflow button offers the same list is checked against the row itself, in
 * FolderRow.test.tsx.
 *
 * The webview's own menu is suppressed app-wide by installContextMenuGuard, which
 * is deliberately not installed here: this pins the component, not the guard.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TranslateFn } from "@/i18n/types"

import { FolderRowContextMenu } from "./FolderRowContextMenu"
import { folderMenuItems, type FolderMenuHandlers } from "./folder-row-menu-items"
import type { FolderRowModel } from "../tree"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// The flyout positions itself with Popper, which measures its content.
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= StubResizeObserver as unknown as typeof ResizeObserver

const row = (expanded: boolean): FolderRowModel => ({
  kind: "folder",
  id: "f1",
  depth: 0,
  folder: { id: "f1", name: "Anatomy", parentId: null, order: 0 } as FolderRowModel["folder"],
  counts: { new: 2, learning: 1, due: 4, deckCount: 3 },
  expanded,
})

const t: TranslateFn = (_ns, key) => key

/** No rename is chosen in here, so every close hands focus back the way it normally would. */
const neverEditor = () => false

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

function handlers(): FolderMenuHandlers {
  return { toggle: vi.fn(), rename: vi.fn(), remove: vi.fn() }
}

/** Every menu row currently on screen, by its label. */
function rowLabels(): string[] {
  return [...document.querySelectorAll("[role='menuitem']")].map((el) => el.textContent ?? "")
}

describe("FolderRowContextMenu", () => {
  it("opens the folder's verbs on a right click and runs the one chosen", () => {
    const on = handlers()
    mount(
      <FolderRowContextMenu entries={folderMenuItems({ row: row(true), t, on })} opensEditor={neverEditor}>
        <div data-testid="row">Anatomy</div>
      </FolderRowContextMenu>,
    )
    const target = container.querySelector("[data-testid='row']")
    expect(target).not.toBeNull()

    rightClick(target!)
    expect(rowLabels()).toContain("RenameFolder")

    const rename = [...document.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "RenameFolder",
    )
    act(() => {
      ;(rename as HTMLElement).click()
    })
    expect(on.rename).toHaveBeenCalledTimes(1)
  })

  it("draws nothing until the row is right-clicked", () => {
    mount(
      <FolderRowContextMenu entries={folderMenuItems({ row: row(false), t, on: handlers() })} opensEditor={neverEditor}>
        <div data-testid="row">Anatomy</div>
      </FolderRowContextMenu>,
    )
    expect(rowLabels()).toEqual([])
  })

  it("stays out of the way while the name is being edited", () => {
    mount(
      <FolderRowContextMenu entries={folderMenuItems({ row: row(true), t, on: handlers() })} opensEditor={neverEditor} disabled>
        <div data-testid="row">Anatomy</div>
      </FolderRowContextMenu>,
    )

    rightClick(container.querySelector("[data-testid='row']")!)
    expect(rowLabels()).toEqual([])
  })

  it("names the twirl after the state the row is in", () => {
    mount(
      <FolderRowContextMenu entries={folderMenuItems({ row: row(true), t, on: handlers() })} opensEditor={neverEditor}>
        <div data-testid="row">Anatomy</div>
      </FolderRowContextMenu>,
    )

    rightClick(container.querySelector("[data-testid='row']")!)
    expect(rowLabels()[0]).toBe("CollapseFolder")
  })
})
