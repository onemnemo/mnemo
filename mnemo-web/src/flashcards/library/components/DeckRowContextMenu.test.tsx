// @vitest-environment jsdom

/**
 * Right-click is the one gesture the deck row's verbs cannot be reached by in a
 * headless check, so it is checked here: a real contextmenu event on the row,
 * against the same list the overflow button renders.
 *
 * The webview's own menu is suppressed app-wide by installContextMenuGuard, which
 * is deliberately not installed here: this pins the component, not the guard.
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { DeckSummaryDto } from "@/api/types"
import type { TranslateFn } from "@/i18n/types"

import { DeckRowContextMenu } from "./DeckRowContextMenu"
import { deckMenuItems, type DeckMenuHandlers } from "./deck-row-menu-items"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const deck = {
  id: "d1",
  name: "Pharmacology",
  activeCards: 340,
  dueCounts: { new: 4, learning: 3, due: 5, total: 12 },
} as unknown as DeckSummaryDto

const t: TranslateFn = (_ns, key) => key

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

function handlers(): DeckMenuHandlers {
  return {
    open: vi.fn(),
    review: vi.fn(),
    cramDue: vi.fn(),
    cramAll: vi.fn(),
    test: vi.fn(),
    rename: vi.fn(),
    reviewSettings: vi.fn(),
    export: vi.fn(),
    remove: vi.fn(),
  }
}

/** Every menu row currently on screen, by its label. */
function rowLabels(): string[] {
  return [...document.querySelectorAll("[role='menuitem']")].map((el) => el.textContent ?? "")
}

describe("DeckRowContextMenu", () => {
  it("opens the deck's verbs on a right click and runs the one chosen", () => {
    const on = handlers()
    mount(
      <DeckRowContextMenu entries={deckMenuItems({ deck, upToDate: false, t, on })}>
        <div data-testid="row">Pharmacology</div>
      </DeckRowContextMenu>,
    )
    const row = container.querySelector("[data-testid='row']")
    expect(row).not.toBeNull()

    rightClick(row!)
    expect(rowLabels()).toContain("RenameDeck")

    const rename = [...document.querySelectorAll("[role='menuitem']")].find(
      (el) => el.textContent === "RenameDeck",
    )
    act(() => {
      ;(rename as HTMLElement).click()
    })
    expect(on.rename).toHaveBeenCalledTimes(1)
  })

  it("draws nothing until the row is right-clicked", () => {
    mount(
      <DeckRowContextMenu entries={deckMenuItems({ deck, upToDate: true, t, on: handlers() })}>
        <div data-testid="row">Pharmacology</div>
      </DeckRowContextMenu>,
    )
    expect(rowLabels()).toEqual([])
  })
})
