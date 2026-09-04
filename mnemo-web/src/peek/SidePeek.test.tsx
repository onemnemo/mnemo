// @vitest-environment jsdom

/**
 * The panel itself: what it announces, where focus goes, how it is resized without a
 * mouse, what the background control does and when it is offered, and what happens to an
 * item that is renamed or taken away while it is being read.
 *
 * Escape is checked here as well as in the rules module, because the case that matters is
 * an integration one: a caret in the main editor with nothing selected leaves the key
 * unhandled, and only the focus guard stops the panel from closing on a keystroke that
 * was meant for the document.
 */

import { StrictMode, act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { NoteSummaryDto } from "@/api/types"
import { useSettingsStore } from "@/settings/store"
import { useSomaStore } from "@/stores/soma"

import { SidePeek } from "./SidePeek"
import { PEEK_MAX_WIDTH, usePeekStore } from "./store"

const mocks = vi.hoisted(() => ({
  notes: [] as { id: string; title: string }[],
  bodyKeys: [] as string[],
}))

vi.mock("@/notes/api", () => ({
  useNotesQuery: () => ({ data: mocks.notes, isSuccess: true }),
}))

// The renderers are lazily loaded and each pulls a module's whole world. What the panel
// owes them is a fresh mount per item and per refresh, which a probe shows directly.
vi.mock("./PeekBody", () => ({
  PeekBody: ({ item }: { item: { kind: string } }) => {
    mocks.bodyKeys.push(item.kind)
    return <div data-testid="peek-body" />
  },
}))

vi.mock("@/i18n/useT", () => ({
  useT: () => (_ns: string, key: string) => key,
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const NOTE = { kind: "note", id: "n1" } as const

let container: HTMLElement
let root: Root
let trigger: HTMLButtonElement
let editor: HTMLElement

const initial = usePeekStore.getState()

function render(node: ReactNode = <SidePeek />): void {
  act(() => root.render(<StrictMode>{node}</StrictMode>))
}

function panel(): HTMLElement | null {
  return container.querySelector<HTMLElement>("[role='complementary']")
}

function separator(): HTMLElement {
  const element = container.querySelector<HTMLElement>("[role='separator']")
  expect(element).not.toBeNull()
  return element!
}

function headerTitle(): string {
  return container.querySelector("header span")?.textContent ?? ""
}

function pressEscape(target: EventTarget, defaultPrevented = false): void {
  act(() => {
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    if (defaultPrevented) event.preventDefault()
    target.dispatchEvent(event)
  })
}

function pressKey(target: EventTarget, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
  })
}

/** Opens the header's overflow menu the way a keyboard user does. */
async function openOptions(): Promise<void> {
  const button = container.querySelector<HTMLElement>("[aria-label='PeekOptions']")
  expect(button).not.toBeNull()
  act(() => button!.focus())
  pressKey(button!, "Enter")
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function closeOptions(): Promise<void> {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/** Every row the open menu offers, by the label it renders. */
function menuLabels(): string[] {
  return [...document.querySelectorAll("[role='menu'] [role^='menuitem']")].map(
    (item) => item.textContent ?? "",
  )
}

function summary(id: string, title: string): NoteSummaryDto {
  return { id, title } as unknown as NoteSummaryDto
}

beforeEach(() => {
  localStorage.clear()
  mocks.notes = [summary("n1", "Cranial nerves")]
  mocks.bodyKeys = []
  usePeekStore.setState({ ...initial, item: null, nonce: 0 })
  useSomaStore.setState({ dockOpen: false })
  useSettingsStore.setState({ values: {} })

  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)

  trigger = document.createElement("button")
  document.body.append(trigger)

  editor = document.createElement("div")
  editor.setAttribute("contenteditable", "true")
  editor.tabIndex = 0
  document.body.append(editor)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  trigger.remove()
  editor.remove()
})

describe("the panel", () => {
  it("renders nothing while it is closed", () => {
    render()
    expect(panel()).toBeNull()
  })

  it("announces itself as a complementary region with a label", () => {
    usePeekStore.setState({ item: NOTE })
    render()

    expect(panel()?.getAttribute("aria-label")).toBe("PeekLabel")
    expect(panel()?.dataset.peek).toBe("overlay")
  })

  it("moves focus in on open and back to the trigger on close", () => {
    render()
    trigger.focus()

    act(() => usePeekStore.getState().openPeek(NOTE))
    expect(document.activeElement).toBe(panel())

    act(() => usePeekStore.getState().closePeek())
    expect(document.activeElement).toBe(trigger)
  })

  it("names the separator and carries the width range it can be dragged through", () => {
    usePeekStore.setState({ item: NOTE, width: 520 })
    render()

    expect(separator().getAttribute("aria-label")).toBe("PeekResize")
    expect(separator().getAttribute("aria-valuenow")).toBe("520")
    expect(separator().getAttribute("aria-valuemin")).toBe("400")
    expect(separator().getAttribute("aria-valuemax")).toBe("760")
  })
})

describe("resizing from the keyboard", () => {
  it("widens a right-hand panel on ArrowLeft and narrows it on ArrowRight", () => {
    usePeekStore.setState({ item: NOTE, width: 520, side: "right" })
    render()

    pressKey(separator(), "ArrowLeft")
    expect(usePeekStore.getState().width).toBe(536)

    pressKey(separator(), "ArrowRight")
    expect(usePeekStore.getState().width).toBe(520)
  })

  it("reverses on a left-hand panel, so the key always moves the edge the way it points", () => {
    usePeekStore.setState({ item: NOTE, width: 520, side: "left" })
    render()

    pressKey(separator(), "ArrowLeft")
    expect(usePeekStore.getState().width).toBe(504)
  })

  it("stops at the end of the range rather than past it", () => {
    usePeekStore.setState({ item: NOTE, width: PEEK_MAX_WIDTH, side: "right" })
    render()

    pressKey(separator(), "ArrowLeft")
    expect(usePeekStore.getState().width).toBe(PEEK_MAX_WIDTH)
  })
})

describe("the background control", () => {
  it("writes the chosen opacity onto the panel as a custom property", () => {
    usePeekStore.setState({ item: NOTE, alpha: 60 })
    render()

    expect(panel()?.style.getPropertyValue("--peek-surface-alpha")).toBe("0.6")
  })

  it("is offered while overlaying and withheld while docked", async () => {
    usePeekStore.setState({ item: NOTE, placement: "overlay" })
    render()

    await openOptions()
    expect(menuLabels()).toContain("PeekBackground")

    await closeOptions()
    act(() => usePeekStore.getState().setPlacement("docked"))

    await openOptions()
    expect(menuLabels()).toContain("PeekOverlay")
    expect(menuLabels()).not.toContain("PeekBackground")
  })
})

describe("collapsing", () => {
  // The store clears collapse when the placement changes, because a docked rail is a
  // whole column showing thirty pixels of nothing. Offering the verb while docked reached
  // that state from the other side.
  it("is offered while overlaying and withheld while docked", async () => {
    usePeekStore.setState({ item: NOTE, placement: "overlay" })
    render()

    await openOptions()
    expect(menuLabels()).toContain("PeekCollapse")

    await closeOptions()
    act(() => usePeekStore.getState().setPlacement("docked"))

    await openOptions()
    expect(menuLabels()).not.toContain("PeekCollapse")
  })

  // The header is hidden while collapsed, so the rail is the only thing left to read.
  it("names the note the rail is holding", () => {
    usePeekStore.setState({ item: NOTE, collapsed: true })
    render()

    const rail = container.querySelector("button")
    expect(rail?.getAttribute("aria-label")).toContain("Cranial nerves")
    expect(rail?.getAttribute("aria-label")).toContain("PeekExpand")
  })
})

describe("refreshing", () => {
  it("remounts the body rather than swapping a document into the one on screen", () => {
    usePeekStore.setState({ item: NOTE })
    render()

    const mountedOnce = mocks.bodyKeys.length
    expect(mountedOnce).toBeGreaterThan(0)

    act(() => usePeekStore.getState().refreshPeek())
    expect(mocks.bodyKeys.length).toBeGreaterThan(mountedOnce)
  })
})

describe("an item that changes underneath the reader", () => {
  it("retitles the header when the note is renamed", () => {
    usePeekStore.setState({ item: NOTE })
    render()
    expect(headerTitle()).toContain("Cranial nerves")

    mocks.notes = [summary("n1", "Cranial nerves, revised")]
    act(() => usePeekStore.getState().refreshPeek())
    expect(headerTitle()).toContain("Cranial nerves, revised")
  })

  it("closes when the note leaves the library, which is what the trash does to it", () => {
    usePeekStore.setState({ item: NOTE })
    render()
    expect(panel()).not.toBeNull()

    mocks.notes = []
    act(() => usePeekStore.getState().refreshPeek())

    expect(usePeekStore.getState().item).toBeNull()
    expect(panel()).toBeNull()
  })
})

describe("escape", () => {
  it("closes an unpinned overlay when focus is in the panel", () => {
    usePeekStore.setState({ item: NOTE })
    render()
    act(() => panel()!.focus())

    pressEscape(panel()!)
    expect(usePeekStore.getState().item).toBeNull()
  })

  // The one press ProseMirror leaves unhandled: a caret in prose, nothing selected, find
  // closed. Without the focus guard the panel takes it and the writer loses their Escape.
  it("leaves the key alone when the caret is in the main editor", () => {
    usePeekStore.setState({ item: NOTE })
    render()
    act(() => editor.focus())

    pressEscape(editor)
    expect(usePeekStore.getState().item).toEqual(NOTE)
  })

  it("leaves the key alone once something ahead of it has answered", () => {
    usePeekStore.setState({ item: NOTE })
    render()
    act(() => panel()!.focus())

    pressEscape(panel()!, true)
    expect(usePeekStore.getState().item).toEqual(NOTE)
  })

  it("does not close a pinned peek", () => {
    usePeekStore.setState({ item: NOTE, pinned: true })
    render()
    act(() => panel()!.focus())

    pressEscape(panel()!)
    expect(usePeekStore.getState().item).toEqual(NOTE)
  })

  it("does not close a docked peek", () => {
    usePeekStore.setState({ item: NOTE, placement: "docked" })
    render()
    act(() => panel()!.focus())

    pressEscape(panel()!)
    expect(usePeekStore.getState().item).toEqual(NOTE)
  })

  // The assistant's composer is the field this arises for: it holds its draft in
  // component state and answers only Enter, so closing here unmounts what was typed.
  it("leaves the key alone for a field inside the panel", () => {
    usePeekStore.setState({ item: NOTE })
    render()

    const composer = document.createElement("textarea")
    panel()!.append(composer)
    act(() => composer.focus())

    pressEscape(composer)
    expect(usePeekStore.getState().item).toEqual(NOTE)
  })
})

describe("focus on the way out", () => {
  it("hands focus back to the trigger when the panel still holds it", () => {
    render()
    trigger.focus()
    act(() => usePeekStore.getState().openPeek(NOTE))
    expect(document.activeElement).toBe(panel())

    act(() => usePeekStore.getState().closePeek())
    expect(document.activeElement).toBe(trigger)
  })

  // The peek closes itself when its item 404s, leaves the library, or is promoted to the
  // canvas. None of those may pull the caret out of whatever the reader moved on to.
  it("leaves focus where it is when the reader has moved to the main editor", () => {
    render()
    trigger.focus()
    act(() => usePeekStore.getState().openPeek(NOTE))

    act(() => editor.focus())
    expect(document.activeElement).toBe(editor)

    mocks.notes = []
    act(() => usePeekStore.getState().refreshPeek())

    expect(usePeekStore.getState().item).toBeNull()
    expect(document.activeElement).toBe(editor)
  })
})
