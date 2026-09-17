// @vitest-environment jsdom

import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MindmapFindBar } from "./MindmapFindBar"
import type { MindmapFind } from "./useMindmapFind"

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLElement
let root: Root

function bar(over: Partial<MindmapFind> = {}): MindmapFind {
  return {
    open: true,
    query: "rock",
    count: 5,
    index: 1,
    opened: 1,
    show: vi.fn(),
    close: vi.fn(),
    setQuery: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    ...over,
  }
}

function render(find: MindmapFind): void {
  act(() => {
    root.render(
      <StrictMode>
        <MindmapFindBar find={find} />
      </StrictMode>,
    )
  })
}

function input(): HTMLInputElement {
  return container.querySelector("input")!
}

function press(key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }))
  })
}

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe("the find bar", () => {
  it("draws nothing while closed", () => {
    render(bar({ open: false }))
    expect(container.innerHTML).toBe("")
  })

  it("takes the focus when it opens, ready to type", () => {
    render(bar())
    expect(document.activeElement).toBe(input())
  })

  it("counts the walk as position over total, and says so plainly when nothing matched", () => {
    render(bar())
    expect(container.textContent).toContain("2/5")

    render(bar({ count: 0, index: -1 }))
    expect(container.textContent).toContain("0")
    expect(container.textContent).not.toContain("0/")

    render(bar({ query: "", count: 0, index: -1 }))
    expect(container.textContent).toContain("0/0")
  })

  it("walks on Enter, back on Shift+Enter, and closes on Escape", () => {
    const find = bar()
    render(find)

    press("Enter")
    expect(find.next).toHaveBeenCalledTimes(1)
    press("Enter", { shiftKey: true })
    expect(find.previous).toHaveBeenCalledTimes(1)
    press("Escape")
    expect(find.close).toHaveBeenCalledTimes(1)
  })

  it("takes the focus back when asked for again with the caret elsewhere", () => {
    render(bar({ opened: 1 }))
    const elsewhere = document.createElement("button")
    document.body.appendChild(elsewhere)
    act(() => elsewhere.focus())
    expect(document.activeElement).toBe(elsewhere)

    render(bar({ opened: 2 }))

    expect(document.activeElement).toBe(input())
    elsewhere.remove()
  })

  it("lets a chord the app allows while typing reach the window", () => {
    // The palette and the assistant listen on the window; a bar that stopped every key would
    // make Ctrl+K dead exactly where a user is typing a query.
    render(bar())
    const seen = vi.fn()
    window.addEventListener("keydown", seen)
    try {
      press("k", { ctrlKey: true })
      press("r")
      expect(seen).toHaveBeenCalledTimes(2)
    } finally {
      window.removeEventListener("keydown", seen)
    }
  })

  it("keeps a second Ctrl+F for itself rather than letting the browser's bar open", () => {
    render(bar())
    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true })

    act(() => {
      input().dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })

  it("disables the walk when there is nothing to walk", () => {
    render(bar({ count: 0, index: -1 }))
    const buttons = [...container.querySelectorAll("button")]
    expect(buttons.find((button) => button.getAttribute("aria-label") === "FindNext")?.disabled).toBe(true)
    expect(buttons.find((button) => button.getAttribute("aria-label") === "FindClose")?.disabled).toBe(false)
  })
})
