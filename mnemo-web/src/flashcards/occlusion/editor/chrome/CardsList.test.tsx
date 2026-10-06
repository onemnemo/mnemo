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
  text,
  unmountLayout,
  useEnglish,
  type Spies,
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

const labelled = () =>
  makeDoc(
    rect("a", 0.1, 0.1, 0.2, 0.2, { label: "Nucleus" }),
    rect("b", 0.4, 0.1, 0.2, 0.2, { label: "Ribosome" }),
    rect("c", 0.7, 0.1, 0.2, 0.2),
  )

const input = () => document.querySelector<HTMLInputElement>("input[data-inline-editor]")

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

function dblclick(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))
  })
}

describe("Cards list rows", () => {
  it("numbers the cards and shows No label in the quiet ink", () => {
    mountLayout({ draft: draftWith(labelled()) })

    expect(rows().map((row) => text(row))).toEqual(["1Nucleus", "2Ribosome", "3No label"])
    const quiet = rows()[2].querySelector("span.truncate")!
    expect(quiet.className).toContain("text-ink-3")
  })

  it("marks a group row with the link icon and labels it with its members' labels", () => {
    const grouped = makeDoc(
      rect("a", 0.1, 0.1, 0.2, 0.2, { label: "Rough ER", group: "a" }),
      rect("b", 0.4, 0.1, 0.2, 0.2, { label: "Ribosomes", group: "a" }),
      rect("c", 0.7, 0.1, 0.2, 0.2),
    )
    mountLayout({ draft: draftWith(grouped) })

    expect(rows()).toHaveLength(2)
    expect(text(rows()[0])).toBe("1Rough ER, Ribosomes")
    expect(rows()[0].querySelector('[aria-label="Grouped masks"]')).not.toBeNull()
    expect(rows()[1].querySelector('[aria-label="Grouped masks"]')).toBeNull()
  })

  it("selects the card's masks when a row is clicked, and adds with Ctrl", () => {
    mountLayout({ draft: draftWith(labelled()) })

    click(rows()[1])
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
    click(rows()[2], { ctrlKey: true })
    expect(rows().map((row) => row.getAttribute("aria-selected"))).toEqual(["false", "true", "true"])
  })

  it("draws the hover ring on the mask while the pointer is over its row", () => {
    mountLayout({ draft: draftWith(labelled()) })
    const mask = () => document.querySelector<HTMLElement>('[role="option"][data-mask="b"]')!

    expect(mask().style.boxShadow).not.toContain("42%")
    act(() => {
      rows()[1].dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
    })
    expect(mask().style.boxShadow).toContain("42%")
    act(() => {
      rows()[1].dispatchEvent(new MouseEvent("mouseout", { bubbles: true }))
    })
    expect(mask().style.boxShadow).not.toContain("42%")
  })

  it("scrolls the selected row into view", () => {
    mountLayout({ draft: draftWith(labelled()) })
    const scroll = vi.fn()
    for (const row of rows()) row.scrollIntoView = scroll

    press("]")
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" })
  })
})

describe("Cards list rename", () => {
  it("opens an input with the label selected on a double click", () => {
    mountLayout({ draft: draftWith(labelled()) })
    dblclick(rows()[0])

    const field = input()!
    expect(field.value).toBe("Nucleus")
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe("Nucleus".length)
    expect(document.activeElement).toBe(field)
  })

  it("commits on Enter", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    dblclick(rows()[0])
    typeInto(input()!, "Cell nucleus")
    key(input()!, "Enter")

    expect(input()).toBeNull()
    expect(text(rows()[0])).toBe("1Cell nucleus")
    expect(masksOf(spies).find((mask) => mask.id === "a")?.label).toBe("Cell nucleus")
  })

  it("reverts on Escape without closing the editor", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    dblclick(rows()[0])
    typeInto(input()!, "Something else")
    act(() => {
      input()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))
    })

    expect(input()).toBeNull()
    expect(text(rows()[0])).toBe("1Nucleus")
    expect(spies.onOpenChange).not.toHaveBeenCalled()
  })

  it("commits on Tab and moves to the next card's label", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    dblclick(rows()[0])
    typeInto(input()!, "Nucleolus")
    key(input()!, "Tab")

    expect(masksOf(spies).find((mask) => mask.id === "a")?.label).toBe("Nucleolus")
    expect(input()!.value).toBe("Ribosome")
    expect(rows()[1].contains(input())).toBe(true)
    expect(rows()[1].getAttribute("aria-selected")).toBe("true")

    key(input()!, "Tab", { shiftKey: true })
    expect(rows()[0].contains(input())).toBe(true)
  })

  it("stops after the last card", () => {
    mountLayout({ draft: draftWith(labelled()) })
    dblclick(rows()[2])
    typeInto(input()!, "Golgi")
    key(input()!, "Tab")

    expect(input()).toBeNull()
    expect(text(rows()[2])).toBe("3Golgi")
  })

  it("renames a group's first member from its row", () => {
    const grouped = makeDoc(
      rect("a", 0.1, 0.1, 0.2, 0.2, { label: "Rough ER", group: "a" }),
      rect("b", 0.4, 0.1, 0.2, 0.2, { label: "Ribosomes", group: "a" }),
    )
    const spies = mountLayout({ draft: draftWith(grouped) })
    dblclick(rows()[0])

    expect(input()!.value).toBe("Rough ER")
    typeInto(input()!, "Smooth ER")
    key(input()!, "Enter")
    const masks = masksOf(spies)
    expect(masks.find((mask) => mask.id === "a")?.label).toBe("Smooth ER")
    expect(masks.find((mask) => mask.id === "b")?.label).toBe("Ribosomes")
  })

  it("starts from F2 on the selected card", () => {
    mountLayout({ draft: draftWith(labelled()) })
    click(rows()[1])
    press("F2")

    expect(rows()[1].contains(input())).toBe(true)
  })
})

/** A pointer event the way a mouse sends one, which jsdom has no class for. */
function pointer(type: string, x: number, y: number, target: EventTarget): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 })
  Object.defineProperty(event, "pointerId", { value: 1 })
  Object.defineProperty(event, "pointerType", { value: "mouse" })
  act(() => {
    target.dispatchEvent(event)
  })
}

function layOutRows(): void {
  rows().forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: index * 32, bottom: index * 32 + 32, height: 32, left: 0, right: 200, width: 200, x: 0, y: index * 32, toJSON: () => ({}) })
  })
}

describe("Cards list reorder", () => {
  const order = (spies: Spies) => masksOf(spies).sort((a, b) => a.order - b.order).map((mask) => mask.id)

  it("drags a card to a new place by its grip", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    layOutRows()
    const grip = rows()[0].querySelector("[data-grip]")!

    pointer("pointerdown", 190, 16, grip)
    pointer("pointermove", 190, 40, window)
    pointer("pointermove", 190, 100, window)
    expect(document.querySelector("[data-drop-mark]")).not.toBeNull()
    pointer("pointerup", 190, 100, window)

    expect(order(spies)).toEqual(["b", "c", "a"])
    expect(document.querySelector("[data-drop-mark]")).toBeNull()
  })

  it("leaves the order alone when the card is dropped where it was", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    layOutRows()
    const before = spies.draft().values.masks
    const grip = rows()[1].querySelector("[data-grip]")!

    pointer("pointerdown", 190, 48, grip)
    pointer("pointermove", 190, 100, window)
    pointer("pointermove", 190, 52, window)
    pointer("pointerup", 190, 52, window)

    expect(spies.draft().values.masks).toBe(before)
  })

  it("moves a group as one card", () => {
    const grouped = makeDoc(
      rect("a", 0.1, 0.1, 0.2, 0.2, { group: "a" }),
      rect("b", 0.4, 0.1, 0.2, 0.2, { group: "a" }),
      rect("c", 0.7, 0.1, 0.2, 0.2),
    )
    const spies = mountLayout({ draft: draftWith(grouped) })
    layOutRows()

    pointer("pointerdown", 190, 16, rows()[0].querySelector("[data-grip]")!)
    pointer("pointermove", 190, 90, window)
    pointer("pointerup", 190, 90, window)

    expect(order(spies)).toEqual(["c", "a", "b"])
  })
})

describe("Cards list context menu", () => {
  const menuItems = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]

  function openMenu(row: Element): void {
    act(() => {
      row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    })
  }

  it("offers the same items as the mask menu, with their keys", () => {
    mountLayout({ draft: draftWith(labelled()) })
    openMenu(rows()[0])

    expect(menuItems().map((item) => item.textContent)).toEqual([
      "RenameF2",
      "DuplicateCtrl D",
      "GroupCtrl G",
      "Move earlierAlt Shift ↑",
      "Move laterAlt Shift ↓",
      "DeleteDel",
    ])
  })

  it("selects the card it opens on, and disables Group for one card", () => {
    mountLayout({ draft: draftWith(labelled()) })
    openMenu(rows()[1])

    expect(rows()[1].getAttribute("aria-selected")).toBe("true")
    const group = menuItems().find((item) => item.textContent?.startsWith("Group"))!
    expect(group.getAttribute("aria-disabled")).toBe("true")
  })

  it("enables Group for two cards and runs it", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    click(rows()[0])
    click(rows()[1], { ctrlKey: true })
    openMenu(rows()[1])

    const group = menuItems().find((item) => item.textContent?.startsWith("Group"))!
    expect(group.getAttribute("aria-disabled")).toBeNull()
    click(group)
    expect(masksOf(spies).filter((mask) => mask.group)).toHaveLength(2)
  })

  it("reads Ungroup on a group and moves a card later", () => {
    const grouped = makeDoc(rect("a", 0.1, 0.1, 0.2, 0.2, { group: "a" }), rect("b", 0.4, 0.1, 0.2, 0.2, { group: "a" }))
    const spies = mountLayout({ draft: draftWith(makeDoc(...grouped.masks, rect("c", 0.7, 0.1, 0.2, 0.2))) })
    openMenu(rows()[0])

    expect(menuItems().some((item) => item.textContent?.startsWith("Ungroup"))).toBe(true)
    click(menuItems().find((item) => item.textContent?.startsWith("Move later"))!)
    expect(masksOf(spies).sort((x, y) => x.order - y.order).map((mask) => mask.id)).toEqual(["c", "a", "b"])
  })

  it("deletes the card from the menu", () => {
    const spies = mountLayout({ draft: draftWith(labelled()) })
    openMenu(rows()[1])
    click(menuItems().find((item) => item.textContent?.startsWith("Delete"))!)

    expect(masksOf(spies).map((mask) => mask.id)).toEqual(["a", "c"])
    expect(rows()).toHaveLength(2)
  })
})
