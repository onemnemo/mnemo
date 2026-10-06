// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { makeDoc, rect } from "../test-kit"
import {
  clearViewport,
  click,
  draftWith,
  masksOf,
  mountLayout,
  press,
  rows,
  seedKeybinds,
  setViewport,
  unmountLayout,
  useEnglish,
} from "./chrome-harness"

vi.mock("../../../editor/assets", () => ({
  uploadCardAsset: vi.fn(),
  useCardAssetUrl: (id: string | null | undefined) => (id ? "blob:test" : null),
  useCardAsset: (id: string | null | undefined) => ({ url: (id ? "blob:test" : null), failed: false }),
}))

beforeEach(() => {
  useEnglish()
  seedKeybinds()
  setViewport(1280, 800)
})

afterEach(() => {
  unmountLayout()
  clearViewport()
})

const three = () =>
  makeDoc(
    rect("a", 0.1, 0.1, 0.2, 0.2, { label: "Nucleus" }),
    rect("b", 0.4, 0.1, 0.2, 0.2, { label: "Ribosome" }),
    rect("c", 0.7, 0.1, 0.2, 0.2),
  )
const input = () => document.querySelector<HTMLInputElement>("input[data-inline-editor]")
const stage = () => document.querySelector<HTMLElement>('[data-testid="occlusion-editor-stage"]')!
const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]

function typeInto(field: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  act(() => {
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function key(target: Element, name: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, code: name, bubbles: true, cancelable: true, ...init }))
  })
}

describe("Cards list keyboard", () => {
  it("is a grid whose rows hold the rename field, with one row in the Tab order", () => {
    mountLayout({ draft: draftWith(three()) })

    const grid = document.querySelector('[role="grid"]')!
    expect(grid.getAttribute("aria-label")).toBe("Cards")
    expect(rows().every((row) => row.getAttribute("role") === "row" && grid.contains(row))).toBe(true)
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1])

    click(rows()[1])
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, 0, -1])

    act(() => rows()[1].dispatchEvent(new MouseEvent("dblclick", { bubbles: true })))
    expect(input()!.closest('[role="option"]')).toBeNull()
  })

  it("moves the selection and the focus with the arrow keys, Home and End", () => {
    mountLayout({ draft: draftWith(three()) })
    rows()[0].focus()

    key(rows()[0], "ArrowDown")
    expect(document.activeElement).toBe(rows()[1])
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
    key(rows()[1], "End")
    expect(document.activeElement).toBe(rows()[2])
    key(rows()[2], "ArrowUp")
    key(rows()[1], "Home")
    expect(document.activeElement).toBe(rows()[0])
    key(rows()[0], "ArrowUp")
    expect(document.activeElement).toBe(rows()[0])
  })

  it("renames from the keyboard with F2 on a focused row", () => {
    mountLayout({ draft: draftWith(three()) })
    rows()[1].focus()
    key(rows()[1], "Enter")
    press("F2", {}, rows()[1])

    expect(input()!.value).toBe("Ribosome")
  })

  it("opens the row menu from the menu key", () => {
    mountLayout({ draft: draftWith(three()) })
    rows()[1].focus()
    act(() => {
      rows()[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    })

    expect(menuItems().length).toBeGreaterThan(0)
    expect(rows()[1].getAttribute("aria-selected")).toBe("true")
  })
})

describe("after a rename", () => {
  it("returns the focus to the row, so the editor keys still work", () => {
    const spies = mountLayout({ draft: draftWith(three()) })
    click(rows()[0])
    press("F2")
    typeInto(input()!, "Cell nucleus")
    key(input()!, "Enter")

    expect(document.activeElement).toBe(rows()[0])
    press("Delete", {}, document.activeElement!)
    expect(masksOf(spies).map((mask) => mask.id)).toEqual(["b", "c"])
  })

  it("does the same after Escape", () => {
    mountLayout({ draft: draftWith(three()) })
    click(rows()[1])
    press("F2")
    key(input()!, "Escape")

    expect(input()).toBeNull()
    expect(document.activeElement).toBe(rows()[1])
  })

  it("keeps a typed label when Ctrl+Enter saves", async () => {
    const spies = mountLayout({ draft: draftWith(three()) })
    let labelAtSave: string | undefined
    spies.onSave.mockImplementation(() => {
      labelAtSave = masksOf(spies).find((mask) => mask.id === "c")?.label
    })
    click(rows()[2])
    press("F2")
    typeInto(input()!, "Golgi")
    key(input()!, "Enter", { ctrlKey: true })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5))
    })

    expect(spies.onSave).toHaveBeenCalledTimes(1)
    expect(labelAtSave).toBe("Golgi")
  })
})

describe("stage context menu from the keyboard", () => {
  it("opens over the selection on Shift+F10", () => {
    mountLayout({ draft: draftWith(three()) })
    click(rows()[1])
    key(stage(), "F10", { shiftKey: true })

    expect(menuItems().map((item) => item.textContent?.startsWith("Rename"))).toContain(true)
  })

  it("opens on the menu key, and stays shut with nothing selected", () => {
    mountLayout({ draft: draftWith(three()) })
    key(stage(), "ContextMenu")
    expect(menuItems()).toHaveLength(0)

    click(rows()[2])
    key(stage(), "ContextMenu")
    expect(menuItems().length).toBeGreaterThan(0)
  })
})

describe("keys over other controls", () => {
  it("leaves Delete alone on a tag chip's button", () => {
    const spies = mountLayout({ draft: { ...draftWith(three()), tags: ["bio"] } })
    click(rows()[0])
    const chip = document.querySelector<HTMLElement>('[data-no-editor-keys] button')!
    const event = press("Delete", {}, chip)

    expect(event.defaultPrevented).toBe(false)
    expect(masksOf(spies)).toHaveLength(3)
  })
})

describe("room for the list", () => {
  it("keeps the Cards list in a window that is only a little short", () => {
    setViewport(1280, 560)
    mountLayout({ draft: draftWith(three()) })
    expect(rows()).toHaveLength(3)
  })
})

describe("the Cards list in a small window", () => {
  beforeEach(() => {
    setViewport(900, 500)
  })
  const chip = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Makes"))!

  it("keeps the list open when Escape cancels a rename", () => {
    mountLayout({ draft: draftWith(three()) })
    click(chip())
    click(rows()[0])
    press("F2", {}, rows()[0])
    expect(input()).not.toBeNull()

    key(input()!, "Escape")
    expect(input()).toBeNull()
    expect(rows()).toHaveLength(3)
  })

  it("keeps a half typed label when the list closes around the field", () => {
    const spies = mountLayout({ draft: draftWith(three()) })
    click(chip())
    click(rows()[2])
    press("F2", {}, rows()[2])
    typeInto(input()!, "Golgi")
    click(chip())

    expect(rows()).toHaveLength(0)
    expect(masksOf(spies).find((mask) => mask.id === "c")?.label).toBe("Golgi")
  })
})
